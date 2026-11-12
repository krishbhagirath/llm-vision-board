import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, updateSettings } from '@/storage/db';
import { RequestOrchestrator } from '@/providers/orchestrator';
import type { ProviderTransport } from '@/providers/types';
import type { PingResult, SubmitResult } from '@/lib/messages';
import { createWorkspace } from '@/features/workspaces/workspaceOps';
import { createNode, deleteSubtree } from '@/features/graph/graphOps';
import { queueAutomatedMessage, retryRequest } from '@/features/conversations/conversationService';
import type { ID, RequestStatus } from '@/types';

const TAB = 7;
let clock = 10_000;
let transport: {
  [K in keyof ProviderTransport]: ReturnType<typeof vi.fn>;
};
let orch: RequestOrchestrator;
let wsId: ID;

const ping = (over: Partial<PingResult> = {}): PingResult => ({
  ok: true,
  url: 'https://chatgpt.com/c/x',
  composerFound: true,
  loggedOutHint: false,
  generating: false,
  trackingRequestId: null,
  ...over,
});

function makeOrch(t: unknown = transport) {
  return new RequestOrchestrator({ transport: t as ProviderTransport, now: () => clock, timeoutMs: async () => 1000 });
}

beforeEach(async () => {
  clock = 10_000;
  transport = {
    findTab: vi.fn(async () => TAB),
    prepareTab: vi.fn(async () => undefined),
    submit: vi.fn(async (): Promise<SubmitResult> => ({ ok: true, duplicate: false })),
    cancel: vi.fn(async () => undefined),
    ping: vi.fn(async () => null),
  };
  orch = makeOrch();
  await updateSettings({ chatgptAutomation: true });
  wsId = (await createWorkspace('Orch', 'goal')).id;
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Create a root node + queued automated message. Small sleep keeps request createdAt strictly ordered. */
async function queue(title: string, text = `question for ${title}`) {
  const node = await createNode({ workspaceId: wsId, title });
  const res = await queueAutomatedMessage(node.id, text);
  await sleep(4);
  return { node, ...res };
}

const status = async (id: ID) => (await db.requests.get(id))!.status;
const waitStatus = (id: ID, s: RequestStatus) =>
  vi.waitFor(async () => {
    expect(await status(id)).toBe(s);
  });
const allMessages = async () => (await db.messages.toArray()).sort((a, b) => a.id.localeCompare(b.id));

/** Queue + kick + wait until the request reached `submitted` on TAB. */
async function submitted(title = 'A') {
  const q = await queue(title);
  await orch.kick();
  await waitStatus(q.request.id, 'submitted');
  return q;
}

const progress = (requestId: ID, content: string, ref: string | null = 'm1') =>
  ({ type: 'cs:progress', requestId, content, providerMessageRef: ref }) as const;
const complete = (requestId: ID, content = 'Final answer', over: Record<string, unknown> = {}) =>
  ({ type: 'cs:complete', requestId, content, url: 'https://chatgpt.com/c/conv-1', providerMessageRef: 'm1', promptVerified: true, ...over }) as const;

describe('dispatch and queueing', () => {
  it('gives every queued request a unique id', async () => {
    const qs = [await queue('a'), await queue('b'), await queue('c')];
    expect(new Set(qs.map((q) => q.request.id)).size).toBe(3);
  });

  it('dispatches to the found tab and marks it submitted', async () => {
    const q = await submitted();
    const r = (await db.requests.get(q.request.id))!;
    expect(r.tabId).toBe(TAB);
    expect(transport.prepareTab).toHaveBeenCalledWith(TAB, null, { allowSoft: true });
    expect(transport.submit).toHaveBeenCalledWith(TAB, { requestId: q.request.id, prompt: q.request.prompt, expectHistory: false, requireAnchor: false });
  });

  it('processes FIFO across two nodes, one active at a time', async () => {
    const a = await queue('A');
    const b = await queue('B');
    await orch.kick();
    await waitStatus(a.request.id, 'submitted');
    expect(await status(b.request.id)).toBe('queued');
    await orch.kick(); // a second kick must not start B
    expect(await status(b.request.id)).toBe('queued');
    expect(transport.submit).toHaveBeenCalledTimes(1);
    expect(await db.requests.where('status').anyOf(['dispatching', 'submitted', 'streaming']).count()).toBe(1);

    await orch.handleContentMessage(TAB, complete(a.request.id));
    await waitStatus(b.request.id, 'submitted');
    expect(transport.submit).toHaveBeenCalledTimes(2);
    expect(transport.submit.mock.calls[1]![1].requestId).toBe(b.request.id);
    expect(await status(a.request.id)).toBe('complete');
  });

  it('fails the request when automation is disabled', async () => {
    await updateSettings({ chatgptAutomation: false });
    const q = await queue('A');
    await orch.kick();
    const r = (await db.requests.get(q.request.id))!;
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/automation is disabled/i);
    const m = (await db.messages.get(q.assistantMessage.id))!;
    expect(m.status).toBe('failed');
    expect(m.error).toMatch(/disabled/i);
    expect(transport.findTab).not.toHaveBeenCalled();
  });

  it('fails with the not-connected message when no tab exists', async () => {
    transport.findTab.mockResolvedValue(null);
    const q = await queue('A');
    await orch.kick();
    const r = (await db.requests.get(q.request.id))!;
    expect(r.status).toBe('failed');
    expect(r.error).toBe('ChatGPT is not connected. Open ChatGPT to continue.');
    expect((await db.messages.get(q.assistantMessage.id))!.error).toBe(r.error);
  });

  it('fails when submit returns ok:false and then moves on to the next request', async () => {
    transport.submit.mockResolvedValueOnce({ ok: false, error: 'composer missing', retryable: true });
    const a = await queue('A');
    const b = await queue('B');
    await orch.kick();
    await waitStatus(a.request.id, 'failed');
    expect((await db.requests.get(a.request.id))!.error).toBe('composer missing');
    await waitStatus(b.request.id, 'submitted');
  });

  it('fails when the transport throws', async () => {
    transport.prepareTab.mockRejectedValueOnce(new Error('tab gone'));
    const q = await queue('A');
    await orch.kick();
    await waitStatus(q.request.id, 'failed');
    expect((await db.requests.get(q.request.id))!.error).toContain('tab gone');
  });
});

describe('content-script events', () => {
  it('progress updates the assistant message to streaming content', async () => {
    const q = await submitted();
    await orch.handleContentMessage(TAB, progress(q.request.id, 'partial one'));
    let m = (await db.messages.get(q.assistantMessage.id))!;
    expect(m.content).toBe('partial one');
    expect(m.status).toBe('streaming');
    expect(m.providerMessageRef).toBe('m1');
    expect(await status(q.request.id)).toBe('streaming');
    await orch.handleContentMessage(TAB, progress(q.request.id, 'partial one two'));
    m = (await db.messages.get(q.assistantMessage.id))!;
    expect(m.content).toBe('partial one two');
  });

  it('complete stores content, providerUrl and marks the request complete', async () => {
    const q = await submitted();
    await orch.handleContentMessage(TAB, complete(q.request.id, 'The answer'));
    const m = (await db.messages.get(q.assistantMessage.id))!;
    expect(m.status).toBe('complete');
    expect(m.content).toBe('The answer');
    expect(m.error).toBeNull();
    expect((await db.conversations.get(q.conversation.id))!.providerUrl).toBe('https://chatgpt.com/c/conv-1');
    expect(await status(q.request.id)).toBe('complete');
  });

  it('keeps a warning when the prompt could not be verified', async () => {
    const q = await submitted();
    await orch.handleContentMessage(TAB, complete(q.request.id, 'ans', { promptVerified: false }));
    const m = (await db.messages.get(q.assistantMessage.id))!;
    expect(m.status).toBe('complete');
    expect(m.error).toMatch(/confirm the submitted prompt/i);
    expect((await db.conversations.get(q.conversation.id))!.context.warnings.length).toBe(1);
  });

  it('fails when complete arrives with empty content', async () => {
    const q = await submitted();
    await orch.handleContentMessage(TAB, complete(q.request.id, '   '));
    expect(await status(q.request.id)).toBe('failed');
    expect((await db.messages.get(q.assistantMessage.id))!.status).toBe('failed');
  });

  it('cs:failed marks failed or interrupted', async () => {
    const q = await submitted();
    await orch.handleContentMessage(TAB, { type: 'cs:failed', requestId: q.request.id, error: 'boom', interrupted: true });
    expect(await status(q.request.id)).toBe('interrupted');
    expect((await db.messages.get(q.assistantMessage.id))!.error).toBe('boom');
  });
});

describe('cross-node contamination protection', () => {
  it('ignores events with the wrong requestId, wrong tabId, or for non-active requests', async () => {
    const a = await queue('A');
    const b = await queue('B');
    await orch.kick();
    await waitStatus(a.request.id, 'submitted');
    const before = await allMessages();

    // wrong request id (random) and queued request id (not active)
    await orch.handleContentMessage(TAB, progress('does-not-exist', 'EVIL'));
    await orch.handleContentMessage(TAB, progress(b.request.id, 'EVIL for B'));
    await orch.handleContentMessage(TAB, complete(b.request.id, 'EVIL complete B'));
    // wrong tab
    await orch.handleContentMessage(999, progress(a.request.id, 'EVIL wrong tab'));
    await orch.handleContentMessage(999, complete(a.request.id, 'EVIL wrong tab complete'));
    await orch.handleContentMessage(999, { type: 'cs:failed', requestId: a.request.id, error: 'x', interrupted: false });

    expect(await allMessages()).toEqual(before);
    expect(await status(a.request.id)).toBe('submitted');
    expect(await status(b.request.id)).toBe('queued');
  });

  it('ignores events for completed and cancelled requests', async () => {
    const a = await submitted('A');
    await orch.handleContentMessage(TAB, complete(a.request.id, 'good'));
    const b = await queue('B');
    await orch.kick();
    await waitStatus(b.request.id, 'submitted');
    await orch.cancel(b.request.id);
    const before = await allMessages();
    await orch.handleContentMessage(TAB, progress(a.request.id, 'late A'));
    await orch.handleContentMessage(TAB, complete(a.request.id, 'late complete A'));
    await orch.handleContentMessage(TAB, progress(b.request.id, 'late B'));
    await orch.handleContentMessage(TAB, complete(b.request.id, 'late complete B'));
    expect(await allMessages()).toEqual(before);
    expect((await db.messages.get(a.assistantMessage.id))!.content).toBe('good');
    expect((await db.messages.get(b.assistantMessage.id))!.content).toBe('');
  });

  it('late progress after complete does not overwrite', async () => {
    const q = await submitted();
    await orch.handleContentMessage(TAB, complete(q.request.id, 'FINAL'));
    await orch.handleContentMessage(TAB, progress(q.request.id, 'stale partial'));
    const m = (await db.messages.get(q.assistantMessage.id))!;
    expect(m.content).toBe('FINAL');
    expect(m.status).toBe('complete');
    expect(await status(q.request.id)).toBe('complete');
  });

  it('fails the request when the message/conversation/node chain is inconsistent', async () => {
    const a = await submitted('A');
    const other = await queue('Other');
    // point A's assistant message at the other node's conversation
    await db.messages.update(a.assistantMessage.id, { conversationId: other.conversation.id });
    await orch.handleContentMessage(TAB, progress(a.request.id, 'x'));
    expect(await status(a.request.id)).toBe('failed');
    expect((await db.requests.get(a.request.id))!.error).toMatch(/integrity/i);
  });

  it('events after the node is deleted are ignored (deleteSubtree)', async () => {
    const q = await submitted();
    await deleteSubtree(q.node.id);
    expect(await status(q.request.id)).toBe('cancelled');
    await orch.handleContentMessage(TAB, progress(q.request.id, 'zombie'));
    await orch.handleContentMessage(TAB, complete(q.request.id, 'zombie done'));
    expect(await db.messages.count()).toBe(0);
    expect(await db.conversations.count()).toBe(0);
  });

  it('events after the node row vanishes cancel the request instead of writing', async () => {
    const q = await submitted();
    await db.nodes.delete(q.node.id);
    await orch.handleContentMessage(TAB, progress(q.request.id, 'zombie'));
    expect(await status(q.request.id)).toBe('cancelled');
    expect((await db.messages.get(q.assistantMessage.id))!.content).toBe('');
  });
});

describe('cancel, tab lifecycle', () => {
  it('cancels a queued request without touching the transport', async () => {
    const q = await queue('A');
    await orch.cancel(q.request.id);
    expect(await status(q.request.id)).toBe('cancelled');
    expect((await db.messages.get(q.assistantMessage.id))!.status).toBe('cancelled');
    expect(transport.cancel).not.toHaveBeenCalled();
  });

  it('cancels an active submitted request via transport.cancel and starts the next', async () => {
    const a = await submitted('A');
    const b = await queue('B');
    await orch.cancel(a.request.id);
    expect(transport.cancel).toHaveBeenCalledWith(TAB, a.request.id);
    expect(await status(a.request.id)).toBe('cancelled');
    expect((await db.messages.get(a.assistantMessage.id))!.status).toBe('cancelled');
    await waitStatus(b.request.id, 'submitted');
  });

  it('marks the active request interrupted when its tab is removed', async () => {
    const q = await submitted();
    await orch.onTabRemoved(TAB + 1); // unrelated tab: no effect
    expect(await status(q.request.id)).toBe('submitted');
    await orch.onTabRemoved(TAB);
    expect(await status(q.request.id)).toBe('interrupted');
    expect((await db.messages.get(q.assistantMessage.id))!.status).toBe('interrupted');
  });

  it('cs:ready on the request tab while submitted -> interrupted', async () => {
    const q = await submitted();
    await orch.handleContentMessage(TAB, { type: 'cs:ready', url: 'https://chatgpt.com/' });
    expect(await status(q.request.id)).toBe('interrupted');
  });

  it('cs:ready from another tab is ignored', async () => {
    const q = await submitted();
    await orch.handleContentMessage(TAB + 5, { type: 'cs:ready', url: 'https://chatgpt.com/' });
    expect(await status(q.request.id)).toBe('submitted');
  });

  it('cs:ready while dispatching is ignored', async () => {
    let release!: () => void;
    transport.prepareTab.mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
    const q = await queue('A');
    await orch.kick();
    await vi.waitFor(() => expect(transport.prepareTab).toHaveBeenCalled());
    expect(await status(q.request.id)).toBe('dispatching');
    await orch.handleContentMessage(TAB, { type: 'cs:ready', url: 'https://chatgpt.com/' });
    expect(await status(q.request.id)).toBe('dispatching');
    release();
    await waitStatus(q.request.id, 'submitted');
  });

  it('finish never overwrites a terminal state (late submit failure after cancel)', async () => {
    let resolveSubmit!: (r: SubmitResult) => void;
    transport.submit.mockImplementationOnce(() => new Promise<SubmitResult>((r) => (resolveSubmit = r)));
    const q = await queue('A');
    await orch.kick();
    await vi.waitFor(() => expect(transport.submit).toHaveBeenCalled());
    await orch.cancel(q.request.id);
    expect(await status(q.request.id)).toBe('cancelled');
    resolveSubmit({ ok: false, error: 'late failure', retryable: false });
    await sleep(30);
    const r = (await db.requests.get(q.request.id))!;
    expect(r.status).toBe('cancelled');
    expect(r.error).not.toBe('late failure');
    expect((await db.messages.get(q.assistantMessage.id))!.status).toBe('cancelled');
  });
});

describe('resume', () => {
  it('interrupts a submitted request when ping returns null', async () => {
    const q = await submitted();
    const fresh = makeOrch();
    transport.ping.mockResolvedValue(null);
    await fresh.resume();
    expect(await status(q.request.id)).toBe('interrupted');
  });

  it('interrupts when the tab is tracking a different request', async () => {
    const q = await submitted();
    transport.ping.mockResolvedValue(ping({ trackingRequestId: 'someone-else' }));
    await makeOrch().resume();
    expect(await status(q.request.id)).toBe('interrupted');
  });

  it('keeps the request when the tab tracks the same id', async () => {
    const q = await submitted();
    transport.ping.mockResolvedValue(ping({ trackingRequestId: q.request.id, generating: true }));
    await makeOrch().resume();
    expect(await status(q.request.id)).toBe('submitted');
  });

  it('interrupts an active request that never got a tab', async () => {
    const q = await queue('A');
    await db.requests.update(q.request.id, { status: 'dispatching', tabId: null });
    await makeOrch().resume();
    expect(await status(q.request.id)).toBe('interrupted');
  });

  it('re-dispatches a dispatching request', async () => {
    const q = await queue('A');
    await db.requests.update(q.request.id, { status: 'dispatching', tabId: TAB, lastActivityAt: clock });
    await makeOrch().resume();
    await waitStatus(q.request.id, 'submitted');
    expect(transport.submit).toHaveBeenCalledTimes(1);
  });

  it('does nothing when there is no active request', async () => {
    await makeOrch().resume();
    expect(transport.ping).not.toHaveBeenCalled();
  });
});

describe('watchdog', () => {
  it('leaves fresh requests alone', async () => {
    const q = await submitted();
    clock += 500;
    await orch.watchdog();
    expect(await status(q.request.id)).toBe('submitted');
  });

  it('fails a stale request with a timeout', async () => {
    const q = await submitted();
    clock += 5000;
    transport.ping.mockResolvedValue(null);
    await orch.watchdog();
    const r = (await db.requests.get(q.request.id))!;
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/timed out/i);
  });

  it('keeps a stale request alive if the tab reports generating and tracking it', async () => {
    const q = await submitted();
    clock += 5000;
    transport.ping.mockResolvedValue(ping({ generating: true, trackingRequestId: q.request.id }));
    await orch.watchdog();
    const r = (await db.requests.get(q.request.id))!;
    expect(r.status).toBe('submitted');
    expect(r.lastActivityAt).toBe(clock);
    // and a second watchdog right after does not time out
    await orch.watchdog();
    expect(await status(q.request.id)).toBe('submitted');
  });

  it('still fails when generating but tracking a different request', async () => {
    const q = await submitted();
    clock += 5000;
    transport.ping.mockResolvedValue(ping({ generating: true, trackingRequestId: 'other' }));
    await orch.watchdog();
    expect(await status(q.request.id)).toBe('failed');
  });
});

