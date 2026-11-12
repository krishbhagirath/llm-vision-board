// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assistantMessages,
  extractMarkdown,
  findComposer,
  findSendButton,
  isGenerating,
  promptMatches,
  userMessages,
} from '@/providers/chatgpt/dom';
import { ChatGPTContentController } from '@/providers/chatgpt/contentController';
import type { ContentToBackground } from '@/lib/messages';

function setupPage() {
  document.body.innerHTML = `
    <main id="thread"></main>
    <form>
      <textarea id="prompt-textarea"></textarea>
      <button data-testid="send-button" type="button">Send</button>
    </form>`;
  return {
    thread: document.getElementById('thread')!,
    composer: document.getElementById('prompt-textarea') as HTMLTextAreaElement,
    send: document.querySelector('button[data-testid="send-button"]') as HTMLButtonElement,
  };
}

function assistantEl(id: string, innerHtml: string): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-message-author-role', 'assistant');
  el.setAttribute('data-message-id', id);
  el.innerHTML = `<div class="markdown">${innerHtml}</div>`;
  return el;
}

function userEl(id: string, text: string): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-message-author-role', 'user');
  el.setAttribute('data-message-id', id);
  el.textContent = text;
  return el;
}

function addStop() {
  const b = document.createElement('button');
  b.setAttribute('data-testid', 'stop-button');
  b.id = 'stop';
  document.body.appendChild(b);
  return b;
}

