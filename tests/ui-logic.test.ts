import { describe, expect, it } from 'vitest';
import { EMPTY_HISTORY, NAV_HISTORY_CAP, canGoBack, canGoForward, pushHistory, stepHistory } from '@/state/navHistory';
import { MAX_TOASTS, addToast, type ToastItem } from '@/components/toastStore';
import { buildBreadcrumb } from '@/features/workspaces/ui/breadcrumb';
import { buildRows, filterKeepAncestors } from '@/features/graph/ui/outlineModel';
import { cardPreview, cardState, descendantCounts, neighborFor, pathIds, computeCardLayout, CARD_WIDTH } from '@/features/graph/ui/graphView';
import { HINT_TEXT, pickHint } from '@/features/graph/ui/hints';
import { computePosition } from '@/components/floating';
import { relativeTime } from '@/hooks/relativeTime';
import { summarizeProvider } from '@/features/provider/ui/ProviderStatusBar';
import type { GraphNode } from '@/types';

let seq = 0;
function node(id: string, parentId: string | null, over: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    workspaceId: 'w',
    parentId,
    type: 'question',
    title: id,
    question: '',
    summary: '',
    sourcePassage: null,
    sourceMessageId: null,
    createdAt: seq++,
    updatedAt: 0,
    position: { x: 0, y: 0 },
    collapsed: false,
    conversationId: null,
    order: seq,
    answerPreview: '',
    answeredAt: null,
    ...over,
  };
}
// r -> a -> a1, a2 ; r -> b
const tree = () => [node('r', null), node('a', 'r'), node('a1', 'a'), node('a2', 'a'), node('b', 'r')];

describe('navigation history', () => {
  it('pushes, ignores duplicates, and truncates forward entries', () => {
    let h = pushHistory(EMPTY_HISTORY, 'a');
    h = pushHistory(h, 'a');
    h = pushHistory(h, 'b');
    h = pushHistory(h, 'c');
    expect(h.entries).toEqual(['a', 'b', 'c']);
    const back = stepHistory(h, -1)!;
    expect(back.id).toBe('b');
    expect(canGoForward(back.history)).toBe(true);
    const branched = pushHistory(back.history, 'd');
    expect(branched.entries).toEqual(['a', 'b', 'd']);
    expect(canGoForward(branched)).toBe(false);
    expect(canGoBack(branched)).toBe(true);
  });
  it('caps at 50 entries', () => {
    let h = EMPTY_HISTORY;
    for (let i = 0; i < 80; i++) h = pushHistory(h, `n${i}`);
    expect(h.entries).toHaveLength(NAV_HISTORY_CAP);
    expect(h.entries.at(-1)).toBe('n79');
    expect(h.index).toBe(NAV_HISTORY_CAP - 1);
  });
  it('skips deleted nodes when stepping', () => {
    let h = EMPTY_HISTORY;
    for (const id of ['a', 'b', 'c']) h = pushHistory(h, id);
    expect(stepHistory(h, -1, (id) => id !== 'b')?.id).toBe('a');
    expect(stepHistory(h, 1)).toBeNull();
  });
});

describe('toast dedupe', () => {
  it('merges identical messages and caps the list', () => {
    let items: ToastItem[] = [];
    let id = 1;
    for (let i = 0; i < 5; i++) {
      const r = addToast(items, 'error', 'Boom', id++);
      items = r.items;
    }
    expect(items).toHaveLength(1);
    expect(items[0]!.count).toBe(5);
    for (const m of ['a', 'b', 'c', 'd']) items = addToast(items, 'info', m, id++).items;
    expect(items).toHaveLength(MAX_TOASTS);
    expect(items.map((t) => t.message)).toEqual(['b', 'c', 'd']);
  });
  it('treats different kinds as different toasts and reports dropped ids', () => {
    const a = addToast([], 'error', 'x', 1);
    const b = addToast(a.items, 'info', 'x', 2);
    expect(b.items).toHaveLength(2);
    let items = b.items;
    items = addToast(items, 'info', 'y', 3).items;
    const r = addToast(items, 'info', 'z', 4);
    expect(r.dropped).toEqual([1]);
  });
});

describe('breadcrumb', () => {
  it('shows everything when short and folds the middle when long', () => {
    const chain = ['r', 'a', 'b', 'c', 'd', 'e'].map((id, i, arr) => node(id, i ? arr[i - 1]! : null));
    const short = buildBreadcrumb('WS', chain.slice(0, 3));
    expect(short.head.map((c) => c.label)).toEqual(['WS', 'r', 'a', 'b']);
    expect(short.collapsed).toHaveLength(0);
    const long = buildBreadcrumb('WS', chain);
    expect(long.head.map((c) => c.label)).toEqual(['WS', 'r']);
    expect(long.collapsed.map((c) => c.label)).toEqual(['a', 'b', 'c']);
    expect(long.tail.map((c) => c.label)).toEqual(['d', 'e']);
    expect(long.head[0]!.id).toBeNull();
  });
});

describe('outline filter', () => {
  it('keeps ancestors of matches and ignores collapse while filtering', () => {
    const nodes = tree();
    nodes[1] = { ...nodes[1]!, collapsed: true, title: 'Alpha' };
    nodes[3] = { ...nodes[3]!, question: 'needle in here' };
    const f = filterKeepAncestors(nodes, 'NEEDLE')!;
    expect([...f.visible].sort()).toEqual(['a', 'a2', 'r']);
    expect([...f.matches]).toEqual(['a2']);
    const rows = buildRows(nodes, f);
    expect(rows.map((r) => r.node.id)).toEqual(['r', 'a', 'a2']);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2]);
    expect(buildRows(nodes).map((r) => r.node.id)).toEqual(['r', 'a', 'b']); // collapsed hides a1, a2
    expect(filterKeepAncestors(nodes, '  ')).toBeNull();
    expect(buildRows(nodes, filterKeepAncestors(nodes, 'zzz'))).toEqual([]);
  });
});