describe('retryRequest', () => {
  it('creates a new queued request with attempt+1 and resets the assistant message', async () => {
    const q = await submitted();
    await orch.handleContentMessage(TAB, { type: 'cs:failed', requestId: q.request.id, error: 'nope', interrupted: false });
    expect(await status(q.request.id)).toBe('failed');
    const retry = await retryRequest(q.request.id);
    expect(retry.id).not.toBe(q.request.id);
    expect(retry.status).toBe('queued');
    expect(retry.attempt).toBe(2);
    expect(retry.tabId).toBeNull();
    expect(retry.assistantMessageId).toBe(q.assistantMessage.id);
    const m = (await db.messages.get(q.assistantMessage.id))!;
    expect(m.status).toBe('pending');
    expect(m.error).toBeNull();
    expect(m.content).toBe('');
    // the retry actually runs
    await orch.kick();
    await waitStatus(retry.id, 'submitted');
    await orch.handleContentMessage(TAB, complete(retry.id, 'second time'));
    expect((await db.messages.get(q.assistantMessage.id))!.content).toBe('second time');
  });

  it('refuses to retry an active request', async () => {
    const q = await submitted();
    await expect(retryRequest(q.request.id)).rejects.toThrow(/Only failed/);
  });
});

describe('branch switching (soft navigation safeguards)', () => {
  it('requires prompt anchoring when the tab was switched without a reload', async () => {
    transport.prepareTab.mockResolvedValueOnce('soft');
    const q = await submitted('Soft');
    expect(transport.submit).toHaveBeenCalledWith(TAB, expect.objectContaining({ requestId: q.request.id, requireAnchor: true }));
  });

  it('does not require anchoring after a full reload or when already on the conversation', async () => {
    transport.prepareTab.mockResolvedValueOnce('hard');
    await submitted('Hard');
    expect(transport.submit).toHaveBeenLastCalledWith(TAB, expect.objectContaining({ requireAnchor: false }));
  });

  it('never attempts a soft switch when the setting is off', async () => {
    await updateSettings({ softNavigation: false });
    await submitted('NoSoft');
    expect(transport.prepareTab).toHaveBeenCalledWith(TAB, null, { allowSoft: false });
  });

  it('asks the page to wait for history when continuing an existing ChatGPT conversation', async () => {
    const first = await submitted('Continue');
    await orch.handleContentMessage(TAB, complete(first.request.id));
    await waitStatus(first.request.id, 'complete');
    const second = await queueAutomatedMessage(first.node.id, 'follow-up');
    await orch.kick();
    await waitStatus(second.request.id, 'submitted');
    expect(transport.prepareTab).toHaveBeenLastCalledWith(TAB, 'https://chatgpt.com/c/conv-1', { allowSoft: true });
    expect(transport.submit).toHaveBeenLastCalledWith(TAB, expect.objectContaining({ requestId: second.request.id, expectHistory: true }));
  });

  it('exposes a human-readable step while a request is in flight', async () => {
    const q = await submitted('Detail');
    expect((await db.requests.get(q.request.id))!.detail).toMatch(/waiting for chatgpt/i);
    await orch.handleContentMessage(TAB, progress(q.request.id, 'partial'));
    expect((await db.requests.get(q.request.id))!.detail).toMatch(/writing/i);
  });

  it('updates the node answer preview when a reply completes', async () => {
    const q = await submitted('Preview');
    await orch.handleContentMessage(TAB, complete(q.request.id, '## Heading\n\nThe **answer** text.'));
    await waitStatus(q.request.id, 'complete');
    const node = (await db.nodes.get(q.node.id))!;
    expect(node.answerPreview).toBe('Heading: The answer text.');
    expect(node.answeredAt).not.toBeNull();
  });
});
