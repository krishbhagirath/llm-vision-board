import { db } from '@/storage/db';
import { newId, now } from '@/lib/id';
import { buildContextPackage, loadContextInput, type ContextPackage } from '@/features/context/contextBuilder';
import { estimateTokens } from '@/features/context/tokens';
import { refreshNodePreview } from './answerPreview';
import type { Conversation, ID, Message, ProviderId, ProviderRequest } from '@/types';

export async function getOrCreateConversation(nodeId: ID, provider: ProviderId = 'chatgpt-web'): Promise<Conversation> {
  return db.transaction('rw', db.nodes, db.conversations, async () => {
    const node = await db.nodes.get(nodeId);
    if (!node) throw new Error('Node not found');
    if (node.conversationId) {
      const existing = await db.conversations.get(node.conversationId);
      if (existing) return existing;
    }
    const t = now();
    const conv: Conversation = {
      id: newId(),
      nodeId,
      workspaceId: node.workspaceId,
      provider,
      providerUrl: null,
      status: 'active',
      context: { initialPackageId: null, handoffSnapshotId: null, approxTokensSent: 0, warnings: [] },
      createdAt: t,
      updatedAt: t,
    };
    await db.conversations.add(conv);
    await db.nodes.update(nodeId, { conversationId: conv.id });
    return conv;
  });
}

export async function listMessages(conversationId: ID): Promise<Message[]> {
  return db.messages
    .where('[conversationId+createdAt]')
    .between([conversationId, 0], [conversationId, Number.MAX_SAFE_INTEGER])
    .toArray();
}

/**
 * A logical conversation needs a context package on its first provider turn:
 * when nothing has been answered yet in it (no provider URL and no complete answer).
 * Later turns continue the same provider conversation, which already holds the context.
 */
export async function needsContextPackage(conv: Conversation): Promise<boolean> {
  if (conv.providerUrl) return false;
  const msgs = await listMessages(conv.id);
  return !msgs.some((m) => m.role === 'assistant' && m.status === 'complete');
}

export interface PreparedPrompt {
  conversation: Conversation;
  prompt: string;
  contextPackage: ContextPackage | null;
}

/** Build (without sending) the exact prompt that would be sent for `text` on `nodeId`. */
export async function preparePrompt(nodeId: ID, text: string): Promise<PreparedPrompt> {
  const conversation = await getOrCreateConversation(nodeId);
  if (await needsContextPackage(conversation)) {
    const input = await loadContextInput(nodeId, conversation.context.handoffSnapshotId);
    const pkg = buildContextPackage(input, text);
    return { conversation, prompt: pkg.prompt, contextPackage: pkg };
  }
  return { conversation, prompt: text.trim(), contextPackage: null };
}

export interface PromptPreview {
  prompt: string;
  contextPackage: ContextPackage | null;
  /** True when this would be the first provider turn (map context is included); false when continuing a ChatGPT conversation. */
  firstTurn: boolean;
}

/**
 * Side-effect-free twin of `preparePrompt`: computes the exact prompt that would be sent for `text` on `nodeId`
 * without creating a conversation row (or writing anything else). Safe to call on every keystroke.
 */
export async function previewPrompt(nodeId: ID, text: string): Promise<PromptPreview> {
  const node = await db.nodes.get(nodeId);
  if (!node) throw new Error('Node not found');
  const existing = node.conversationId ? await db.conversations.get(node.conversationId) : undefined;
  // A node with no (or a dangling) conversation would get a fresh one: first turn, no handoff.
  const firstTurn = existing ? await needsContextPackage(existing) : true;
  if (firstTurn) {
    const input = await loadContextInput(nodeId, existing?.context.handoffSnapshotId ?? null);
    const pkg = buildContextPackage(input, text);
    return { prompt: pkg.prompt, contextPackage: pkg, firstTurn };
  }
  return { prompt: text.trim(), contextPackage: null, firstTurn };
}

async function recordPackage(conv: Conversation, pkg: ContextPackage | null, prompt: string): Promise<void> {
  const patch: Partial<Conversation> = {
    updatedAt: now(),
    context: { ...conv.context, approxTokensSent: conv.context.approxTokensSent + estimateTokens(prompt) },
  };
  if (pkg && pkg.items.length) {
    const snapId = newId();
    await db.snapshots.add({
      id: snapId,
      nodeId: conv.nodeId,
      workspaceId: conv.workspaceId,
      conversationId: conv.id,
      sourceNodeIds: pkg.sourceNodeIds,
      kind: 'context-package',
      summary: pkg.prompt,
      content: null,
      approxTokens: pkg.approxTokens,
      createdAt: now(),
      version: 1,
      handoffStatus: null,
    });
    patch.context = { ...patch.context!, initialPackageId: snapId };
  }
  await db.conversations.update(conv.id, patch);
}

function userMessage(conv: Conversation, text: string, prompt: string): Message {
  const t = now();
  return {
    id: newId(),
    conversationId: conv.id,
    workspaceId: conv.workspaceId,
    role: 'user',
    content: text.trim(),
    createdAt: t,
    updatedAt: t,
    status: 'complete',
    providerMessageRef: null,
    sentPrompt: prompt,
    source: 'user',
    error: null,
  };
}

export interface AutomatedSendResult {
  conversation: Conversation;
  userMessage: Message;
  assistantMessage: Message;
  request: ProviderRequest;
}