describe('graph view model', () => {
  it('computes the root path and descendant counts', () => {
    const nodes = tree();
    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect([...pathIds(byId, 'a2')]).toEqual(['a2', 'a', 'r']);
    expect(pathIds(byId, null).size).toBe(0);
    const d = descendantCounts(nodes);
    expect(d.get('r')).toBe(4);
    expect(d.get('a')).toBe(2);
    expect(d.get('b')).toBe(0);
  });
  it('maps arrow keys by tree direction', () => {
    const nodes = tree();
    expect(neighborFor('ArrowLeft', nodes, 'a', true)).toBe('r');
    expect(neighborFor('ArrowRight', nodes, 'a', true)).toBe('a1');
    expect(neighborFor('ArrowDown', nodes, 'a1', true)).toBe('a2');
    expect(neighborFor('ArrowUp', nodes, 'a1', true)).toBeNull();
    expect(neighborFor('ArrowDown', nodes, 'r', false)).toBe('a');
    expect(neighborFor('ArrowRight', nodes, 'a', false)).toBe('b');
    expect(neighborFor('ArrowUp', nodes, 'a', false)).toBe('r');
    expect(neighborFor('ArrowDown', nodes, null, true)).toBe('r');
    const collapsed = nodes.map((n) => (n.id === 'a' ? { ...n, collapsed: true } : n));
    expect(neighborFor('ArrowRight', collapsed, 'a', true)).toBeNull();
  });
  it('derives card state and preview text', () => {
    expect(cardState({ answeredAt: null }, undefined)).toBe('unexplored');
    expect(cardState({ answeredAt: 5 }, undefined)).toBe('answered');
    expect(cardState({ answeredAt: 5 }, 'streaming')).toBe('streaming');
    expect(cardPreview('unexplored', '').text).toBe('Not asked yet');
    expect(cardPreview('pending', '').text).toBe('Waiting for ChatGPT…');
    expect(cardPreview('streaming', '').text).toBe('Generating…');
    expect(cardPreview('failed', '').text).toMatch(/open to retry/);
    expect(cardPreview('answered', ' The answer ').text).toBe('The answer');
  });
  it('lays out cards without overlap', () => {
    const pos = computeCardLayout(tree(), 'LR');
    expect(pos.size).toBe(5);
    expect(pos.get('a')!.x).toBeGreaterThanOrEqual(pos.get('r')!.x + CARD_WIDTH);
  });
});

describe('hints', () => {
  it('shows one hint at a time in teaching order', () => {
    const none = new Set<string>();
    expect(pickHint([], null, none)).toBeNull();
    expect(pickHint([{ answeredAt: null }], null, none)).toBe('select-node');
    expect(pickHint([{ answeredAt: null }], 'x', none)).toBeNull();
    expect(pickHint([{ answeredAt: 1 }], 'x', new Set(['select-node']))).toBe('branch-from-text');
    expect(pickHint([{ answeredAt: 1 }], 'x', new Set(['select-node', 'branch-from-text']))).toBeNull();
    expect(HINT_TEXT['branch-from-text']).toMatch(/highlight/);
  });
});

describe('misc ui helpers', () => {
  it('positions floating boxes inside the viewport and flips when needed', () => {
    const vp = { width: 800, height: 600 };
    const below = computePosition({ x: 100, y: 100, width: 40, height: 20 }, { width: 100, height: 50 }, 'bottom', vp);
    expect(below.y).toBe(126);
    const flipped = computePosition({ x: 100, y: 560, width: 40, height: 20 }, { width: 100, height: 100 }, 'bottom', vp);
    expect(flipped.placement).toBe('top');
    const clamped = computePosition({ x: 790, y: 100, width: 10, height: 10 }, { width: 200, height: 50 }, 'bottom', vp);
    expect(clamped.x).toBe(800 - 200 - 8);
  });
  it('formats relative time', () => {
    const now = 1_000_000_000;
    expect(relativeTime(now - 5_000, now)).toBe('just now');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5m ago');
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2d ago');
  });
  it('summarizes provider status', () => {
    expect(summarizeProvider(null, true).pill).toBe('Manual mode');
    expect(summarizeProvider(null, false).pill).toBe('Checking…');
    const base = { tabOpen: true, scriptReady: true, loggedOutHint: false, generating: false, queued: 0 } as unknown as NonNullable<Parameters<typeof summarizeProvider>[0]>;
    expect(summarizeProvider({ ...base, tabOpen: false }, false).needsOpen).toBe(true);
    expect(summarizeProvider({ ...base, scriptReady: false }, false).pill).toBe('Reload ChatGPT');
    expect(summarizeProvider(base, false).tone).toBe('ok');
  });
});

import { pickHint as pickHint2 } from '@/features/graph/ui/hints';
describe('branch hint retires once the user has branched from a passage', () => {
  it('stops suggesting highlight-to-branch after a passage branch exists', () => {
    const answered = { answeredAt: 1, sourcePassage: null };
    expect(pickHint2([answered], 'x', new Set())).toBe('branch-from-text');
    expect(pickHint2([answered, { answeredAt: null, sourcePassage: 'quoted text' }], 'x', new Set())).toBeNull();
  });
});
