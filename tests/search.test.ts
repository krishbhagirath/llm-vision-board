import { describe, expect, it } from 'vitest';
import { db } from '@/storage/db';
import { createWorkspace } from '@/features/workspaces/workspaceOps';
import { createNode } from '@/features/graph/graphOps';
import { search } from '@/features/search/search';
import { addMessage } from './helpers';

async function setup() {
  const w1 = await createWorkspace('Alpha WS');
  const w2 = await createWorkspace('Beta WS');
  const n1 = await createNode({ workspaceId: w1.id, title: 'Quantum entanglement', question: 'What is entanglement?' });
  const n2 = await createNode({ workspaceId: w1.id, title: 'Classical mechanics', question: 'Newton laws' });
  const n3 = await createNode({ workspaceId: w2.id, title: 'Quantum computing', question: 'qubits?' });
  await addMessage(n2.id, 'assistant', 'Superposition is discussed here, a very UNIQUEWORD answer');
  await addMessage(n3.id, 'assistant', 'Another uniqueword in beta');
  return { w1, w2, n1, n2, n3 };
}

describe('search', () => {
  it('finds nodes by title (case-insensitive) across all workspaces', async () => {
    const { n1, n3 } = await setup();
    const hits = await search('QUANTUM');
    expect(hits.map((h) => h.nodeId).sort()).toEqual([n1.id, n3.id].sort());
    expect(hits.every((h) => h.kind === 'node')).toBe(true);
    expect(hits.find((h) => h.nodeId === n3.id)!.workspaceName).toBe('Beta WS');
  });

  it('finds nodes by question text', async () => {
    const { n2 } = await setup();
    const hits = await search('newton');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.nodeId).toBe(n2.id);
    expect(hits[0]!.snippet).toContain('Newton laws');
  });

  it('finds messages by content and reports the owning node', async () => {
    const { n2, n3 } = await setup();
    const hits = await search('uniqueword');
    expect(hits.map((h) => h.nodeId).sort()).toEqual([n2.id, n3.id].sort());
    expect(hits.every((h) => h.kind === 'message')).toBe(true);
    expect(hits.find((h) => h.nodeId === n2.id)!.snippet.toLowerCase()).toContain('uniqueword');
  });

  it('scopes to one workspace when workspaceId is given', async () => {
    const { w1, w2, n1, n2, n3 } = await setup();
    const q1 = await search('quantum', { workspaceId: w1.id });
    expect(q1.map((h) => h.nodeId)).toEqual([n1.id]);
    const u2 = await search('uniqueword', { workspaceId: w2.id });
    expect(u2.map((h) => h.nodeId)).toEqual([n3.id]);
    const u1 = await search('uniqueword', { workspaceId: w1.id });
    expect(u1.map((h) => h.nodeId)).toEqual([n2.id]);
  });

  it('requires at least 2 characters', async () => {
    await setup();
    expect(await search('')).toEqual([]);
    expect(await search(' q ')).toEqual([]);
    expect(await search('q')).toEqual([]);
    expect((await search('qu')).length).toBeGreaterThan(0);
  });

  it('ranks title-prefix matches first and respects limit', async () => {
    const w = await createWorkspace('R');
    await createNode({ workspaceId: w.id, title: 'About graphs', question: 'x' });
    const prefix = await createNode({ workspaceId: w.id, title: 'Graphs 101', question: 'x' });
    const hits = await search('graphs');
    expect(hits[0]!.nodeId).toBe(prefix.id);
    expect(await search('graphs', { limit: 1 })).toHaveLength(1);
  });

  it('does not report messages whose conversation node was deleted', async () => {
    const { n2 } = await setup();
    await db.nodes.delete(n2.id);
    expect(await search('uniqueword')).toHaveLength(1);
  });
});
