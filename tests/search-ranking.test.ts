import { describe, expect, it } from 'vitest';
import { createWorkspace } from '@/features/workspaces/workspaceOps';
import { createNode, updateNode } from '@/features/graph/graphOps';
import { compareHits, highlightRanges, matchKind, scoreAnswer, scoreNode, scoreWorkspaceName, search, SCORE } from '@/features/search/search';
import { db } from '@/storage/db';
import { addMessage } from './helpers';

describe('matchKind', () => {
  it('distinguishes prefix, word-start and substring (case-insensitive)', () => {
    expect(matchKind('Graph theory', 'GRAPH')).toBe('prefix');
    expect(matchKind('Intro to graph theory', 'graph')).toBe('word');
    expect(matchKind('Paragraphs', 'graph')).toBe('sub');
    expect(matchKind('Nothing', 'graph')).toBeNull();
  });
  it('requires every word for multi-word queries', () => {
    expect(matchKind('Gradient descent explained', 'descent gradient')).toBe('word');
    expect(matchKind('Gradient only', 'gradient descent')).toBeNull();
  });
});

describe('scoring', () => {
  it('orders title prefix > title word > title substring > question > summary > answer', () => {
    const f = (title: string, question = '', summary = '') => scoreNode({ title, question, summary }, 'graph')!.score;
    const order = [f('Graphs 101'), f('About graphs'), f('Paragraphs'), f('x', 'graphs?'), f('x', 'about graphs'), f('x', 'a paragraph'), f('x', '', 'graph')];
    for (let i = 1; i < order.length; i++) expect(order[i - 1]!).toBeGreaterThanOrEqual(order[i]!);
    expect(f('Graphs 101')).toBe(SCORE.titlePrefix);
    expect(f('About graphs')).toBe(SCORE.titleWord);
    expect(f('Paragraphs')).toBe(SCORE.titleSub);
    expect(f('x', 'graphs?')).toBe(SCORE.questionPrefix);
    expect(scoreAnswer('some graph answer', 'graph')).toBeLessThan(SCORE.summary);
  });
  it('ranks workspace names', () => {
    expect(scoreWorkspaceName('Graph lab', 'graph')).toBe(SCORE.workspacePrefix);
    expect(scoreWorkspaceName('My graph lab', 'graph')).toBe(SCORE.workspaceWord);
    expect(scoreWorkspaceName('Other', 'graph')).toBe(0);
  });
  it('breaks ties by recency', () => {
    expect(compareHits({ score: 5, updatedAt: 2 }, { score: 5, updatedAt: 1 })).toBeLessThan(0);
    expect(compareHits({ score: 6, updatedAt: 1 }, { score: 5, updatedAt: 9 })).toBeLessThan(0);
  });
});

describe('highlightRanges', () => {
  it('finds and merges ranges', () => {
    expect(highlightRanges('Hello hello world', 'hello')).toEqual([
      [0, 5],
      [6, 11],
    ]);
    expect(highlightRanges('big red dog', 'dog big')).toEqual([
      [0, 3],
      [8, 11],
    ]);
    expect(highlightRanges('abc', '')).toEqual([]);
  });
});

describe('search ranking end-to-end', () => {
  it('ranks title above question above answer matches', async () => {
    const w = await createWorkspace('Ranking');
    const ans = await createNode({ workspaceId: w.id, title: 'Alpha', question: 'unrelated' });
    await addMessage(ans.id, 'assistant', 'the word entropy appears in this answer');
    const q = await createNode({ workspaceId: w.id, title: 'Beta', question: 'what is entropy?' });
    const t = await createNode({ workspaceId: w.id, title: 'Entropy basics', question: 'zzz' });
    const hits = await search('entropy', { workspaceId: w.id });
    expect(hits.map((h) => h.nodeId)).toEqual([t.id, q.id, ans.id]);
    expect(hits.map((h) => h.field)).toEqual(['title', 'question', 'answer']);
  });

  it('breaks ties by most recently updated', async () => {
    const w = await createWorkspace('Ties');
    const older = await createNode({ workspaceId: w.id, title: 'Cache one', question: 'a' });
    const newer = await createNode({ workspaceId: w.id, title: 'Cache two', question: 'b' });
    await db.nodes.update(older.id, { updatedAt: 1000 });
    await db.nodes.update(newer.id, { updatedAt: 5000 });
    const hits = await search('cache', { workspaceId: w.id });
    expect(hits.map((h) => h.nodeId)).toEqual([newer.id, older.id]);
  });

  it('returns workspace-name matches only when not scoped to a workspace', async () => {
    const a = await createWorkspace('Quantum lab');
    await createWorkspace('Other');
    const all = await search('quantum');
    expect(all.some((h) => h.kind === 'workspace' && h.workspaceId === a.id)).toBe(true);
    const scoped = await search('quantum', { workspaceId: a.id });
    expect(scoped.some((h) => h.kind === 'workspace')).toBe(false);
  });

  it('only reports assistant answers (one best per node) and supports summary matches', async () => {
    const w = await createWorkspace('Msgs');
    const n = await createNode({ workspaceId: w.id, title: 'Node', question: 'q' });
    await updateNode(n.id, { summary: 'covers photosynthesis in depth' });
    await addMessage(n.id, 'user', 'photosynthesis please');
    await addMessage(n.id, 'assistant', 'photosynthesis one');
    await addMessage(n.id, 'assistant', 'photosynthesis two');
    const hits = await search('photosynthesis', { workspaceId: w.id });
    expect(hits.filter((h) => h.kind === 'message')).toHaveLength(1);
    expect(hits.find((h) => h.kind === 'node')!.field).toBe('summary');
  });
});
