import { describe, expect, it } from 'vitest';
import { activeRequestOf, busyReason, deriveAssistantState, splitDiagnostics } from '@/features/conversations/ui/messageState';
import type { Message, ProviderRequest } from '@/types';

const msg = (over: Partial<Message> = {}): Message => ({
  id: 'm',
  conversationId: 'c',
  workspaceId: 'w',
  role: 'assistant',
  content: '',
  createdAt: 1,
  updatedAt: 1,
  status: 'pending',
  providerMessageRef: null,
  sentPrompt: null,
  source: 'automation',
  error: null,
  ...over,
});
const req = (over: Partial<ProviderRequest> = {}): ProviderRequest => ({
  id: 'r',
  workspaceId: 'w',
  nodeId: 'n',
  conversationId: 'c',
  userMessageId: 'u',
  assistantMessageId: 'm',
  provider: 'chatgpt-web',
  prompt: 'p',
  targetUrl: null,
  status: 'queued',
  error: null,
  tabId: null,
  attempt: 1,
  createdAt: 1,
  updatedAt: 1,
  lastActivityAt: 1,
  ...over,
});

describe('splitDiagnostics', () => {
  it('separates the human sentence from the diagnostics tail', () => {
    const r = splitDiagnostics('ChatGPT did not respond. Retry. [diagnostics: url=x; composer=false]');
    expect(r.human).toBe('ChatGPT did not respond. Retry.');
    expect(r.diagnostics).toBe('url=x; composer=false');
  });
  it('passes plain errors through and handles null', () => {
    expect(splitDiagnostics('Plain failure')).toEqual({ human: 'Plain failure', diagnostics: null });
    expect(splitDiagnostics(null)).toEqual({ human: null, diagnostics: null });
    expect(splitDiagnostics('[diagnostics: only]')).toEqual({ human: null, diagnostics: 'only' });
  });
});

describe('deriveAssistantState', () => {
  it('waiting uses request.detail, else a default per request status', () => {
    const a = deriveAssistantState(msg(), req({ status: 'submitted', detail: 'Opening this branch’s ChatGPT conversation…' }));
    expect(a).toMatchObject({ phase: 'waiting', detail: 'Opening this branch’s ChatGPT conversation…', canCancel: true, inFlight: true });
    expect(deriveAssistantState(msg(), req({ status: 'queued' })).detail).toMatch(/Queued/);
    expect(deriveAssistantState(msg(), req({ status: 'dispatching' })).detail).toBe('Sending your prompt…');
    expect(deriveAssistantState(msg(), undefined).canCancel).toBe(false);
  });
  it('writing is streaming with a cancel option', () => {
    const s = deriveAssistantState(msg({ status: 'streaming', content: 'Hi' }), req({ status: 'streaming', detail: 'ChatGPT is writing…' }));
    expect(s).toMatchObject({ phase: 'writing', label: 'Writing', canCancel: true });
  });
  it('failed / interrupted / cancelled are retryable only with a terminal request', () => {
    const f = deriveAssistantState(msg({ status: 'failed', error: 'Nope [diagnostics: a=b]' }), req({ status: 'failed' }));
    expect(f).toMatchObject({ phase: 'failed', canRetry: true, human: 'Nope', diagnostics: 'a=b', inFlight: false });
    expect(deriveAssistantState(msg({ status: 'interrupted' }), req({ status: 'interrupted' })).canRetry).toBe(true);
    expect(deriveAssistantState(msg({ status: 'cancelled' }), req({ status: 'cancelled' })).phase).toBe('cancelled');
    expect(deriveAssistantState(msg({ status: 'failed' }), undefined).canRetry).toBe(false);
  });
  it('complete is captured', () => {
    expect(deriveAssistantState(msg({ status: 'complete', content: 'x' }), req({ status: 'complete' }))).toMatchObject({ phase: 'captured', canCancel: false });
  });
});

describe('activeRequestOf / busyReason', () => {
  it('finds the newest in-flight request and explains it', () => {
    const rs = [req({ id: 'a', status: 'complete' }), req({ id: 'b', status: 'queued', createdAt: 2 }), req({ id: 'c', status: 'streaming', createdAt: 3 })];
    expect(activeRequestOf(rs)?.id).toBe('c');
    expect(activeRequestOf([req({ status: 'failed' })])).toBeUndefined();
    expect(busyReason(rs[2])).toMatch(/still writing/);
    expect(busyReason(rs[1])).toMatch(/in progress/);
    expect(busyReason(undefined)).toBeNull();
  });
});
