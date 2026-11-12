import dagre from '@dagrejs/dagre';
import { childrenIndex } from '@/features/graph/graphOps';
import type { GraphNode, ID, Position } from '@/types';

/** Pure view-model helpers for the graph UI (no React, no DB). */

/** Card size used by the redesigned node. Layout in this file uses it instead of layout.ts's legacy 260x84. */
export const CARD_WIDTH = 280;
export const CARD_HEIGHT = 100;

/** Dagre layout sized for the redesigned cards, with spacing tuned for wide and deep trees. */
export function computeCardLayout(nodes: readonly GraphNode[], direction: 'TB' | 'LR' = 'LR'): Map<ID, Position> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: direction,
    nodesep: direction === 'LR' ? 20 : 36,
    ranksep: direction === 'LR' ? 80 : 64,
    marginx: 24,
    marginy: 24,
  });
  g.setDefaultEdgeLabel(() => ({}));
  const ids = new Set(nodes.map((n) => n.id));
  const sorted = [...nodes].sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
  for (const n of sorted) g.setNode(n.id, { width: CARD_WIDTH, height: CARD_HEIGHT });
  for (const n of sorted) if (n.parentId && ids.has(n.parentId)) g.setEdge(n.parentId, n.id);
  dagre.layout(g);
  const out = new Map<ID, Position>();
  for (const n of sorted) {
    const p = g.node(n.id) as { x: number; y: number } | undefined;
    if (p) out.set(n.id, { x: p.x - CARD_WIDTH / 2, y: p.y - CARD_HEIGHT / 2 });
  }
  return out;
}

/** Ids on the root -> node path, inclusive. Empty set when id is null/unknown. */
export function pathIds(byId: ReadonlyMap<ID, GraphNode>, id: ID | null): Set<ID> {
  const out = new Set<ID>();
  let cur = id ? byId.get(id) : undefined;
  while (cur && !out.has(cur.id)) {
    out.add(cur.id);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return out;
}

/** Number of descendants (not just children) of each node. */
export function descendantCounts(nodes: readonly GraphNode[]): Map<ID, number> {
  const idx = childrenIndex(nodes);
  const counts = new Map<ID, number>();
  const visit = (n: GraphNode, guard: Set<ID>): number => {
    if (guard.has(n.id)) return 0;
    guard.add(n.id);
    let total = 0;
    for (const c of idx.get(n.id) ?? []) total += 1 + visit(c, guard);
    counts.set(n.id, total);
    return total;
  };
  const guard = new Set<ID>();
  for (const r of idx.get(null) ?? []) visit(r, guard);
  return counts;
}

export type NavKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';

/**
 * Which node an arrow key moves to. Along the tree axis: toward the parent / first child.
 * Across it: previous / next sibling. `horizontal` = ranks run left-to-right.
 * Collapsed children are not navigable (they are hidden): pass only visible nodes.
 */
export function neighborFor(key: NavKey, visible: readonly GraphNode[], fromId: ID | null, horizontal: boolean): ID | null {
  const idx = childrenIndex(visible);
  if (!fromId) return idx.get(null)?.[0]?.id ?? null;
  const cur = visible.find((n) => n.id === fromId);
  if (!cur) return idx.get(null)?.[0]?.id ?? null;
  const toParent = horizontal ? 'ArrowLeft' : 'ArrowUp';
  const toChild = horizontal ? 'ArrowRight' : 'ArrowDown';
  const toPrev = horizontal ? 'ArrowUp' : 'ArrowLeft';
  const toNext = horizontal ? 'ArrowDown' : 'ArrowRight';
  if (key === toParent) return cur.parentId ?? null;
  if (key === toChild) {
    if (cur.collapsed) return null;
    return idx.get(cur.id)?.[0]?.id ?? null;
  }
  const sibs = idx.get(cur.parentId) ?? [];
  const i = sibs.findIndex((s) => s.id === cur.id);
  if (key === toPrev) return sibs[i - 1]?.id ?? null;
  if (key === toNext) return sibs[i + 1]?.id ?? null;
  return null;
}

export type CardState = 'unexplored' | 'pending' | 'streaming' | 'failed' | 'answered';

/** What a node card should say about itself. `status` comes from live provider requests. */
export function cardState(node: Pick<GraphNode, 'answeredAt'>, status: 'pending' | 'streaming' | 'failed' | undefined): CardState {
  if (status === 'streaming') return 'streaming';
  if (status === 'pending') return 'pending';
  if (status === 'failed') return 'failed';
  return node.answeredAt ? 'answered' : 'unexplored';
}

export function cardPreview(state: CardState, answerPreview: string): { text: string; muted: boolean } {
  switch (state) {
    case 'streaming':
      return { text: 'Generating…', muted: true };
    case 'pending':
      return { text: 'Waiting for ChatGPT…', muted: true };
    case 'failed':
      return { text: 'Failed — open to retry', muted: false };
    case 'answered':
      return { text: answerPreview.trim() || 'Answered', muted: true };
    default:
      return { text: 'Not asked yet', muted: true };
  }
}
