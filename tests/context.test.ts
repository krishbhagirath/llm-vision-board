import { describe, it, expect } from 'vitest';
import { db } from '@/storage/db';
import { createWorkspace } from '@/features/workspaces/workspaceOps';
import { addLink, createNode } from '@/features/graph/graphOps';
import { buildContextPackage, loadContextInput } from '@/features/context/contextBuilder';
import { estimateTokens, formatTokenEstimate } from '@/features/context/tokens';
import { applyHandoff, generateHandoffDraft } from '@/features/context/handoff';
import {
  getOrCreateConversation,
  listMessages,
  preparePrompt,
  queueAutomatedMessage,
  setConversationUrl,
} from '@/features/conversations/conversationService';
import { addMessage, seedTree } from './helpers';

describe('buildContextPackage', () => {
  it('includes ancestors root→parent, the passage and the question', async () => {
    const ws = await createWorkspace('W', 'Goal text');
    const root = await createNode({ workspaceId: ws.id, title: 'RootTitle', question: 'RootQuestion?' });
    const mid = await createNode({ workspaceId: ws.id, parentId: root.id, title: 'MidTitle', question: 'MidQuestion?' });
    const leaf = await createNode({ workspaceId: ws.id, parentId: mid.id, title: 'Leaf', sourcePassage: 'PASSAGE_TEXT here' });
    const input = await loadContextInput(leaf.id);
    const pkg = buildContextPackage(input, 'MyFinalQuestion?');
    const p = pkg.prompt;
    expect(p).toContain('Q: RootQuestion?');
    expect(p).toContain('Q: MidQuestion?');
    expect(p.indexOf('RootQuestion?')).toBeLessThan(p.indexOf('MidQuestion?'));
    expect(p).toContain('PASSAGE_TEXT here');
    expect(p).toContain('Goal text');
    expect(p.trimEnd().endsWith('MyFinalQuestion?')).toBe(true);
    expect(pkg.items.filter((i) => i.kind === 'ancestor').map((i) => i.title)).toEqual(['RootTitle', 'MidTitle']);
    expect(pkg.sourceNodeIds).toEqual(expect.arrayContaining([root.id, mid.id]));
    expect(pkg.approxTokens).toBeGreaterThan(0);
  });

  it('returns just the question when there is no context at all', async () => {
    const ws = await createWorkspace('W');
    const n = await createNode({ workspaceId: ws.id, title: 'solo' });
    const pkg = buildContextPackage(await loadContextInput(n.id), '  hello  ');
    expect(pkg.items).toHaveLength(0);
    expect(pkg.prompt).toBe('hello');
  });

  it('never leaks sibling questions, answers or summaries', async () => {
    const ws = await createWorkspace('W');
    const root = await createNode({ workspaceId: ws.id, title: 'Root', question: 'root q' });
    const a = await createNode({ workspaceId: ws.id, parentId: root.id, title: 'A', question: 'A q' });
    const b = await createNode({ workspaceId: ws.id, parentId: root.id, title: 'B', question: 'SIBQUESTIONMARKER91' });
    const bChild = await createNode({ workspaceId: ws.id, parentId: b.id, title: 'BC', question: 'SIBCHILDMARKER77' });
    await db.nodes.update(b.id, { summary: 'SIBSUMMARYMARKER55' });
    await addMessage(b.id, 'assistant', 'SIBANSWERMARKER33');
    await addMessage(bChild.id, 'assistant', 'SIBCHILDANSWERMARKER11');
    await addMessage(root.id, 'assistant', 'ROOTANSWEROK');

    const pkg = buildContextPackage(await loadContextInput(a.id), 'what about A?');
    for (const marker of ['SIBQUESTIONMARKER91', 'SIBCHILDMARKER77', 'SIBSUMMARYMARKER55', 'SIBANSWERMARKER33', 'SIBCHILDANSWERMARKER11']) {
      expect(pkg.prompt).not.toContain(marker);
    }
    expect(pkg.prompt).not.toMatch(/\bB\b.*SIBLING/);
    expect(pkg.prompt).toContain('ROOTANSWEROK');
    expect(pkg.sourceNodeIds).not.toContain(b.id);
    expect(pkg.sourceNodeIds).not.toContain(bChild.id);
  });

  it('includes explicitly linked nodes', async () => {
    const { ws, grand } = await seedTree();
    const other = await createNode({ workspaceId: ws.id, title: 'Linked', question: 'LINKED_Q' });
    await db.nodes.update(other.id, { summary: 'LINKEDSUMMARY' });
    await addLink(ws.id, grand.id, other.id);
    const pkg = buildContextPackage(await loadContextInput(grand.id), 'q');
    expect(pkg.prompt).toContain('LINKEDSUMMARY');
    expect(pkg.items.some((i) => i.kind === 'linked' && i.nodeId === other.id)).toBe(true);
    // link in the other direction also counts
    const pkg2 = buildContextPackage(await loadContextInput(other.id), 'q');
    expect(pkg2.items.some((i) => i.kind === 'linked' && i.nodeId === grand.id)).toBe(true);
  });

  it('prefers the node summary over the first answer', async () => {
    const { root, child } = await seedTree();
    await addMessage(root.id, 'assistant', 'FIRSTANSWERTEXT');
    await db.nodes.update(root.id, { summary: 'EXPLICITSUMMARYTEXT' });
    const pkg = buildContextPackage(await loadContextInput(child.id), 'q');
    expect(pkg.prompt).toContain('EXPLICITSUMMARYTEXT');
    expect(pkg.prompt).not.toContain('FIRSTANSWERTEXT');
  });

  it('uses the answer when there is no summary', async () => {
    const { root, child } = await seedTree();
    await addMessage(root.id, 'assistant', 'FIRSTANSWERTEXT');
    const pkg = buildContextPackage(await loadContextInput(child.id), 'q');
    expect(pkg.prompt).toContain('FIRSTANSWERTEXT');
  });
});

