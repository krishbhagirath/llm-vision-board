import { z } from 'zod';
import { db } from './db';
import { newId, now } from '@/lib/id';
import type { Conversation, ContextSnapshot, GraphEdge, GraphNode, ID, Message, Workspace } from '@/types';

export const EXPORT_FORMAT = 'llm-vision-board';
export const EXPORT_VERSION = 1;

const pos = z.object({ x: z.number().finite(), y: z.number().finite() });

const workspaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().max(500),
  description: z.string().max(20_000).default(''),
  createdAt: z.number(),
  updatedAt: z.number(),
  layout: z.enum(['tree', 'board', 'outline', 'chat']).default('tree'),
  settings: z.object({ treeDirection: z.enum(['TB', 'LR']).default('LR'), showMinimap: z.boolean().default(true) }).default({ treeDirection: 'LR', showMinimap: true }),
  selectedNodeId: z.string().nullable().default(null),
});

const nodeSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string(),
  parentId: z.string().nullable(),
  type: z.enum(['topic', 'question', 'explanation', 'note']),
  title: z.string().max(2000),
  question: z.string().max(200_000),
  summary: z.string().max(200_000).default(''),
  sourcePassage: z.string().max(200_000).nullable().default(null),
  sourceMessageId: z.string().nullable().default(null),
  createdAt: z.number(),
  updatedAt: z.number(),
  position: pos,
  collapsed: z.boolean().default(false),
  conversationId: z.string().nullable(),
  order: z.number().default(0),
  answerPreview: z.string().max(2000).default(''),
  answeredAt: z.number().nullable().default(null),
});

const edgeSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string(),
  source: z.string(),
  target: z.string(),
  type: z.enum(['child', 'link']),
  label: z.string().max(500).optional(),
});

const conversationSchema = z.object({
  id: z.string().min(1),
  nodeId: z.string(),
  workspaceId: z.string(),
  provider: z.enum(['chatgpt-web', 'manual']),
  providerUrl: z.string().url().nullable().refine((u) => !u || u.startsWith('https://chatgpt.com/'), 'Only chatgpt.com conversation URLs are allowed'),
  status: z.enum(['active', 'archived']),
  context: z.object({
    initialPackageId: z.string().nullable().default(null),
    handoffSnapshotId: z.string().nullable().default(null),
    approxTokensSent: z.number().default(0),
    warnings: z.array(z.string()).default([]),
  }),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const messageSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string(),
  workspaceId: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().max(2_000_000),
  createdAt: z.number(),
  updatedAt: z.number(),
  status: z.enum(['pending', 'streaming', 'complete', 'failed', 'interrupted', 'cancelled']),
  providerMessageRef: z.string().nullable().default(null),
  sentPrompt: z.string().nullable().default(null),
  source: z.enum(['automation', 'manual-paste', 'tab-capture', 'user']),
  error: z.string().nullable().default(null),
});

const snapshotContentSchema = z.object({
  objective: z.string(),
  concepts: z.array(z.string()),
  explanations: z.array(z.string()),
  definitions: z.array(z.string()),
  constraints: z.array(z.string()),
  decisions: z.array(z.string()),
  unresolved: z.array(z.string()),
  messageRefs: z.array(z.string()),
  graphPosition: z.array(z.string()),
});

const snapshotSchema = z.object({
  id: z.string().min(1),
  nodeId: z.string(),
  workspaceId: z.string(),
  conversationId: z.string().nullable(),
  sourceNodeIds: z.array(z.string()),
  kind: z.enum(['context-package', 'handoff']),
  summary: z.string(),
  content: snapshotContentSchema.nullable(),
  approxTokens: z.number(),
  createdAt: z.number(),
  version: z.number(),
  handoffStatus: z.enum(['draft', 'confirmed', 'applied', 'discarded']).nullable(),
});

export const exportSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.number().int().min(1).max(EXPORT_VERSION),
  exportedAt: z.number(),
  workspace: workspaceSchema,
  nodes: z.array(nodeSchema).max(50_000),
  edges: z.array(edgeSchema).max(200_000),
  conversations: z.array(conversationSchema),
  messages: z.array(messageSchema),
  snapshots: z.array(snapshotSchema).default([]),
});

export type WorkspaceExport = z.infer<typeof exportSchema>;

export async function exportWorkspace(workspaceId: ID): Promise<WorkspaceExport> {
  const workspace = await db.workspaces.get(workspaceId);
  if (!workspace) throw new Error('Workspace not found');
  const [nodes, edges, conversations, messages, snapshots] = await Promise.all([
    db.nodes.where('workspaceId').equals(workspaceId).toArray(),
    db.edges.where('workspaceId').equals(workspaceId).toArray(),
    db.conversations.where('workspaceId').equals(workspaceId).toArray(),
    db.messages.where('workspaceId').equals(workspaceId).toArray(),
    db.snapshots.where('workspaceId').equals(workspaceId).toArray(),
  ]);
  return { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: now(), workspace, nodes, edges, conversations, messages, snapshots };
}

