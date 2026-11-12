import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { VisionBoardDB, db } from '@/storage/db';
import { createWorkspace } from '@/features/workspaces/workspaceOps';
import { createNode } from '@/features/graph/graphOps';
import { addManualResponse, deleteMessage, getOrCreateConversation, recordManualQuestion } from '@/features/conversations/conversationService';
import { applyHandoff, generateHandoffDraft } from '@/features/context/handoff';
import { makeAnswerPreview } from '@/lib/preview';

describe('answer previews on nodes', () => {
  it('makeAnswerPreview strips markdown, code and math, and truncates', () => {
    expect(makeAnswerPreview('# Title\n\n- **Bold** point\n\n```js\nx()\n```\n\n$$a=b$$ done')).toBe('Title: Bold point done');
    const long = makeAnswerPreview('word '.repeat(100), 40);
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long.endsWith('…')).toBe(true);
  });

  it('manual paste updates the preview; deleting the answer clears it', async () => {
    const ws = await createWorkspace('P');
    const node = await createNode({ workspaceId: ws.id, question: 'Q?' });
    expect(node.answerPreview).toBe('');
    const { conversation } = await recordManualQuestion(node.id, 'Q?');
    const m = await addManualResponse(conversation.id, 'An **answer**.', 'manual-paste');
    expect((await db.nodes.get(node.id))!.answerPreview).toBe('An answer.');
    await deleteMessage(m.id);
    const after = (await db.nodes.get(node.id))!;
    expect(after.answerPreview).toBe('');
    expect(after.answeredAt).toBeNull();
  });

  it('answers added to an archived (pre-handoff) conversation do not change the preview', async () => {
    const ws = await createWorkspace('H');
    const node = await createNode({ workspaceId: ws.id, question: 'Q?' });
    const conv = await getOrCreateConversation(node.id);
    await addManualResponse(conv.id, 'First answer', 'manual-paste');
    const draft = await generateHandoffDraft(node.id);
    await applyHandoff(draft.id);
    await addManualResponse(conv.id, 'Late answer to old conversation', 'manual-paste');
    expect((await db.nodes.get(node.id))!.answerPreview).toBe('First answer');
  });

  it('upgrading a v1 database backfills previews from existing answers', async () => {
    const name = `upgrade-${Date.now()}`;
    const v1 = new Dexie(name);
    v1.version(1).stores({
      workspaces: 'id, updatedAt',
      nodes: 'id, workspaceId, parentId, updatedAt',
      edges: 'id, workspaceId, source, target',
      conversations: 'id, nodeId, workspaceId',
      messages: 'id, conversationId, workspaceId, [conversationId+createdAt]',
      snapshots: 'id, nodeId, workspaceId',
      requests: 'id, status, createdAt, nodeId, conversationId',
      settings: 'key',
    });
    await v1.table('nodes').bulkAdd([
      { id: 'n1', workspaceId: 'w', parentId: null, conversationId: 'c1', title: 'A' },
      { id: 'n2', workspaceId: 'w', parentId: null, conversationId: null, title: 'B' },
    ]);
    await v1.table('messages').bulkAdd([
      { id: 'm1', conversationId: 'c1', workspaceId: 'w', role: 'assistant', status: 'complete', content: 'Old', createdAt: 1, updatedAt: 1 },
      { id: 'm2', conversationId: 'c1', workspaceId: 'w', role: 'assistant', status: 'complete', content: 'Newest **one**', createdAt: 2, updatedAt: 5 },
      { id: 'm3', conversationId: 'c1', workspaceId: 'w', role: 'assistant', status: 'failed', content: 'broken', createdAt: 3, updatedAt: 6 },
    ]);
    v1.close();
    const upgraded = new VisionBoardDB(name);
    const n1 = await upgraded.nodes.get('n1');
    const n2 = await upgraded.nodes.get('n2');
    expect(n1?.answerPreview).toBe('Newest one');
    expect(n1?.answeredAt).toBe(5);
    expect(n2?.answerPreview).toBe('');
    expect(n2?.answeredAt).toBeNull();
    upgraded.close();
  });
});
