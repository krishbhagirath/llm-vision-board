import { db } from '@/storage/db';
import { truncate } from '@/lib/id';
import { stripMarkdown } from '@/features/context/contextBuilder';
import type { ID } from '@/types';

export type SearchField = 'title' | 'question' | 'summary' | 'answer' | 'workspace';

export interface SearchHit {
  workspaceId: ID;
  workspaceName: string;
  /** For workspace hits this is the workspace's selected node (or ''); use `kind` to tell them apart. */
  nodeId: ID;
  nodeTitle: string;
  kind: 'node' | 'message' | 'workspace';
  /** Which field matched best. */
  field: SearchField;
  snippet: string;
  score: number;
  /** Recency (ms) used as the tie-break; newer first. */
  updatedAt: number;
}

/** Score bands. A higher band always beats a lower one; recency only breaks ties inside a band. */
export const SCORE = {
  titlePrefix: 100,
  titleWord: 80,
  titleSub: 60,
  questionPrefix: 48,
  questionWord: 40,
  questionSub: 32,
  summary: 20,
  answerWord: 12,
  answerSub: 8,
  workspacePrefix: 90,
  workspaceWord: 70,
  workspaceSub: 50,
} as const;

export function tokenize(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

function isWordStart(lower: string, index: number): boolean {
  return index === 0 || /[^\p{L}\p{N}]/u.test(lower[index - 1]!);
}

export type MatchKind = 'prefix' | 'word' | 'sub' | null;

/** How well `text` matches `query`: prefix of the whole text > start of a word > anywhere. Multi-word queries need every word. */
export function matchKind(text: string, query: string): MatchKind {
  const lower = text.toLowerCase();
  const q = query.trim().toLowerCase();
  if (!q) return null;
  if (lower.startsWith(q)) return 'prefix';
  let i = lower.indexOf(q);
  let best: MatchKind = null;
  while (i >= 0) {
    if (isWordStart(lower, i)) return 'word';
    best = 'sub';
    i = lower.indexOf(q, i + 1);
  }
  if (best) return best;
  const tokens = tokenize(q);
  if (tokens.length < 2) return null;
  // Every word must appear; the weakest word decides.
  let weakest: MatchKind = 'word';
  for (const t of tokens) {
    const k = matchKind(lower, t);
    if (!k) return null;
    if (k === 'sub') weakest = 'sub';
  }
  return weakest;
}

function pick(kind: MatchKind, p: number, w: number, s: number): number {
  return kind === 'prefix' ? p : kind === 'word' ? w : kind === 'sub' ? s : 0;
}

/** Score a node from its fields. Title beats question beats summary. Returns the best field. */
export function scoreNode(fields: { title: string; question: string; summary: string }, query: string): { score: number; field: SearchField } | null {
  const t = matchKind(fields.title, query);
  if (t) return { score: pick(t, SCORE.titlePrefix, SCORE.titleWord, SCORE.titleSub), field: 'title' };
  const q = matchKind(fields.question, query);
  if (q) return { score: pick(q, SCORE.questionPrefix, SCORE.questionWord, SCORE.questionSub), field: 'question' };
  if (matchKind(fields.summary, query)) return { score: SCORE.summary, field: 'summary' };
  return null;
}

export function scoreWorkspaceName(name: string, query: string): number {
  return pick(matchKind(name, query), SCORE.workspacePrefix, SCORE.workspaceWord, SCORE.workspaceSub);
}

export function scoreAnswer(content: string, query: string): number {
  const k = matchKind(content, query);
  return k ? (k === 'sub' ? SCORE.answerSub : SCORE.answerWord) : 0;
}

/** Order: score desc, then recency desc. */
export function compareHits(a: Pick<SearchHit, 'score' | 'updatedAt'>, b: Pick<SearchHit, 'score' | 'updatedAt'>): number {
  return b.score - a.score || b.updatedAt - a.updatedAt;
}

/** Character ranges of every query word inside `text` (for highlighting). Sorted, non-overlapping. */
export function highlightRanges(text: string, query: string): Array<[number, number]> {
  const lower = text.toLowerCase();
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const terms = lower.includes(q) ? [q] : tokenize(q);
  const ranges: Array<[number, number]> = [];
  for (const t of terms) {
    let i = lower.indexOf(t);
    while (i >= 0) {
      ranges.push([i, i + t.length]);
      i = lower.indexOf(t, i + t.length);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

function snippetAround(text: string, query: string, radius = 70): string {
  const flat = text.replace(/\s+/g, ' ');
  const lower = flat.toLowerCase();
  const q = query.trim().toLowerCase();
  let i = lower.indexOf(q);
  let len = q.length;
  if (i < 0) {
    const first = tokenize(q)
      .map((t) => ({ t, i: lower.indexOf(t) }))
      .filter((x) => x.i >= 0)
      .sort((a, b) => a.i - b.i)[0];
    if (!first) return truncate(flat, radius * 2);
    i = first.i;
    len = first.t.length;
  }
  const start = Math.max(0, i - radius);
  const end = i + len + radius;
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}

const MIN_QUERY = 2;

/**
 * Ranked search over node titles/questions/summaries, saved assistant answers and (when not scoped
 * to one workspace) workspace names. Ranking: title prefix > title word-start > title substring >
 * question > summary > answer; ties go to the most recently updated item.
 */
export async function search(query: string, opts: { workspaceId?: ID | null; limit?: number } = {}): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase();
  if (q.length < MIN_QUERY) return [];
  const limit = opts.limit ?? 50;
  const workspaces = await db.workspaces.toArray();
  const wsName = new Map(workspaces.map((w) => [w.id, w.name]));
  const nodes = opts.workspaceId ? await db.nodes.where('workspaceId').equals(opts.workspaceId).toArray() : await db.nodes.toArray();
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const hits: SearchHit[] = [];

  if (!opts.workspaceId) {
    for (const w of workspaces) {
      const score = scoreWorkspaceName(w.name, q);
      if (!score) continue;
      hits.push({
        workspaceId: w.id,
        workspaceName: w.name,
        nodeId: w.selectedNodeId ?? '',
        nodeTitle: w.name,
        kind: 'workspace',
        field: 'workspace',
        snippet: w.description ? truncate(w.description, 140) : '',
        score,
        updatedAt: w.updatedAt,
      });
    }
  }

  for (const n of nodes) {
    const m = scoreNode(n, q);
    if (!m) continue;
    hits.push({
      workspaceId: n.workspaceId,
      workspaceName: wsName.get(n.workspaceId) ?? '',
      nodeId: n.id,
      nodeTitle: n.title,
      kind: 'node',
      field: m.field,
      snippet: snippetAround(m.field === 'summary' ? n.summary : n.question || n.title, q),
      score: m.score,
      updatedAt: n.updatedAt,
    });
  }

  const convs = opts.workspaceId ? await db.conversations.where('workspaceId').equals(opts.workspaceId).toArray() : await db.conversations.toArray();
  const convNode = new Map(convs.map((c) => [c.id, c.nodeId]));
  const msgColl = opts.workspaceId ? db.messages.where('workspaceId').equals(opts.workspaceId) : db.messages.toCollection();
  const tokens = tokenize(q);
  const msgs = await msgColl
    .filter((m) => {
      if (m.role !== 'assistant') return false;
      const c = m.content.toLowerCase();
      return c.includes(q) || (tokens.length > 1 && tokens.every((t) => c.includes(t)));
    })
    .limit(limit * 3)
    .toArray();
  // Best message per node.
  const bestByNode = new Map<ID, { score: number; m: (typeof msgs)[number] }>();
  for (const m of msgs) {
    const nodeId = convNode.get(m.conversationId);
    if (!nodeId || !nodeById.has(nodeId)) continue;
    const score = scoreAnswer(m.content, q);
    if (!score) continue;
    const prev = bestByNode.get(nodeId);
    if (!prev || score > prev.score || (score === prev.score && m.updatedAt > prev.m.updatedAt)) bestByNode.set(nodeId, { score, m });
  }
  for (const [nodeId, { score, m }] of bestByNode) {
    const node = nodeById.get(nodeId)!;
    hits.push({
      workspaceId: node.workspaceId,
      workspaceName: wsName.get(node.workspaceId) ?? '',
      nodeId,
      nodeTitle: node.title,
      kind: 'message',
      field: 'answer',
      snippet: snippetAround(stripMarkdown(m.content), q),
      score,
      updatedAt: m.updatedAt,
    });
  }
  return hits.sort(compareHits).slice(0, limit);
}
