import { db } from '@/storage/db';
import { newId, now, truncate } from '@/lib/id';
import type {
  Conversation,
  ContextSnapshot,
  GraphEdge,
  GraphNode,
  ID,
  Message,
  NodeType,
  Position,
} from '@/types';

export class GraphError extends Error {}

export interface CreateNodeInput {
  workspaceId: ID;
  parentId?: ID | null;
  title?: string;
  question?: string;
  type?: NodeType;
  sourcePassage?: string | null;
  sourceMessageId?: ID | null;
  position?: Position;
}

/** Derive a readable node title from a question when the user didn't give one. */
export function deriveTitle(question: string): string {
  const q = question.trim().replace(/\s+/g, ' ');
  if (!q) return 'Untitled';
  return truncate(q.replace(/[?.!]+$/, ''), 60);
}

async function touchWorkspace(workspaceId: ID): Promise<void> {
  await db.workspaces.update(workspaceId, { updatedAt: now() });
}

export async function createNode(input: CreateNodeInput): Promise<GraphNode> {
  return db.transaction('rw', db.nodes, db.edges, db.workspaces, async () => {
    const parentId = input.parentId ?? null;
    let parent: GraphNode | undefined;
    if (parentId) {
      parent = await db.nodes.get(parentId);
      if (!parent) throw new GraphError('Parent node does not exist');
      if (parent.workspaceId !== input.workspaceId) throw new GraphError('Parent belongs to another workspace');
    }
    const siblings = await db.nodes.where('parentId').equals(parentId ?? '').filter((n) => n.workspaceId === input.workspaceId).count();
    const rootCount = parentId
      ? 0
      : await db.nodes.where('workspaceId').equals(input.workspaceId).filter((n) => n.parentId === null).count();
    const order = parentId ? siblings : rootCount;
    const question = input.question?.trim() ?? '';
    const t = now();
    const node: GraphNode = {
      id: newId(),
      workspaceId: input.workspaceId,
      parentId,
      type: input.type ?? (parentId ? 'question' : 'topic'),
      title: input.title?.trim() || deriveTitle(question),
      question,
      summary: '',
      sourcePassage: input.sourcePassage?.trim() || null,
      sourceMessageId: input.sourceMessageId ?? null,
      createdAt: t,
      updatedAt: t,
      position: input.position ?? (parent ? { x: parent.position.x + 320, y: parent.position.y + order * 120 } : { x: 0, y: order * 200 }),
      collapsed: false,
      conversationId: null,
      order,
      answerPreview: '',
      answeredAt: null,
    };
    await db.nodes.add(node);
    if (parentId) {
      await db.edges.add({ id: newId(), workspaceId: input.workspaceId, source: parentId, target: node.id, type: 'child' });
      if (parent?.collapsed) await db.nodes.update(parentId, { collapsed: false });
    }
    await touchWorkspace(input.workspaceId);
    return node;
  });
}

export type NodePatch = Partial<Pick<GraphNode, 'title' | 'question' | 'summary' | 'type' | 'position' | 'collapsed' | 'sourcePassage'>>;

export async function updateNode(id: ID, patch: NodePatch): Promise<GraphNode> {
  return db.transaction('rw', db.nodes, db.workspaces, async () => {
    const node = await db.nodes.get(id);
    if (!node) throw new GraphError('Node not found');
    const next: GraphNode = { ...node, ...patch, updatedAt: now() };
    if (patch.title !== undefined) next.title = patch.title.trim() || node.title;
    await db.nodes.put(next);
    await touchWorkspace(node.workspaceId);
    return next;
  });
}

/** Batch position update used by the freeform board (no workspace touch spam). */
export async function setPositions(updates: Array<{ id: ID; position: Position }>): Promise<void> {
  await db.transaction('rw', db.nodes, async () => {
    for (const u of updates) await db.nodes.update(u.id, { position: u.position });
  });
}

export async function getWorkspaceNodes(workspaceId: ID): Promise<GraphNode[]> {
  return db.nodes.where('workspaceId').equals(workspaceId).toArray();
}