describe('loadContextInput', () => {
  it('uses the first COMPLETE answer of ancestors', async () => {
    const { root, child } = await seedTree();
    await addMessage(root.id, 'user', 'user text');
    await addMessage(root.id, 'assistant', 'failed text', 'failed');
    await addMessage(root.id, 'assistant', 'GOODONE');
    await addMessage(root.id, 'assistant', 'LATERONE');
    const input = await loadContextInput(child.id);
    expect(input.firstAnswers.get(root.id)).toBe('GOODONE');
    expect(input.workspaceDescription).toBe('Learn things');
    await expect(loadContextInput('missing')).rejects.toThrow();
  });
});

describe('preparePrompt', () => {
  it('returns the full package on the first turn', async () => {
    const { child } = await seedTree();
    const r = await preparePrompt(child.id, 'follow up');
    expect(r.contextPackage).not.toBeNull();
    expect(r.prompt).toContain('[Context from my study map');
    expect(r.prompt).toContain('follow up');
  });

  it('returns plain text once a providerUrl exists', async () => {
    const { child } = await seedTree();
    const conv = await getOrCreateConversation(child.id);
    await setConversationUrl(conv.id, 'https://chatgpt.com/c/xyz');
    const r = await preparePrompt(child.id, '  plain me ');
    expect(r.contextPackage).toBeNull();
    expect(r.prompt).toBe('plain me');
  });

  it('returns plain text once a complete answer exists', async () => {
    const { child } = await seedTree();
    await addMessage(child.id, 'assistant', 'done');
    const r = await preparePrompt(child.id, 'next');
    expect(r.contextPackage).toBeNull();
    expect(r.prompt).toBe('next');
  });

  it('still uses the package when only a failed answer exists', async () => {
    const { child } = await seedTree();
    await addMessage(child.id, 'assistant', 'oops', 'failed');
    expect((await preparePrompt(child.id, 'again')).contextPackage).not.toBeNull();
  });
});

describe('queueAutomatedMessage', () => {
  it('creates user + pending assistant + queued request and stores a context snapshot', async () => {
    const { child } = await seedTree();
    const r = await queueAutomatedMessage(child.id, 'Explain child');
    expect(r.userMessage.role).toBe('user');
    expect(r.userMessage.content).toBe('Explain child');
    expect(r.userMessage.sentPrompt).toContain('[Context from my study map');
    expect(r.assistantMessage.role).toBe('assistant');
    expect(r.assistantMessage.status).toBe('pending');
    expect(r.assistantMessage.createdAt).toBeGreaterThan(r.userMessage.createdAt);
    expect(r.request.status).toBe('queued');
    expect(r.request.attempt).toBe(1);
    expect(r.request.prompt).toBe(r.userMessage.sentPrompt);
    expect(r.request.nodeId).toBe(child.id);
    const msgs = await listMessages(r.conversation.id);
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
    const snaps = await db.snapshots.where('nodeId').equals(child.id).toArray();
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.kind).toBe('context-package');
    expect(snaps[0]!.summary).toBe(r.request.prompt);
    const conv = (await db.conversations.get(r.conversation.id))!;
    expect(conv.context.initialPackageId).toBe(snaps[0]!.id);
    expect(conv.context.approxTokensSent).toBeGreaterThan(0);
  });

  it('rejects empty text and a second request while one is active', async () => {
    const { child } = await seedTree();
    await expect(queueAutomatedMessage(child.id, '   ')).rejects.toThrow(/empty/i);
    await queueAutomatedMessage(child.id, 'one');
    await expect(queueAutomatedMessage(child.id, 'two')).rejects.toThrow(/already has a request in progress/);
    expect(await db.requests.count()).toBe(1);
  });

  it('gives sibling nodes different conversations and separate requests', async () => {
    const { ws, root } = await seedTree();
    const a = await createNode({ workspaceId: ws.id, parentId: root.id, title: 'A' });
    const b = await createNode({ workspaceId: ws.id, parentId: root.id, title: 'B' });
    const ra = await queueAutomatedMessage(a.id, 'qa');
    const rb = await queueAutomatedMessage(b.id, 'qb');
    expect(ra.conversation.id).not.toBe(rb.conversation.id);
    expect(ra.request.conversationId).not.toBe(rb.request.conversationId);
    expect(ra.request.nodeId).toBe(a.id);
    expect(rb.request.nodeId).toBe(b.id);
    expect(rb.request.prompt).not.toContain('qa');
  });
});

