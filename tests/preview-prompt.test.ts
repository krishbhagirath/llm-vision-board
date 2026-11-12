import { describe, expect, it } from 'vitest';
import { db } from '@/storage/db';
import { getOrCreateConversation, preparePrompt, previewPrompt, setConversationUrl } from '@/features/conversations/conversationService';
import { addMessage, seedTree } from './helpers';

async function counts() {
  return {
    conversations: await db.conversations.count(),
    messages: await db.messages.count(),
    snapshots: await db.snapshots.count(),
    requests: await db.requests.count(),
  };
}

describe('previewPrompt', () => {
  it('creates nothing: no conversation row, no node mutation, no snapshots', async () => {
    const { child } = await seedTree();
    const before = await counts();
    const nodeBefore = await db.nodes.get(child.id);
    const r = await previewPrompt(child.id, 'follow up');
    expect(r.firstTurn).toBe(true);
    expect(r.contextPackage).not.toBeNull();
    expect(await counts()).toEqual(before);
    expect(await db.nodes.get(child.id)).toEqual(nodeBefore);
    expect((await db.nodes.get(child.id))!.conversationId).toBeNull();
  });

  it('matches preparePrompt output on the first turn (and preparePrompt does create the row)', async () => {
    const { child } = await seedTree();
    const preview = await previewPrompt(child.id, 'follow up');
    const prepared = await preparePrompt(child.id, 'follow up');
    expect(preview.prompt).toBe(prepared.prompt);
    expect(preview.contextPackage?.items.map((i) => i.title)).toEqual(prepared.contextPackage?.items.map((i) => i.title));
    expect(await db.conversations.count()).toBe(1);
  });

  it('matches preparePrompt on later turns (plain text, no package)', async () => {
    const { child } = await seedTree();
    const conv = await getOrCreateConversation(child.id);
    await setConversationUrl(conv.id, 'https://chatgpt.com/c/abc');
    const preview = await previewPrompt(child.id, '  plain me ');
    expect(preview.firstTurn).toBe(false);
    expect(preview.contextPackage).toBeNull();
    expect(preview.prompt).toBe((await preparePrompt(child.id, '  plain me ')).prompt);
  });

  it('treats a node with only a failed answer as a first turn, like preparePrompt', async () => {
    const { child } = await seedTree();
    await addMessage(child.id, 'assistant', 'oops', 'failed');
    const preview = await previewPrompt(child.id, 'again');
    expect(preview.firstTurn).toBe(true);
    expect(preview.prompt).toBe((await preparePrompt(child.id, 'again')).prompt);
  });

  it('never includes sibling branches', async () => {
    const { child, root, ws } = await seedTree();
    const { createNode } = await import('@/features/graph/graphOps');
    const sib = await createNode({ workspaceId: ws.id, parentId: root.id, title: 'SiblingSecret', question: 'sibling question' });
    expect(sib.id).not.toBe(child.id);
    const r = await previewPrompt(child.id, 'q');
    expect(r.prompt).not.toContain('SiblingSecret');
  });

  it('rejects unknown nodes', async () => {
    await expect(previewPrompt('nope', 'x')).rejects.toThrow('Node not found');
  });
});
