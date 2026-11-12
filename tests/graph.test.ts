import { describe, it, expect } from 'vitest';
import { db } from '@/storage/db';
import { createWorkspace, setLayout } from '@/features/workspaces/workspaceOps';
import {
  GraphError,
  addLink,
  ancestorChain,
  collectSubtree,
  createNode,
  deleteSubtree,
  deriveTitle,
  getWorkspaceNodes,
  moveNode,
  removeEdge,
  restoreBundle,
  toggleCollapsed,
  updateNode,
  visibleNodes,
  wouldCreateCycle,
} from '@/features/graph/graphOps';
import { computeTreeLayout } from '@/features/graph/layout';
import { newId } from '@/lib/id';
import { addMessage, seedTree } from './helpers';

describe('createNode', () => {
  it('creates a root node without an edge', async () => {
    const ws = await createWorkspace('A');
    const n = await createNode({ workspaceId: ws.id, question: 'Why is the sky blue?' });
    expect(n.parentId).toBeNull();
    expect(n.type).toBe('topic');
    expect(n.title).toBe('Why is the sky blue');
    expect(n.order).toBe(0);
    expect(await db.edges.count()).toBe(0);
    const n2 = await createNode({ workspaceId: ws.id, title: 'Second root' });
    expect(n2.order).toBe(1);
  });

  it('creates a child with a child edge and incrementing order', async () => {
    const ws = await createWorkspace('A');
    const root = await createNode({ workspaceId: ws.id, title: 'R' });
    const a = await createNode({ workspaceId: ws.id, parentId: root.id, title: 'a' });
    const b = await createNode({ workspaceId: ws.id, parentId: root.id, title: 'b' });
    expect(a.type).toBe('question');
    expect([a.order, b.order]).toEqual([0, 1]);
    const edges = await db.edges.toArray();
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.type === 'child' && e.source === root.id)).toBe(true);
    expect(edges.map((e) => e.target).sort()).toEqual([a.id, b.id].sort());
  });

  it('rejects missing parent and parent from another workspace', async () => {
    const w1 = await createWorkspace('1');
    const w2 = await createWorkspace('2');
    const r = await createNode({ workspaceId: w1.id, title: 'r' });
    await expect(createNode({ workspaceId: w1.id, parentId: 'nope' })).rejects.toBeInstanceOf(GraphError);
    await expect(createNode({ workspaceId: w2.id, parentId: r.id })).rejects.toBeInstanceOf(GraphError);
  });

  it('expands a collapsed parent when adding a child', async () => {
    const { root } = await seedTree();
    await toggleCollapsed(root.id);
    expect((await db.nodes.get(root.id))!.collapsed).toBe(true);
    await createNode({ workspaceId: root.workspaceId, parentId: root.id, title: 'x' });
    expect((await db.nodes.get(root.id))!.collapsed).toBe(false);
  });
});

describe('deriveTitle', () => {
  it('handles empty, punctuation, whitespace and long input', () => {
    expect(deriveTitle('   ')).toBe('Untitled');
    expect(deriveTitle('  What   is   it?? ')).toBe('What is it');
    const t = deriveTitle('x'.repeat(200));
    expect(t.length).toBeLessThanOrEqual(60);
    expect(t.endsWith('…')).toBe(true);
  });
});

describe('updateNode', () => {
  it('patches fields, bumps updatedAt and ignores blank titles', async () => {
    const { root } = await seedTree();
    const u = await updateNode(root.id, { title: '  New  ', summary: 'S' });
    expect(u.title).toBe('New');
    expect(u.summary).toBe('S');
    expect(u.updatedAt).toBeGreaterThanOrEqual(root.updatedAt);
    const u2 = await updateNode(root.id, { title: '   ' });
    expect(u2.title).toBe('New');
    await expect(updateNode('missing', { title: 'x' })).rejects.toBeInstanceOf(GraphError);
  });
});