describe('token estimates', () => {
  it('estimateTokens is monotonic and zero for empty', () => {
    expect(estimateTokens('')).toBe(0);
    let prev = 0;
    for (let i = 1; i <= 50; i++) {
      const n = estimateTokens('word '.repeat(i * 3));
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
    expect(estimateTokens('a'.repeat(400))).toBeGreaterThan(estimateTokens('a'.repeat(40)));
  });

  it('formatTokenEstimate is labelled as approximate', () => {
    for (const n of [0, 12, 999, 1500, 24000]) {
      const s = formatTokenEstimate(n);
      expect(s).toContain('≈');
      expect(s).toContain('est.');
    }
    expect(formatTokenEstimate(1500)).toContain('1.5k');
  });
});

describe('handoff', () => {
  async function conversationWithContent() {
    const { ws, root, child } = await seedTree();
    await addMessage(child.id, 'user', 'I must keep answers short. Please explain thing.');
    await addMessage(child.id, 'assistant', '# Big Idea\n\nGradient descent is a method for optimization.\n\nSome **Learning Rate** talk and **Momentum** too.');
    return { ws, root, child };
  }

  it('generateHandoffDraft persists a draft handoff snapshot with extracted concepts', async () => {
    const { child } = await conversationWithContent();
    const snap = await generateHandoffDraft(child.id);
    expect(snap.kind).toBe('handoff');
    expect(snap.handoffStatus).toBe('draft');
    expect(snap.version).toBe(1);
    expect(snap.content!.concepts).toEqual(expect.arrayContaining(['Big Idea', 'Learning Rate', 'Momentum']));
    expect(snap.content!.constraints.join(' ')).toMatch(/must keep answers short/);
    expect(snap.summary).toContain('Key concepts covered');
    expect(snap.summary).toContain('Learning Rate');
    const stored = (await db.snapshots.get(snap.id))!;
    expect(stored.handoffStatus).toBe('draft');
    const snap2 = await generateHandoffDraft(child.id);
    expect(snap2.version).toBe(2);
  });

  it('refuses when the node has no conversation', async () => {
    const { root } = await seedTree();
    await expect(generateHandoffDraft(root.id)).rejects.toThrow(/no conversation/i);
  });

  it('applyHandoff archives the old conversation, starts a new one, keeps messages, and seeds the next prompt', async () => {
    const { child } = await conversationWithContent();
    const oldConvId = (await db.nodes.get(child.id))!.conversationId!;
    const snap = await generateHandoffDraft(child.id);
    const conv = await applyHandoff(snap.id, `${snap.summary}\nEDITED_HANDOFF_LINE`);

    expect((await db.conversations.get(oldConvId))!.status).toBe('archived');
    expect(conv.status).toBe('active');
    expect(conv.id).not.toBe(oldConvId);
    expect(conv.context.handoffSnapshotId).toBe(snap.id);
    expect((await db.nodes.get(child.id))!.conversationId).toBe(conv.id);
    expect((await db.snapshots.get(snap.id))!.handoffStatus).toBe('applied');
    expect(await listMessages(oldConvId)).toHaveLength(2);
    expect(await listMessages(conv.id)).toHaveLength(0);

    const prepared = await preparePrompt(child.id, 'continue please');
    expect(prepared.conversation.id).toBe(conv.id);
    expect(prepared.prompt).toContain('Summary of my previous conversation');
    expect(prepared.prompt).toContain('EDITED_HANDOFF_LINE');
    expect(prepared.prompt).toContain('Learning Rate');
  });
});