export type ImportErrorCode = 'invalid-json' | 'wrong-format' | 'newer-version' | 'invalid-schema' | 'integrity';

export class ImportError extends Error {
  constructor(
    message: string,
    public readonly code: ImportErrorCode = 'invalid-schema',
  ) {
    super(message);
    this.name = 'ImportError';
  }
}

/** Parse + validate untrusted JSON. Throws ImportError with a readable message. */
export function parseExport(json: string): WorkspaceExport {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new ImportError('File is not valid JSON.', 'invalid-json');
  }
  const header = raw && typeof raw === 'object' ? (raw as { format?: unknown; version?: unknown }) : null;
  if (!header || header.format !== EXPORT_FORMAT) {
    throw new ImportError('Not a valid LLM Vision Board export: this file is not in the LLM Vision Board format.', 'wrong-format');
  }
  if (typeof header.version === 'number' && header.version > EXPORT_VERSION) {
    throw new ImportError(`This export was made by a newer version (v${header.version}); this build reads up to v${EXPORT_VERSION}.`, 'newer-version');
  }
  const res = exportSchema.safeParse(raw);
  if (!res.success) {
    const first = res.error.issues[0];
    throw new ImportError(`Not a valid LLM Vision Board export: ${first ? `${first.path.join('.') || '(root)'} – ${first.message}` : 'unknown error'}`, 'invalid-schema');
  }
  const data = res.data;
  // Referential integrity
  const nodeIds = new Set(data.nodes.map((n) => n.id));
  if (nodeIds.size !== data.nodes.length) throw new ImportError('Duplicate node ids in export.', 'integrity');
  for (const n of data.nodes) {
    if (n.parentId && !nodeIds.has(n.parentId)) throw new ImportError(`Node "${n.title}" references a missing parent.`, 'integrity');
  }
  // Cycle check
  const parent = new Map(data.nodes.map((n) => [n.id, n.parentId]));
  for (const n of data.nodes) {
    const seen = new Set<string>();
    let cur: string | null | undefined = n.id;
    while (cur) {
      if (seen.has(cur)) throw new ImportError('Export contains a parent/child cycle.', 'integrity');
      seen.add(cur);
      cur = parent.get(cur) ?? null;
    }
  }
  return data;
}

export interface ImportPreview {
  data: WorkspaceExport;
  fileName: string;
  workspaceName: string;
  version: number;
  exportedAt: number;
  counts: { nodes: number; edges: number; conversations: number; messages: number; snapshots: number };
  /** Things the import will repair, drop or change. Empty when the file is clean. */
  warnings: string[];
}

export type ImportPreviewResult = { ok: true; preview: ImportPreview } | { ok: false; code: ImportErrorCode; message: string };

/**
 * Pure: validate a file's text and describe what importing it would do, without touching the database.
 * `existingNames` (current workspace names) lets the preview warn about name clashes.
 */
export function previewImport(json: string, fileName = '', existingNames: readonly string[] = []): ImportPreviewResult {
  let data: WorkspaceExport;
  try {
    data = parseExport(json);
  } catch (e) {
    if (e instanceof ImportError) return { ok: false, code: e.code, message: e.message };
    return { ok: false, code: 'invalid-schema', message: e instanceof Error ? e.message : String(e) };
  }
  const nodeIds = new Set(data.nodes.map((n) => n.id));
  const convIds = new Set(data.conversations.map((c) => c.id));
  const warnings: string[] = [];
  const badEdges = data.edges.filter((e) => !nodeIds.has(e.source) || !nodeIds.has(e.target)).length;
  if (badEdges) warnings.push(`${badEdges} link${badEdges === 1 ? '' : 's'} point to missing nodes and will be skipped.`);
  const orphanConvs = data.conversations.filter((c) => !nodeIds.has(c.nodeId)).length;
  if (orphanConvs) warnings.push(`${orphanConvs} conversation${orphanConvs === 1 ? '' : 's'} belong to missing nodes and will be skipped.`);
  const orphanMsgs = data.messages.filter((m) => !convIds.has(m.conversationId)).length;
  if (orphanMsgs) warnings.push(`${orphanMsgs} message${orphanMsgs === 1 ? '' : 's'} have no conversation and will be skipped.`);
  const dangling = data.nodes.filter((n) => n.conversationId && !convIds.has(n.conversationId)).length;
  if (dangling) warnings.push(`${dangling} node${dangling === 1 ? '' : 's'} refer to a missing conversation and will start empty.`);
  const inFlight = data.messages.filter((m) => m.status === 'pending' || m.status === 'streaming').length;
  if (inFlight) warnings.push(`${inFlight} unfinished answer${inFlight === 1 ? '' : 's'} will be marked as interrupted.`);
  const linked = data.conversations.filter((c) => c.providerUrl).length;
  if (linked) warnings.push(`${linked} conversation${linked === 1 ? ' is' : 's are'} linked to ChatGPT chats. Continuing one would use the original ChatGPT conversation.`);
  const taken = existingNames.some((n) => n === `${data.workspace.name} (imported)` || n === data.workspace.name);
  if (taken) warnings.push('A workspace with this name already exists. The import is added alongside it and never overwrites it.');
  return {
    ok: true,
    preview: {
      data,
      fileName,
      workspaceName: data.workspace.name,
      version: data.version,
      exportedAt: data.exportedAt,
      counts: {
        nodes: data.nodes.length,
        edges: data.edges.length,
        conversations: data.conversations.length,
        messages: data.messages.length,
        snapshots: data.snapshots.length,
      },
      warnings,
    },
  };
}

