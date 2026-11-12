import { db } from '@/storage/db';
import { truncate } from '@/lib/id';
import { ancestorChain } from '@/features/graph/graphOps';
import { estimateTokens } from './tokens';
import type { ContextSnapshot, GraphEdge, GraphNode, ID, Message } from '@/types';

/**
 * Deterministic context construction.
 *
 * Isolation rule: a node's context package is built ONLY from
 *   - its ancestor chain (root → parent),
 *   - its own source passage,
 *   - nodes explicitly cross-linked to it,
 *   - an optional handoff snapshot of its own earlier conversation.
 * Sibling branches and their descendants are never consulted.
 *
 * The retrieval step is behind `ContextSource` so semantic retrieval can be added later.
 */

export interface ContextItem {
  kind: 'ancestor' | 'source-passage' | 'linked' | 'handoff' | 'workspace';
  nodeId: ID | null;
  title: string;
  text: string;
  approxTokens: number;
}

export interface ContextPackage {
  nodeId: ID;
  items: ContextItem[];
  question: string;
  /** Final prompt text to send to the provider. */
  prompt: string;
  approxTokens: number;
  sourceNodeIds: ID[];
}

export interface ContextBudget {
  /** Approx tokens per ancestor summary. */
  perAncestor: number;
  /** Max ancestors included (closest first); farther ancestors are reduced to titles. */
  maxDetailedAncestors: number;
  perLinked: number;
}

export const DEFAULT_BUDGET: ContextBudget = { perAncestor: 220, maxDetailedAncestors: 4, perLinked: 120 };

/** Input data the builder needs; loaded by `loadContextInput` or supplied directly in tests. */
export interface ContextInput {
  node: GraphNode;
  nodesById: ReadonlyMap<ID, GraphNode>;
  links: readonly GraphEdge[];
  /** First complete assistant answer per node id (used when a node has no summary yet). */
  firstAnswers: ReadonlyMap<ID, string>;
  workspaceDescription: string;
  handoff: ContextSnapshot | null;
}

const charsFor = (tokens: number) => tokens * 4;

/** Summary used for context: explicit summary → first answer excerpt → question. */
export function nodeDigest(node: GraphNode, firstAnswer: string | undefined, tokens: number): string {
  if (node.summary.trim()) return truncate(node.summary, charsFor(tokens));
  if (firstAnswer?.trim()) return truncate(stripMarkdown(firstAnswer), charsFor(tokens));
  return '';
}