/** Pure helper: collect ids of a node and all of its descendants. */
export function collectSubtree(nodes: readonly GraphNode[], rootId: ID): ID[] {
  const children = new Map<ID, ID[]>();
  for (const n of nodes) {
    if (!n.parentId) continue;
    const list = children.get(n.parentId) ?? [];
    list.push(n.id);
    children.set(n.parentId, list);
  }
  const out: ID[] = [];
  const stack = [rootId];
  const seen = new Set<ID>();
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    for (const c of children.get(id) ?? []) stack.push(c);
  }
  return out;
}

/** Pure helper: ancestors from root down to (excluding) the node. */
export function ancestorChain(nodes: readonly GraphNode[] | ReadonlyMap<ID, GraphNode>, nodeId: ID): GraphNode[] {
  const byId = nodes instanceof Map ? nodes : new Map((nodes as readonly GraphNode[]).map((n) => [n.id, n]));
  const chain: GraphNode[] = [];
  const seen = new Set<ID>([nodeId]);
  let cur = byId.get(nodeId)?.parentId ?? null;
  while (cur) {
    if (seen.has(cur)) break; // defensive: corrupted cycle
    seen.add(cur);
    const n = byId.get(cur);
    if (!n) break;
    chain.unshift(n);
    cur = n.parentId;
  }
  return chain;
}

/** Would making `newParentId` the parent of `nodeId` create a cycle? */
export function wouldCreateCycle(nodes: readonly GraphNode[], nodeId: ID, newParentId: ID | null): boolean {
  if (newParentId === null) return false;
  if (newParentId === nodeId) return true;
  return collectSubtree(nodes, nodeId).includes(newParentId);
}

export async function moveNode(nodeId: ID, newParentId: ID | null): Promise<GraphNode> {
  return db.transaction('rw', db.nodes, db.edges, db.workspaces, async () => {
    const node = await db.nodes.get(nodeId);
    if (!node) throw new GraphError('Node not found');
    const all = await getWorkspaceNodes(node.workspaceId);
    if (newParentId) {
      const p = all.find((n) => n.id === newParentId);
      if (!p) throw new GraphError('New parent not found in this workspace');
    }
    if (wouldCreateCycle(all, nodeId, newParentId)) throw new GraphError('Cannot move a node under itself or its descendants');
    if (node.parentId === newParentId) return node;
    await db.edges.where('target').equals(nodeId).filter((e) => e.type === 'child').delete();
    if (newParentId) {
      await db.edges.add({ id: newId(), workspaceId: node.workspaceId, source: newParentId, target: nodeId, type: 'child' });
    }
    const order = all.filter((n) => n.parentId === newParentId && n.id !== nodeId).length;
    const next = { ...node, parentId: newParentId, order, updatedAt: now() };
    await db.nodes.put(next);
    await touchWorkspace(node.workspaceId);
    return next;
  });
}

export async function addLink(workspaceId: ID, source: ID, target: ID, label?: string): Promise<GraphEdge> {
  if (source === target) throw new GraphError('Cannot link a node to itself');
  return db.transaction('rw', db.edges, db.nodes, async () => {
    const [a, b] = await Promise.all([db.nodes.get(source), db.nodes.get(target)]);
    if (!a || !b || a.workspaceId !== workspaceId || b.workspaceId !== workspaceId) throw new GraphError('Link endpoints must exist in this workspace');
    const existing = await db.edges
      .where('source')
      .equals(source)
      .filter((e) => e.target === target && e.type === 'link')
      .first();
    if (existing) return existing;
    const edge: GraphEdge = { id: newId(), workspaceId, source, target, type: 'link', label };
    await db.edges.add(edge);
    return edge;
  });
}

export async function removeEdge(edgeId: ID): Promise<void> {
  const e = await db.edges.get(edgeId);
  if (e?.type === 'child') throw new GraphError('Parent/child edges are removed by moving or deleting nodes');
  await db.edges.delete(edgeId);
}

/** Everything removed by a subtree delete – kept so the operation can be undone. */
export interface DeletedBundle {
  nodes: GraphNode[];
  edges: GraphEdge[];
  conversations: Conversation[];
  messages: Message[];
  snapshots: ContextSnapshot[];
}