/**
 * Import as a NEW workspace. All ids are remapped so importing the same file twice
 * (or into a profile that still has the original) never collides.
 */
export async function importWorkspace(data: WorkspaceExport, nameSuffix = ' (imported)'): Promise<Workspace> {
  const map = new Map<string, string>();
  const remap = (id: string) => {
    let v = map.get(id);
    if (!v) {
      v = newId();
      map.set(id, v);
    }
    return v;
  };
  const opt = (id: string | null) => (id ? remap(id) : null);
  const t = now();
  const wsId = remap(data.workspace.id);
  const workspace: Workspace = {
    ...data.workspace,
    id: wsId,
    name: `${data.workspace.name}${nameSuffix}`,
    updatedAt: t,
    selectedNodeId: opt(data.workspace.selectedNodeId),
  };
  const nodeIds = new Set(data.nodes.map((n) => n.id));
  const convIds = new Set(data.conversations.map((c) => c.id));
  const nodes: GraphNode[] = data.nodes.map((n) => ({
    ...n,
    id: remap(n.id),
    workspaceId: wsId,
    parentId: opt(n.parentId),
    sourceMessageId: opt(n.sourceMessageId),
    conversationId: n.conversationId && convIds.has(n.conversationId) ? remap(n.conversationId) : null,
  }));
  const edges: GraphEdge[] = data.edges
    .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
    .map((e) => ({ ...e, id: remap(e.id), workspaceId: wsId, source: remap(e.source), target: remap(e.target) }));
  // Ensure every parent relation has a child edge (repairs older/hand-edited exports).
  const childEdgeTargets = new Set(edges.filter((e) => e.type === 'child').map((e) => e.target));
  for (const n of nodes) {
    if (n.parentId && !childEdgeTargets.has(n.id)) edges.push({ id: newId(), workspaceId: wsId, source: n.parentId, target: n.id, type: 'child' });
  }
  const conversations: Conversation[] = data.conversations
    .filter((c) => nodeIds.has(c.nodeId))
    .map((c) => ({
      ...c,
      id: remap(c.id),
      nodeId: remap(c.nodeId),
      workspaceId: wsId,
      context: { ...c.context, initialPackageId: opt(c.context.initialPackageId), handoffSnapshotId: opt(c.context.handoffSnapshotId) },
    }));
  const messages: Message[] = data.messages
    .filter((m) => convIds.has(m.conversationId))
    .map((m) => ({
      ...m,
      id: remap(m.id),
      conversationId: remap(m.conversationId),
      workspaceId: wsId,
      // In-flight states can't be resumed after import.
      status: m.status === 'pending' || m.status === 'streaming' ? 'interrupted' : m.status,
    }));
  const snapshots: ContextSnapshot[] = data.snapshots
    .filter((s) => nodeIds.has(s.nodeId))
    .map((s) => ({
      ...s,
      id: remap(s.id),
      nodeId: remap(s.nodeId),
      workspaceId: wsId,
      conversationId: opt(s.conversationId),
      sourceNodeIds: s.sourceNodeIds.filter((x) => nodeIds.has(x)).map(remap),
      content: s.content ? { ...s.content, messageRefs: s.content.messageRefs.map(remap) } : null,
    }));
  await db.transaction('rw', [db.workspaces, db.nodes, db.edges, db.conversations, db.messages, db.snapshots], async () => {
    await db.workspaces.add(workspace);
    await db.nodes.bulkAdd(nodes);
    await db.edges.bulkAdd(edges);
    await db.conversations.bulkAdd(conversations);
    await db.messages.bulkAdd(messages);
    await db.snapshots.bulkAdd(snapshots);
  });
  return workspace;
}