describe('deleteSubtree / restoreBundle', () => {
  it('removes descendants, edges, conversations, messages and cancels active requests; restore undoes it', async () => {
    const { ws, root, child, grand } = await seedTree();
    await addMessage(child.id, 'user', 'q');
    await addMessage(grand.id, 'assistant', 'a');
    await addMessage(root.id, 'assistant', 'keep me');
    const rootConv = (await db.nodes.get(root.id))!.conversationId!;
    const grandConv = (await db.nodes.get(grand.id))!.conversationId!;
    await db.requests.add({
      id: 'r1', workspaceId: ws.id, nodeId: grand.id, conversationId: grandConv, userMessageId: 'u', assistantMessageId: 'a',
      provider: 'chatgpt-web', prompt: 'p', targetUrl: null, status: 'streaming', error: null, tabId: 1, attempt: 1,
      createdAt: 1, updatedAt: 1, lastActivityAt: 1,
    });

    const bundle = await deleteSubtree(child.id);
    expect(bundle.nodes.map((n) => n.id).sort()).toEqual([child.id, grand.id].sort());
    expect(await db.nodes.count()).toBe(1);
    expect(await db.edges.count()).toBe(0);
    expect(await db.conversations.count()).toBe(1);
    const left = await db.messages.toArray();
    expect(left).toHaveLength(1);
    expect(left[0]!.conversationId).toBe(rootConv);
    expect((await db.requests.get('r1'))!.status).toBe('cancelled');

    await restoreBundle(bundle);
    expect(await db.nodes.count()).toBe(3);
    expect(await db.edges.count()).toBe(2);
    expect(await db.conversations.count()).toBe(3);
    expect(await db.messages.count()).toBe(3);
  });

  it('removes link edges that touch deleted nodes', async () => {
    const { ws, child } = await seedTree();
    const other = await createNode({ workspaceId: ws.id, title: 'other' });
    await addLink(ws.id, other.id, child.id);
    await deleteSubtree(child.id);
    const edges = await db.edges.toArray();
    expect(edges.some((e) => e.source === child.id || e.target === child.id)).toBe(false);
  });

  it('throws for unknown node', async () => {
    await expect(deleteSubtree('nope')).rejects.toBeInstanceOf(GraphError);
  });
});

describe('moveNode', () => {
  it('reparents and replaces the child edge', async () => {
    const ws = await createWorkspace('M');
    const r = await createNode({ workspaceId: ws.id, title: 'r' });
    const a = await createNode({ workspaceId: ws.id, parentId: r.id, title: 'a' });
    const b = await createNode({ workspaceId: ws.id, parentId: r.id, title: 'b' });
    const moved = await moveNode(b.id, a.id);
    expect(moved.parentId).toBe(a.id);
    const edges = await db.edges.where('target').equals(b.id).toArray();
    expect(edges).toHaveLength(1);
    expect(edges[0]!.source).toBe(a.id);
    await moveNode(b.id, null);
    expect(await db.edges.where('target').equals(b.id).count()).toBe(0);
    expect((await db.nodes.get(b.id))!.parentId).toBeNull();
  });

  it('rejects self and descendant moves with GraphError', async () => {
    const { root, child, grand } = await seedTree();
    await expect(moveNode(root.id, root.id)).rejects.toBeInstanceOf(GraphError);
    await expect(moveNode(root.id, child.id)).rejects.toBeInstanceOf(GraphError);
    await expect(moveNode(root.id, grand.id)).rejects.toBeInstanceOf(GraphError);
    expect((await db.nodes.get(root.id))!.parentId).toBeNull();
  });
});