export function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' [code] ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
    // underscore emphasis only at word boundaries, so snake_case identifiers survive
    .replace(/(^|\W)_{1,3}([^_]+?)_{1,3}(?=\W|$)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildContextPackage(input: ContextInput, question: string, budget: ContextBudget = DEFAULT_BUDGET): ContextPackage {
  const { node, nodesById } = input;
  const items: ContextItem[] = [];
  const ancestors = ancestorChain(nodesById, node.id);
  const detailedFrom = Math.max(0, ancestors.length - budget.maxDetailedAncestors);

  if (input.workspaceDescription.trim()) {
    const text = truncate(input.workspaceDescription, 400);
    items.push({ kind: 'workspace', nodeId: null, title: 'Workspace goal', text, approxTokens: estimateTokens(text) });
  }

  ancestors.forEach((a, i) => {
    const detailed = i >= detailedFrom;
    const digest = detailed ? nodeDigest(a, input.firstAnswers.get(a.id), budget.perAncestor) : '';
    const text = [a.question ? `Q: ${a.question}` : '', digest ? `Gist: ${digest}` : ''].filter(Boolean).join('\n');
    items.push({ kind: 'ancestor', nodeId: a.id, title: a.title, text, approxTokens: estimateTokens(text) });
  });

  if (input.handoff) {
    items.push({
      kind: 'handoff',
      nodeId: node.id,
      title: 'Handoff from earlier conversation on this topic',
      text: input.handoff.summary,
      approxTokens: estimateTokens(input.handoff.summary),
    });
  }

  for (const e of input.links) {
    if (e.type !== 'link') continue;
    const otherId = e.source === node.id ? e.target : e.target === node.id ? e.source : null;
    if (!otherId) continue;
    const other = nodesById.get(otherId);
    if (!other) continue;
    const digest = nodeDigest(other, input.firstAnswers.get(other.id), budget.perLinked);
    const text = [`Q: ${other.question || other.title}`, digest ? `Gist: ${digest}` : ''].filter(Boolean).join('\n');
    items.push({ kind: 'linked', nodeId: other.id, title: other.title, text, approxTokens: estimateTokens(text) });
  }

  if (node.sourcePassage) {
    const text = truncate(node.sourcePassage, 2400);
    items.push({ kind: 'source-passage', nodeId: node.parentId, title: 'Selected passage', text, approxTokens: estimateTokens(text) });
  }

  const prompt = renderPrompt(items, question, ancestors.map((a) => a.title).concat(node.title));
  return {
    nodeId: node.id,
    items,
    question,
    prompt,
    approxTokens: estimateTokens(prompt),
    sourceNodeIds: [...new Set(items.map((i) => i.nodeId).filter((x): x is ID => !!x))],
  };
}

function renderPrompt(items: ContextItem[], question: string, path: string[]): string {
  if (items.length === 0) return question.trim();
  const lines: string[] = [];
  lines.push('[Context from my study map — for background only]');
  if (path.length > 1) lines.push(`Topic path: ${path.join(' › ')}`);
  const ws = items.find((i) => i.kind === 'workspace');
  if (ws) lines.push(`Overall goal: ${ws.text}`);
  const anc = items.filter((i) => i.kind === 'ancestor');
  if (anc.length) {
    lines.push('', 'Earlier questions on this path:');
    anc.forEach((a, i) => lines.push(`${i + 1}. ${a.title}${a.text ? `\n   ${a.text.replace(/\n/g, '\n   ')}` : ''}`));
  }
  const handoff = items.find((i) => i.kind === 'handoff');
  if (handoff) lines.push('', 'Summary of my previous conversation on this exact topic:', handoff.text);
  const linked = items.filter((i) => i.kind === 'linked');
  if (linked.length) {
    lines.push('', 'Related concepts I have explored:');
    linked.forEach((l) => lines.push(`- ${l.title}: ${l.text.replace(/\n/g, ' ')}`));
  }
  const passage = items.find((i) => i.kind === 'source-passage');
  if (passage) lines.push('', 'The passage my question is about:', `"""`, passage.text, `"""`);
  lines.push('', '[My question]', question.trim());
  return lines.join('\n');
}

/** Load everything needed for a node's context from IndexedDB. */
export async function loadContextInput(nodeId: ID, handoffSnapshotId: ID | null = null): Promise<ContextInput> {
  const node = await db.nodes.get(nodeId);
  if (!node) throw new Error('Node not found');
  const [nodes, ws, links] = await Promise.all([
    db.nodes.where('workspaceId').equals(node.workspaceId).toArray(),
    db.workspaces.get(node.workspaceId),
    db.edges.where('workspaceId').equals(node.workspaceId).filter((e) => e.type === 'link' && (e.source === nodeId || e.target === nodeId)).toArray(),
  ]);
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const relevant = [...ancestorChain(nodesById, nodeId).map((n) => n.id), ...links.map((l) => (l.source === nodeId ? l.target : l.source))];
  const firstAnswers = new Map<ID, string>();
  for (const id of relevant) {
    const n = nodesById.get(id);
    if (!n?.conversationId || n.summary.trim()) continue;
    const ans = await firstCompleteAnswer(n.conversationId);
    if (ans) firstAnswers.set(id, ans.content);
  }
  const handoff = handoffSnapshotId ? ((await db.snapshots.get(handoffSnapshotId)) ?? null) : null;
  return { node, nodesById, links, firstAnswers, workspaceDescription: ws?.description ?? '', handoff };
}

async function firstCompleteAnswer(conversationId: ID): Promise<Message | undefined> {
  return db.messages
    .where('[conversationId+createdAt]')
    .between([conversationId, 0], [conversationId, Number.MAX_SAFE_INTEGER])
    .filter((m) => m.role === 'assistant' && m.status === 'complete' && !!m.content.trim())
    .first();
}
