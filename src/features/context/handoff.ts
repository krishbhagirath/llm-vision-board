import { db } from '@/storage/db';
import { newId, now, truncate } from '@/lib/id';
import { ancestorChain } from '@/features/graph/graphOps';
import { estimateTokens } from './tokens';
import { stripMarkdown } from './contextBuilder';
import type { ContextSnapshot, ContextSnapshotContent, Conversation, GraphNode, ID, Message } from '@/types';

/**
 * Deterministic (non-LLM) handoff generator. It extracts structure from the
 * existing messages with simple, documented heuristics:
 *   - objective     = node question
 *   - concepts      = markdown headings + **bold** terms in assistant answers
 *   - definitions   = sentences shaped like "X is a/an/the …" / "X refers to …"
 *   - explanations  = first paragraph of each assistant answer (truncated)
 *   - constraints   = user sentences containing must/should/only/don't/prefer
 *   - decisions     = sentences with "we'll"/"let's"/"decided"/"assume"
 *   - unresolved    = user questions after the last complete answer, plus failed requests
 * The user reviews and can edit the rendered summary before confirming.
 * Original messages are never modified or deleted.
 */

const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];

function sentences(text: string): string[] {
  return stripMarkdown(text)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12 && s.length < 320);
}

export function extractHandoffContent(node: GraphNode, path: GraphNode[], messages: Message[]): ContextSnapshotContent {
  const answers = messages.filter((m) => m.role === 'assistant' && m.status === 'complete' && m.content.trim());
  const userMsgs = messages.filter((m) => m.role === 'user');
  const concepts: string[] = [];
  const definitions: string[] = [];
  const explanations: string[] = [];
  for (const a of answers) {
    for (const m of a.content.matchAll(/^#{1,4}\s+(.+)$/gm)) concepts.push(m[1]!.replace(/[*_`]/g, ''));
    for (const m of a.content.matchAll(/\*\*([^*]{2,60})\*\*/g)) concepts.push(m[1]!);
    for (const s of sentences(a.content)) {
      if (/^[A-Z][\w\s()-]{1,50}\s(is|are|refers to|means)\s(a|an|the|when|how)?\b/.test(s)) definitions.push(s);
    }
    const firstPara = a.content.split(/\n\s*\n/).find((p) => p.trim() && !p.trim().startsWith('#'));
    if (firstPara) explanations.push(truncate(stripMarkdown(firstPara), 400));
  }
  const constraints: string[] = [];
  const decisions: string[] = [];
  for (const u of userMsgs) {
    for (const s of sentences(u.content)) {
      if (/\b(must|should|only|don't|do not|prefer|avoid|without)\b/i.test(s)) constraints.push(s);
      if (/\b(we'll|let's|decided|assume|assuming)\b/i.test(s)) decisions.push(s);
    }
  }
  const lastAnswerAt = answers.at(-1)?.createdAt ?? 0;
  const unresolved = [
    ...userMsgs.filter((u) => u.createdAt > lastAnswerAt).map((u) => truncate(u.content, 240)),
    ...messages.filter((m) => m.role === 'assistant' && (m.status === 'failed' || m.status === 'interrupted')).map(() => 'A previous answer failed or was interrupted.'),
  ];
  return {
    objective: node.question || node.title,
    concepts: uniq(concepts).slice(0, 20),
    explanations: uniq(explanations).slice(-6),
    definitions: uniq(definitions).slice(0, 10),
    constraints: uniq(constraints).slice(0, 8),
    decisions: uniq(decisions).slice(0, 8),
    unresolved: uniq(unresolved).slice(0, 8),
    messageRefs: messages.map((m) => m.id),
    graphPosition: [...path.map((p) => p.title), node.title],
  };
}

export type HandoffSectionKey = 'objective' | 'concepts' | 'definitions' | 'explanations' | 'constraints' | 'decisions' | 'unresolved';

/** The sections a user can include/exclude before confirming a handoff, in rendered order. */
export const HANDOFF_SECTIONS: ReadonlyArray<{ key: HandoffSectionKey; label: string; hint: string }> = [
  { key: 'objective', label: 'Objective', hint: 'The question this node is about' },
  { key: 'concepts', label: 'Key concepts', hint: 'Headings and bold terms from answers' },
  { key: 'definitions', label: 'Definitions', hint: '"X is a…" style sentences' },
  { key: 'explanations', label: 'Explanations', hint: 'Opening paragraph of each answer' },
  { key: 'constraints', label: 'Your constraints', hint: 'Sentences with must / only / avoid…' },
  { key: 'decisions', label: 'Decisions', hint: "Sentences with let's / assume…" },
  { key: 'unresolved', label: 'Still unresolved', hint: 'Unanswered or failed questions' },
];

/** How many items a section holds (the objective counts as one when present). */
export function sectionCount(c: ContextSnapshotContent, key: HandoffSectionKey): number {
  return key === 'objective' ? (c.objective.trim() ? 1 : 0) : c[key].length;
}

/** Copy of `c` with every section not in `include` emptied (so renderHandoff leaves it out). */
export function filterHandoffContent(c: ContextSnapshotContent, include: ReadonlySet<HandoffSectionKey>): ContextSnapshotContent {
  return {
    ...c,
    objective: include.has('objective') ? c.objective : '',
    concepts: include.has('concepts') ? c.concepts : [],
    definitions: include.has('definitions') ? c.definitions : [],
    explanations: include.has('explanations') ? c.explanations : [],
    constraints: include.has('constraints') ? c.constraints : [],
    decisions: include.has('decisions') ? c.decisions : [],
    unresolved: include.has('unresolved') ? c.unresolved : [],
  };
}

export function renderHandoff(c: ContextSnapshotContent): string {
  const sec = (title: string, xs: string[]) => (xs.length ? [`${title}:`, ...xs.map((x) => `- ${x}`), ''] : []);
  return [
    ...(c.objective.trim() ? [`Learning objective: ${c.objective}`] : []),
    `Position in study map: ${c.graphPosition.join(' › ')}`,
    '',
    ...sec('Key concepts covered', c.concepts),
    ...sec('Definitions established', c.definitions),
    ...sec('Important explanations so far', c.explanations),
    ...sec('My constraints/preferences', c.constraints),
    ...sec('Decisions and assumptions', c.decisions),
    ...sec('Still unresolved', c.unresolved),
  ]
    .join('\n')
    .trim();
}

export async function generateHandoffDraft(nodeId: ID): Promise<ContextSnapshot> {
  const node = await db.nodes.get(nodeId);
  if (!node) throw new Error('Node not found');
  if (!node.conversationId) throw new Error('This node has no conversation to hand off yet');
  const all = await db.nodes.where('workspaceId').equals(node.workspaceId).toArray();
  const messages = await db.messages
    .where('[conversationId+createdAt]')
    .between([node.conversationId, 0], [node.conversationId, Number.MAX_SAFE_INTEGER])
    .toArray();
  const content = extractHandoffContent(node, ancestorChain(all, nodeId), messages);
  const summary = renderHandoff(content);
  const prevVersions = await db.snapshots.where('nodeId').equals(nodeId).filter((s) => s.kind === 'handoff').count();
  const snap: ContextSnapshot = {
    id: newId(),
    nodeId,
    workspaceId: node.workspaceId,
    conversationId: node.conversationId,
    sourceNodeIds: [nodeId],
    kind: 'handoff',
    summary,
    content,
    approxTokens: estimateTokens(summary),
    createdAt: now(),
    version: prevVersions + 1,
    handoffStatus: 'draft',
  };
  await db.snapshots.add(snap);
  return snap;
}

/**
 * Confirm a (possibly user-edited) handoff: archives the current conversation and
 * creates a new logical conversation for the same node, seeded by the snapshot.
 * The next message sent from this node will start a NEW provider conversation whose
 * first prompt contains the handoff summary.
 */
export async function applyHandoff(snapshotId: ID, editedSummary?: string): Promise<Conversation> {
  return db.transaction('rw', db.snapshots, db.conversations, db.nodes, async () => {
    const snap = await db.snapshots.get(snapshotId);
    if (!snap || snap.kind !== 'handoff') throw new Error('Handoff snapshot not found');
    const node = await db.nodes.get(snap.nodeId);
    if (!node) throw new Error('Node not found');
    const summary = editedSummary?.trim() || snap.summary;
    if (node.conversationId) await db.conversations.update(node.conversationId, { status: 'archived', updatedAt: now() });
    const t = now();
    const conv: Conversation = {
      id: newId(),
      nodeId: node.id,
      workspaceId: node.workspaceId,
      provider: 'chatgpt-web',
      providerUrl: null,
      status: 'active',
      context: { initialPackageId: null, handoffSnapshotId: snap.id, approxTokensSent: 0, warnings: [] },
      createdAt: t,
      updatedAt: t,
    };
    await db.conversations.add(conv);
    await db.snapshots.update(snap.id, { summary, approxTokens: estimateTokens(summary), handoffStatus: 'applied' });
    await db.nodes.update(node.id, { conversationId: conv.id, updatedAt: t });
    return conv;
  });
}

export async function discardHandoff(snapshotId: ID): Promise<void> {
  await db.snapshots.update(snapshotId, { handoffStatus: 'discarded' });
}