/**
 * Queue a message for automated delivery through the ChatGPT tab.
 * Only called from an explicit user action (Send button / Enter in composer).
 * The caller must then signal the background (`bg:kick`).
 */
export async function queueAutomatedMessage(nodeId: ID, text: string): Promise<AutomatedSendResult> {
  if (!text.trim()) throw new Error('Message is empty');
  const { conversation, prompt, contextPackage } = await preparePrompt(nodeId, text);
  return db.transaction('rw', [db.messages, db.requests, db.conversations, db.snapshots, db.nodes], async () => {
    const busy = await db.requests
      .where('conversationId')
      .equals(conversation.id)
      .filter((r) => ['queued', 'dispatching', 'submitted', 'streaming'].includes(r.status))
      .count();
    if (busy) throw new Error('This branch already has a request in progress. Wait for it or cancel it first.');
    const um = userMessage(conversation, text, prompt);
    const t = now() + 1; // keep assistant strictly after user in ordering
    const am: Message = {
      id: newId(),
      conversationId: conversation.id,
      workspaceId: conversation.workspaceId,
      role: 'assistant',
      content: '',
      createdAt: t,
      updatedAt: t,
      status: 'pending',
      providerMessageRef: null,
      sentPrompt: null,
      source: 'automation',
      error: null,
    };
    const req: ProviderRequest = {
      id: newId(),
      workspaceId: conversation.workspaceId,
      nodeId,
      conversationId: conversation.id,
      userMessageId: um.id,
      assistantMessageId: am.id,
      provider: 'chatgpt-web',
      prompt,
      targetUrl: conversation.providerUrl,
      status: 'queued',
      error: null,
      tabId: null,
      attempt: 1,
      createdAt: t,
      updatedAt: t,
      lastActivityAt: t,
    };
    await db.messages.bulkAdd([um, am]);
    await db.requests.add(req);
    await recordPackage(conversation, contextPackage, prompt);
    await db.nodes.update(nodeId, { updatedAt: now() });
    return { conversation, userMessage: um, assistantMessage: am, request: req };
  });
}

/** Manual mode step 1: store the user's message and return the prompt to copy into ChatGPT. */
export async function recordManualQuestion(nodeId: ID, text: string): Promise<{ conversation: Conversation; prompt: string; message: Message }> {
  if (!text.trim()) throw new Error('Message is empty');
  const { conversation, prompt, contextPackage } = await preparePrompt(nodeId, text);
  const um = userMessage(conversation, text, prompt);
  await db.messages.add(um);
  await recordPackage(conversation, contextPackage, prompt);
  return { conversation, prompt, message: um };
}

/** Manual mode step 2 (or tab capture): attach a response the user pasted/captured. */
export async function addManualResponse(
  conversationId: ID,
  content: string,
  source: 'manual-paste' | 'tab-capture',
  providerUrl?: string | null,
): Promise<Message> {
  if (!content.trim()) throw new Error('Response is empty');
  const conv = await db.conversations.get(conversationId);
  if (!conv) throw new Error('Conversation not found');
  const t = now();
  const m: Message = {
    id: newId(),
    conversationId,
    workspaceId: conv.workspaceId,
    role: 'assistant',
    content: content.trim(),
    createdAt: t,
    updatedAt: t,
    status: 'complete',
    providerMessageRef: null,
    sentPrompt: null,
    source,
    error: null,
  };
  await db.messages.add(m);
  const patch: Partial<Conversation> = { updatedAt: t };
  if (providerUrl) patch.providerUrl = providerUrl;
  await db.conversations.update(conversationId, patch);
  await refreshNodePreview(conversationId);
  return m;
}

/** Fill a failed/interrupted assistant message by manual paste or tab capture. */
export async function resolveAssistantMessage(messageId: ID, content: string, source: 'manual-paste' | 'tab-capture'): Promise<void> {
  if (!content.trim()) throw new Error('Response is empty');
  await db.messages.update(messageId, { content: content.trim(), status: 'complete', source, error: null, updatedAt: now() });
  const m = await db.messages.get(messageId);
  if (m) await refreshNodePreview(m.conversationId);
}

export async function setConversationUrl(conversationId: ID, url: string | null): Promise<void> {
  await db.conversations.update(conversationId, { providerUrl: url, updatedAt: now() });
}

/** Re-queue a failed/interrupted request for the same assistant message. */
export async function retryRequest(requestId: ID): Promise<ProviderRequest> {
  return db.transaction('rw', db.requests, db.messages, db.conversations, async () => {
    const old = await db.requests.get(requestId);
    if (!old) throw new Error('Request not found');
    if (!['failed', 'interrupted', 'cancelled'].includes(old.status)) throw new Error('Only failed, interrupted or cancelled requests can be retried');
    const conv = await db.conversations.get(old.conversationId);
    if (!conv) throw new Error('Conversation no longer exists');
    const t = now();
    const req: ProviderRequest = {
      ...old,
      id: newId(),
      targetUrl: conv.providerUrl,
      status: 'queued',
      error: null,
      tabId: null,
      attempt: old.attempt + 1,
      createdAt: t,
      updatedAt: t,
      lastActivityAt: t,
    };
    await db.requests.add(req);
    await db.messages.update(old.assistantMessageId, { status: 'pending', error: null, content: '', updatedAt: t });
    return req;
  });
}

export async function deleteMessage(messageId: ID): Promise<void> {
  const m = await db.messages.get(messageId);
  await db.messages.delete(messageId);
  if (m) await refreshNodePreview(m.conversationId);
}
