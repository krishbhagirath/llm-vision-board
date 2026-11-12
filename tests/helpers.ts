import { db } from '@/storage/db';
import { newId } from '@/lib/id';
import { createWorkspace } from '@/features/workspaces/workspaceOps';
import { createNode } from '@/features/graph/graphOps';
import { getOrCreateConversation } from '@/features/conversations/conversationService';
import type { ID, Message } from '@/types';

let tick = 1_000_000;

/** Insert a message directly with a strictly increasing createdAt (avoids same-ms ordering ties). */
export async function addMessage(
  nodeId: ID,
  role: 'user' | 'assistant',
  content: string,
  status: Message['status'] = 'complete',
): Promise<Message> {
  const conv = await getOrCreateConversation(nodeId);
  const t = tick++;
  const m: Message = {
    id: newId(),
    conversationId: conv.id,
    workspaceId: conv.workspaceId,
    role,
    content,
    createdAt: t,
    updatedAt: t,
    status,
    providerMessageRef: null,
    sentPrompt: null,
    source: role === 'user' ? 'user' : 'automation',
    error: null,
  };
  await db.messages.add(m);
  return m;
}

export async function seedTree() {
  const ws = await createWorkspace('WS', 'Learn things');
  const root = await createNode({ workspaceId: ws.id, title: 'Root', question: 'What is root?' });
  const child = await createNode({ workspaceId: ws.id, parentId: root.id, title: 'Child', question: 'What is child?' });
  const grand = await createNode({ workspaceId: ws.id, parentId: child.id, title: 'Grand', question: 'What is grand?' });
  return { ws, root, child, grand };
}
