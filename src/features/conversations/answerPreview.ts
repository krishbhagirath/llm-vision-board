import { db } from '@/storage/db';
import { makeAnswerPreview } from '@/lib/preview';
import type { ID } from '@/types';

/**
 * Recompute the denormalized answer preview of the node owning `conversationId`
 * from its latest complete assistant message. Only the node's ACTIVE conversation
 * updates the preview (archived pre-handoff conversations never do).
 */
export async function refreshNodePreview(conversationId: ID): Promise<void> {
  await db.transaction('rw', db.conversations, db.nodes, db.messages, async () => {
    const conv = await db.conversations.get(conversationId);
    if (!conv) return;
    const node = await db.nodes.get(conv.nodeId);
    if (!node || node.conversationId !== conv.id) return;
    const latest = await db.messages
      .where('[conversationId+createdAt]')
      .between([conv.id, 0], [conv.id, Number.MAX_SAFE_INTEGER])
      .filter((m) => m.role === 'assistant' && m.status === 'complete' && !!m.content.trim())
      .last();
    await db.nodes.update(node.id, {
      answerPreview: latest ? makeAnswerPreview(latest.content) : '',
      answeredAt: latest ? latest.updatedAt : null,
    });
  });
}