beforeEach(() => {
  sessionStorage.clear();
  document.body.innerHTML = '';
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('dom helpers', () => {
  it('finds composer, send button, messages and generating state', () => {
    const { thread } = setupPage();
    expect(findComposer()?.id).toBe('prompt-textarea');
    expect(findSendButton()).not.toBeNull();
    expect(isGenerating()).toBe(false);
    thread.append(userEl('u1', 'hi'), assistantEl('a1', '<p>yo</p>'));
    expect(userMessages()).toHaveLength(1);
    expect(assistantMessages()).toHaveLength(1);
    const stop = addStop();
    expect(isGenerating()).toBe(true);
    stop.remove();
    expect(isGenerating()).toBe(false);
  });

  it('extractMarkdown converts headings, bold and fenced code (drops the Copy code button)', () => {
    const el = assistantEl(
      'a1',
      `<h2>Gradient Descent</h2>
       <p>It uses a <strong>learning rate</strong> to step.</p>
       <ul><li>first</li><li>second</li></ul>
       <pre><div class="header"><span>python</span><button>Copy code</button></div><code class="language-python">def f():\n    return 1\n</code></pre>`,
    );
    const md = extractMarkdown(el);
    expect(md).toContain('## Gradient Descent');
    expect(md).toContain('**learning rate**');
    expect(md).toMatch(/-\s+first/);
    expect(md).toContain('```python\ndef f():\n    return 1\n```');
    expect(md).not.toContain('Copy code');
  });

  it('extractMarkdown falls back to plain text when there is no .markdown container', () => {
    const el = document.createElement('div');
    el.setAttribute('data-message-author-role', 'assistant');
    el.textContent = '  plain reply ';
    expect(extractMarkdown(el)).toBe('plain reply');
  });

  it('promptMatches compares normalised starts of the prompt', () => {
    const long = 'Explain   the\nconcept of backpropagation in neural networks, step by step please.';
    const u = userEl('u', 'Explain the concept of backpropagation in neural networks, step by step please.');
    expect(promptMatches(u, long)).toBe(true);
    expect(promptMatches(userEl('u2', 'Something else entirely'), long)).toBe(false);
    expect(promptMatches(undefined, long)).toBe(false);
    expect(promptMatches(u, '   ')).toBe(false);
  });
});

describe('ChatGPTContentController', () => {
  const PROMPT = 'Please explain the concept of attention in transformers clearly.';
  let sent: ContentToBackground[];
  let controller: ChatGPTContentController;

  beforeEach(() => {
    sent = [];
    controller = new ChatGPTContentController((m) => sent.push(m));
  });
  afterEach(() => {
    controller.cancel('r1');
  });

  it('submit inserts text, clicks send, and a duplicate requestId is reported as duplicate', async () => {
    const { composer, send } = setupPage();
    const clickSpy = vi.spyOn(send, 'click');
    const res = await controller.submit({ requestId: 'r1', prompt: PROMPT });
    expect(res).toEqual({ ok: true, duplicate: false });
    expect(composer.value).toBe(PROMPT);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(controller.ping().trackingRequestId).toBe('r1');
    const dup = await controller.submit({ requestId: 'r1', prompt: PROMPT });
    expect(dup).toEqual({ ok: true, duplicate: true });
    expect(clickSpy).toHaveBeenCalledTimes(1);
    // a different request while tracking is refused
    const other = await controller.submit({ requestId: 'r2', prompt: 'another' });
    expect(other.ok).toBe(false);
  });

  it('refuses when the composer already has text', async () => {
    const { composer, send } = setupPage();
    composer.value = 'my unsent draft';
    const clickSpy = vi.spyOn(send, 'click');
    const res = await controller.submit({ requestId: 'r1', prompt: PROMPT });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/unsent text/i);
    expect(composer.value).toBe('my unsent draft');
    expect(clickSpy).not.toHaveBeenCalled();
    expect(controller.ping().trackingRequestId).toBeNull();
  });

  it('refuses while ChatGPT is generating something else', async () => {
    setupPage();
    addStop();
    const res = await controller.submit({ requestId: 'r1', prompt: PROMPT });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/still answering/i);
  });

  it('refuses a request id that was already submitted before a page reload', async () => {
    setupPage();
    expect((await controller.submit({ requestId: 'r1', prompt: PROMPT })).ok).toBe(true);
    const reloaded = new ChatGPTContentController(() => undefined);
    const res = await reloaded.submit({ requestId: 'r1', prompt: PROMPT });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/already submitted/i);
  });

  it('streams progress then completes with promptVerified when a matching user message appeared', async () => {
    const { thread, composer, send } = setupPage();
    expect((await controller.submit({ requestId: 'r1', prompt: PROMPT })).ok).toBe(true);

    // Simulate ChatGPT: the user turn appears, composer clears, stop button shows, answer streams.
    composer.value = '';
    thread.append(userEl('u-new', PROMPT));
    const stop = addStop();
    const a = assistantEl('a-new', '<p>Attention lets</p>');
    thread.append(a);

    await vi.waitFor(() => expect(sent.some((m) => m.type === 'cs:progress')).toBe(true), { timeout: 3000 });
    const prog = sent.find((m) => m.type === 'cs:progress') as Extract<ContentToBackground, { type: 'cs:progress' }>;
    expect(prog.requestId).toBe('r1');
    expect(prog.content).toBe('Attention lets');
    expect(prog.providerMessageRef).toBe('a-new');
    expect(sent.some((m) => m.type === 'cs:complete')).toBe(false);

    // Finish: more text and the stop button disappears.
    a.querySelector('.markdown')!.innerHTML = '<p>Attention lets a model <strong>focus</strong>.</p>';
    stop.remove();
    await vi.waitFor(() => expect(sent.some((m) => m.type === 'cs:complete')).toBe(true), { timeout: 3000 });
    const done = sent.find((m) => m.type === 'cs:complete') as Extract<ContentToBackground, { type: 'cs:complete' }>;
    expect(done.requestId).toBe('r1');
    expect(done.content).toBe('Attention lets a model **focus**.');
    expect(done.promptVerified).toBe(true);
    expect(done.providerMessageRef).toBe('a-new');
    expect(controller.ping().trackingRequestId).toBeNull();
    expect(send).toBeTruthy();
  });

  it('reports promptVerified=false when no matching user message appears', async () => {
    const { thread } = setupPage();
    await controller.submit({ requestId: 'r1', prompt: PROMPT });
    const stop = addStop();
    thread.append(assistantEl('a-x', '<p>Some answer</p>'));
    stop.remove();
    await vi.waitFor(() => expect(sent.some((m) => m.type === 'cs:complete')).toBe(true), { timeout: 3000 });
    const done = sent.find((m) => m.type === 'cs:complete') as Extract<ContentToBackground, { type: 'cs:complete' }>;
    expect(done.promptVerified).toBe(false);
  });

  it('ignores assistant messages that existed before submission', async () => {
    const { thread } = setupPage();
    thread.append(userEl('u-old', 'old question'), assistantEl('a-old', '<p>OLD ANSWER</p>'));
    await controller.submit({ requestId: 'r1', prompt: PROMPT });
    await new Promise((r) => setTimeout(r, 600));
    expect(sent).toEqual([]);
  });

  it('reports cs:failed when generation stops without any new reply', async () => {
    setupPage();
    await controller.submit({ requestId: 'r1', prompt: PROMPT });
    const stop = addStop();
    await new Promise((r) => setTimeout(r, 500));
    stop.remove();
    await vi.waitFor(() => expect(sent.some((m) => m.type === 'cs:failed')).toBe(true), { timeout: 3000 });
    const f = sent.find((m) => m.type === 'cs:failed') as Extract<ContentToBackground, { type: 'cs:failed' }>;
    expect(f.requestId).toBe('r1');
    expect(f.interrupted).toBe(false);
  });

  it('cancel clicks stop for the tracked request only', async () => {
    setupPage();
    await controller.submit({ requestId: 'r1', prompt: PROMPT });
    const stop = addStop();
    const stopClick = vi.spyOn(stop, 'click');
    expect(controller.cancel('other')).toEqual({ ok: false });
    expect(stopClick).not.toHaveBeenCalled();
    expect(controller.cancel('r1')).toEqual({ ok: true });
    expect(stopClick).toHaveBeenCalledTimes(1);
    expect(controller.ping().trackingRequestId).toBeNull();
  });

  it('captureLatest returns the last reply, and refuses while generating', () => {
    const { thread } = setupPage();
    expect(controller.captureLatest().ok).toBe(false);
    thread.append(assistantEl('a1', '<p>first</p>'), assistantEl('a2', '<h3>Last</h3><p>reply</p>'));
    const r = controller.captureLatest();
    expect(r.ok).toBe(true);
    expect(r.text).toContain('### Last');
    addStop();
    expect(controller.captureLatest().ok).toBe(false);
  });
});