export async function deleteSubtree(nodeId: ID): Promise<DeletedBundle> {
  return db.transaction(
    'rw',
    [db.nodes, db.edges, db.conversations, db.messages, db.snapshots, db.requests, db.workspaces],
    async () => {
      const node = await db.nodes.get(nodeId);
      if (!node) throw new GraphError('Node not found');
      const all = await getWorkspaceNodes(node.workspaceId);
      const ids = collectSubtree(all, nodeId);
      const idSet = new Set(ids);
      const nodes = all.filter((n) => idSet.has(n.id));
      const edges = await db.edges
        .where('workspaceId')
        .equals(node.workspaceId)
        .filter((e) => idSet.has(e.source) || idSet.has(e.target))
        .toArray();
      const conversations = await db.conversations.where('nodeId').anyOf(ids).toArray();
      const convIds = conversations.map((c) => c.id);
      const messages = convIds.length ? await db.messages.where('conversationId').anyOf(convIds).toArray() : [];
      const snapshots = await db.snapshots.where('nodeId').anyOf(ids).toArray();
      // Cancel queued/active requests for deleted nodes so nothing is written back later.
      const reqs = await db.requests.where('nodeId').anyOf(ids).toArray();
      for (const r of reqs) {
        if (r.status === 'queued' || r.status === 'dispatching' || r.status === 'submitted' || r.status === 'streaming') {
          await db.requests.update(r.id, { status: 'cancelled', error: 'Node deleted', updatedAt: now() });
        }
      }
      await db.nodes.bulkDelete(ids);
      await db.edges.bulkDelete(edges.map((e) => e.id));
      await db.conversations.bulkDelete(convIds);
      await db.messages.bulkDelete(messages.map((m) => m.id));
      await db.snapshots.bulkDelete(snapshots.map((s) => s.id));
      await touchWorkspace(node.workspaceId);
      return { nodes, edges, conversations, messages, snapshots };
    },
  );
}

export async function restoreBundle(bundle: DeletedBundle): Promise<void> {
  await db.transaction('rw', [db.nodes, db.edges, db.conversations, db.messages, db.snapshots], async () => {
    await db.nodes.bulkPut(bundle.nodes);
    // Only restore edges whose endpoints exist (another node may have been deleted since).
    const existing = new Set((await db.nodes.bulkGet(bundle.edges.flatMap((e) => [e.source, e.target]))).filter(Boolean).map((n) => n!.id));
    await db.edges.bulkPut(bundle.edges.filter((e) => existing.has(e.source) && existing.has(e.target)));
    await db.conversations.bulkPut(bundle.conversations);
    await db.messages.bulkPut(bundle.messages);
    await db.snapshots.bulkPut(bundle.snapshots);
  });
}

export async function toggleCollapsed(nodeId: ID): Promise<void> {
  const n = await db.nodes.get(nodeId);
  if (n) await db.nodes.update(nodeId, { collapsed: !n.collapsed });
}

/** Pure: nodes visible after applying collapse state (descendants of collapsed nodes hidden). */
export function visibleNodes(nodes: readonly GraphNode[]): GraphNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const hidden = new Map<ID, boolean>();
  const isHidden = (n: GraphNode): boolean => {
    const cached = hidden.get(n.id);
    if (cached !== undefined) return cached;
    let result = false;
    let cur = n.parentId ? byId.get(n.parentId) : undefined;
    const guard = new Set<ID>();
    while (cur && !guard.has(cur.id)) {
      guard.add(cur.id);
      if (cur.collapsed) {
        result = true;
        break;
      }
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    hidden.set(n.id, result);
    return result;
  };
  return nodes.filter((n) => !isHidden(n));
}

/** Pure: build a children index sorted by `order` then createdAt. */
export function childrenIndex(nodes: readonly GraphNode[]): Map<ID | null, GraphNode[]> {
  const map = new Map<ID | null, GraphNode[]>();
  for (const n of nodes) {
    const list = map.get(n.parentId) ?? [];
    list.push(n);
    map.set(n.parentId, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
  return map;
}
