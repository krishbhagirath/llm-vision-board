import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/storage/db';
import { listMessages } from '@/features/conversations/conversationService';
import { activeRequestOf } from './messageState';
import type { Conversation, GraphNode, Message, ProviderRequest } from '@/types';

export interface ArchivedConversation {
  conversation: Conversation;
  messages: Message[];
}

export interface ConversationData {
  conversation: Conversation | null;
  messages: Message[];
  /** Latest provider request per assistant message id. */
  requestByMessage: Map<string, ProviderRequest>;
  archived: ArchivedConversation[];
  /** The queued/in-flight request of this conversation, if any. Send is disabled while it exists. */
  activeRequest: ProviderRequest | undefined;
}

/** Live data for a node's active conversation (+ archived earlier ones). undefined while loading. */
export function useConversationData(node: GraphNode | undefined): ConversationData | undefined {
  const nodeId = node?.id;
  const convId = node?.conversationId ?? null;
  return useLiveQuery(
    async (): Promise<ConversationData> => {
      if (!nodeId) return { conversation: null, messages: [], requestByMessage: new Map(), archived: [], activeRequest: undefined };
      const conversation = convId ? ((await db.conversations.get(convId)) ?? null) : null;
      const messages = conversation ? await listMessages(conversation.id) : [];
      const reqs = conversation ? await db.requests.where('conversationId').equals(conversation.id).toArray() : [];
      const requestByMessage = new Map<string, ProviderRequest>();
      for (const r of reqs.sort((a, b) => a.createdAt - b.createdAt)) requestByMessage.set(r.assistantMessageId, r);
      const archivedConvs = await db.conversations
        .where('nodeId')
        .equals(nodeId)
        .filter((c) => c.status === 'archived' && c.id !== convId)
        .toArray();
      const archived: ArchivedConversation[] = [];
      for (const c of archivedConvs.sort((a, b) => a.createdAt - b.createdAt)) {
        archived.push({ conversation: c, messages: await listMessages(c.id) });
      }
      return { conversation, messages, requestByMessage, archived, activeRequest: activeRequestOf(reqs) };
    },
    [nodeId, convId],
  );
}