describe('pure graph helpers', () => {
  it('wouldCreateCycle / collectSubtree / ancestorChain', async () => {
    const { root, child, grand, ws } = await seedTree();
    const nodes = await getWorkspaceNodes(ws.id);
    expect(collectSubtree(nodes, root.id).sort()).toEqual([root.id, child.id, grand.id].sort());
    expect(collectSubtree(nodes, grand.id)).toEqual([grand.id]);
    expect(wouldCreateCycle(nodes, root.id, null)).toBe(false);
    expect(wouldCreateCycle(nodes, child.id, child.id)).toBe(true);
    expect(wouldCreateCycle(nodes, root.id, grand.id)).toBe(true);
    expect(wouldCreateCycle(nodes, grand.id, root.id)).toBe(false);
    expect(ancestorChain(nodes, grand.id).map((n) => n.id)).toEqual([root.id, child.id]);
    expect(ancestorChain(nodes, root.id)).toEqual([]);
  });

  it('visibleNodes hides descendants of collapsed nodes but keeps the collapsed node', async () => {
    const { root, child, ws } = await seedTree();
    await toggleCollapsed(child.id);
    expect(visibleNodes(await getWorkspaceNodes(ws.id)).map((n) => n.id).sort()).toEqual([root.id, child.id].sort());
    await toggleCollapsed(root.id);
    expect(visibleNodes(await getWorkspaceNodes(ws.id)).map((n) => n.id)).toEqual([root.id]);
  });
});

describe('links and edges', () => {
  it('addLink dedupes and rejects self / cross-workspace', async () => {
    const { ws, root, grand } = await seedTree();
    const w2 = await createWorkspace('other');
    const foreign = await createNode({ workspaceId: w2.id, title: 'f' });
    const e1 = await addLink(ws.id, root.id, grand.id, 'rel');
    const e2 = await addLink(ws.id, root.id, grand.id);
    expect(e2.id).toBe(e1.id);
    expect(await db.edges.filter((e) => e.type === 'link').count()).toBe(1);
    await expect(addLink(ws.id, root.id, root.id)).rejects.toBeInstanceOf(GraphError);
    await expect(addLink(ws.id, root.id, foreign.id)).rejects.toBeInstanceOf(GraphError);
    await expect(addLink(ws.id, root.id, newId())).rejects.toBeInstanceOf(GraphError);
  });

  it('removeEdge removes links but rejects child edges', async () => {
    const { ws, root, grand } = await seedTree();
    const link = await addLink(ws.id, root.id, grand.id);
    await removeEdge(link.id);
    expect(await db.edges.get(link.id)).toBeUndefined();
    const child = (await db.edges.filter((e) => e.type === 'child').first())!;
    await expect(removeEdge(child.id)).rejects.toBeInstanceOf(GraphError);
    expect(await db.edges.get(child.id)).toBeDefined();
  });
});

describe('layout', () => {
  it('setLayout keeps nodes/edges/messages unchanged', async () => {
    const { ws, child } = await seedTree();
    await addMessage(child.id, 'user', 'hello');
    const snap = async () =>
      JSON.stringify([
        (await db.nodes.toArray()).sort((a, b) => a.id.localeCompare(b.id)),
        (await db.edges.toArray()).sort((a, b) => a.id.localeCompare(b.id)),
        (await db.messages.toArray()).sort((a, b) => a.id.localeCompare(b.id)),
      ]);
    const before = await snap();
    for (const mode of ['board', 'outline', 'chat', 'tree'] as const) {
      await setLayout(ws.id, mode);
      expect((await db.workspaces.get(ws.id))!.layout).toBe(mode);
    }
    expect(await snap()).toBe(before);
  });

  it('computeTreeLayout positions every node with parents ranked before children', async () => {
    const { ws, root, child, grand } = await seedTree();
    const extra = await createNode({ workspaceId: ws.id, parentId: root.id, title: 'sib' });
    const nodes = await getWorkspaceNodes(ws.id);
    const lr = computeTreeLayout(nodes, 'LR');
    expect(lr.size).toBe(nodes.length);
    expect(lr.get(root.id)!.x).toBeLessThan(lr.get(child.id)!.x);
    expect(lr.get(child.id)!.x).toBeLessThan(lr.get(grand.id)!.x);
    expect(lr.get(extra.id)!.x).toBeGreaterThan(lr.get(root.id)!.x);
    const tb = computeTreeLayout(nodes, 'TB');
    expect(tb.get(root.id)!.y).toBeLessThan(tb.get(child.id)!.y);
    expect(tb.get(child.id)!.y).toBeLessThan(tb.get(grand.id)!.y);
    expect((await db.nodes.get(root.id))!.position).toEqual(root.position);
  });
});
