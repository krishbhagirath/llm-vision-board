// @vitest-environment-options {"url":"https://chatgpt.com/c/current"}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatGPTContentController } from '@/providers/chatgpt/contentController';
import type { ContentToBackground } from '@/lib/messages';

/**
 * Regression tests for no-reload conversation switching and prompt anchoring.
 * Uses the 2026-11 ChatGPT markup (role encoded in data-chatgpt-search-unit-key).
 */

const PROMPT = 'Why does backpropagation use the chain rule?';

function userTurn(id: string, text: string): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-chatgpt-search-unit-key', `turn-${id}:1:user`);
  el.setAttribute('data-chatgpt-selection-message-id', id);
  el.textContent = text;
  return el;
}

function assistantTurn(id: string, text: string, state = 'complete'): HTMLElement {
  const wrap = document.createElement('div');
  wrap.setAttribute('data-talvt-turn-state', state);
  wrap.innerHTML = `<div data-chatgpt-search-unit-key="turn-${id}:2:assistant"><div data-chatgpt-selection-message-id="${id}"><div data-markdown-text-style="assistant-message"><p>${text}</p></div></div></div>`;
  return wrap;
}

function page(turns: HTMLElement[] = []) {
  document.body.innerHTML = `
    <nav>
      <a data-testid="create-new-chat-button" href="/">New chat</a>
      <a href="/c/target">Target conversation</a>
    </nav>
    <main id="thread"></main>
    <form><textarea id="prompt-textarea"></textarea><button data-testid="send-button" type="button">Send</button></form>`;
  const thread = document.getElementById('thread')!;
  thread.append(...turns);
  return { thread, composer: document.getElementById('prompt-textarea') as HTMLTextAreaElement };
}

/** Make a link behave like ChatGPT's client-side router: change URL and swap the thread. */
function routeOnClick(selector: string, path: string, render: (thread: HTMLElement) => void, delayMs = 20) {
  document.querySelector<HTMLElement>(selector)!.addEventListener('click', (e) => {
    e.preventDefault();
    history.pushState(null, '', path);
    setTimeout(() => render(document.getElementById('thread')!), delayMs);
  });
}

function addStop() {
  const b = document.createElement('button');
  b.setAttribute('data-testid', 'stop-button');
  document.body.appendChild(b);
  return b;
}

let sent: ContentToBackground[];
let controller: ChatGPTContentController;

beforeEach(() => {
  const local: ContentToBackground[] = [];
  history.replaceState(null, '', '/c/current');
  sessionStorage.clear();
  sent = local;
  controller = new ChatGPTContentController((m) => local.push(m));
});
afterEach(() => {
  controller.cancel('r1'); // stop any tracker still observing the shared document
  document.body.innerHTML = '';
});

describe('no-reload navigation (cs:navigate)', () => {
  it('reports "already" when the tab is on the target conversation', async () => {
    page([userTurn('u1', 'q'), assistantTurn('a1', 'ans')]);
    expect(await controller.navigate('https://chatgpt.com/c/current', 200)).toEqual({ ok: true, mode: 'already' });
  });

  it('switches to a new chat via the New chat control once the old turns are gone', async () => {
    page([userTurn('u1', 'q'), assistantTurn('a1', 'ans')]);
    routeOnClick('[data-testid="create-new-chat-button"]', '/', (t) => t.replaceChildren());
    expect(await controller.navigate(null, 1000)).toEqual({ ok: true, mode: 'soft' });
    expect(location.pathname).toBe('/');
  });

  it('switches to an existing conversation via its sidebar link once its turns render', async () => {
    page([userTurn('u1', 'q'), assistantTurn('a1', 'ans')]);
    routeOnClick('a[href="/c/target"]', '/c/target', (t) => t.replaceChildren(userTurn('u9', 'target q'), assistantTurn('a9', 'target answer')));
    expect(await controller.navigate('https://chatgpt.com/c/target', 1000)).toEqual({ ok: true, mode: 'soft' });
  });

  it('does NOT report success while the previous conversation is still on screen (stale DOM)', async () => {
    page([userTurn('u1', 'q'), assistantTurn('a1', 'ans')]);
    // URL changes but the old turns never get replaced.
    routeOnClick('a[href="/c/target"]', '/c/target', () => undefined);
    const res = await controller.navigate('https://chatgpt.com/c/target', 300);
    expect(res.ok).toBe(false);
  });

  it('refuses when the conversation link is not on the page (background then reloads)', async () => {
    page([userTurn('u1', 'q'), assistantTurn('a1', 'ans')]);
    const res = await controller.navigate('https://chatgpt.com/c/not-in-sidebar', 200);
    expect(res).toEqual({ ok: false, reason: 'conversation link not in sidebar' });
  });

  it('refuses while ChatGPT is generating', async () => {
    page([userTurn('u1', 'q'), assistantTurn('a1', 'ans')]);
    addStop();
    expect((await controller.navigate(null, 200)).ok).toBe(false);
  });

  it('refuses when replies are visible but user turns cannot be recognised (anchoring impossible)', async () => {
    page([assistantTurn('a1', 'ans')]);
    const res = await controller.navigate(null, 200);
    expect(res).toEqual({ ok: false, reason: 'user turns not detectable' });
  });
});

describe('prompt anchoring (reply must follow OUR user turn)', () => {
  it('waits for history before snapshotting, so late-rendered old turns are not captured', async () => {
    const { thread, composer } = page();
    setTimeout(() => thread.append(userTurn('u-old', 'old q'), assistantTurn('a-old', 'OLD ANSWER')), 50);
    const res = await controller.submit({ requestId: 'r1', prompt: PROMPT, expectHistory: true }, 1000);
    expect(res.ok).toBe(true);

    composer.value = '';
    const stop = addStop();
    await new Promise((r) => setTimeout(r, 500));
    expect(sent.filter((m) => m.type === 'cs:progress' || m.type === 'cs:complete')).toEqual([]);

    thread.append(userTurn('u-new', PROMPT), assistantTurn('a-new', 'New answer', 'streaming'));
    await vi.waitFor(() => expect(sent.some((m) => m.type === 'cs:progress')).toBe(true), { timeout: 3000 });
    stop.remove();
    thread.lastElementChild!.setAttribute('data-talvt-turn-state', 'complete');
    await vi.waitFor(() => expect(sent.some((m) => m.type === 'cs:complete')).toBe(true), { timeout: 3000 });
    const done = sent.find((m) => m.type === 'cs:complete') as Extract<ContentToBackground, { type: 'cs:complete' }>;
    expect(done.content).toBe('New answer');
    expect(done.providerMessageRef).toBe('a-new');
    expect(done.promptVerified).toBe(true);
  });

  it('fails clearly when an existing conversation never renders its history', async () => {
    page();
    const res = await controller.submit({ requestId: 'r1', prompt: PROMPT, expectHistory: true }, 150);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/did not finish loading/i);
  });

  it('ignores older turns that render ABOVE the baseline after submission (virtualized history)', async () => {
    const { thread, composer } = page([userTurn('u1', 'q1'), assistantTurn('a1', 'A1')]);
    await controller.submit({ requestId: 'r1', prompt: PROMPT, expectHistory: true }, 500);
    composer.value = '';
    // An even older pair is inserted at the top (scroll-back rendering), with a stop button visible.
    thread.prepend(userTurn('u0', 'q0'), assistantTurn('a0', 'ANCIENT'));
    addStop();
    await new Promise((r) => setTimeout(r, 500));
    expect(sent).toEqual([]);
  });

  it('does not complete with a new assistant turn when our user turn has not appeared yet', async () => {
    const { thread, composer } = page([userTurn('u1', 'q1'), assistantTurn('a1', 'A1')]);
    await controller.submit({ requestId: 'r1', prompt: PROMPT, expectHistory: true }, 500);
    composer.value = '';
    thread.append(assistantTurn('a-x', 'unanchored reply'));
    await new Promise((r) => setTimeout(r, 500));
    expect(sent).toEqual([]);
  });

  it('refuses requireAnchor submissions on pages where user turns are not detectable', async () => {
    page([assistantTurn('a1', 'A1')]);
    const res = await controller.submit({ requestId: 'r1', prompt: PROMPT, expectHistory: true, requireAnchor: true }, 300);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/safely identify/i);
  });

  it('completes on turn-state change even when no other mutation happens', async () => {
    const { thread, composer } = page([userTurn('u1', 'q1'), assistantTurn('a1', 'A1')]);
    await controller.submit({ requestId: 'r1', prompt: PROMPT, expectHistory: true }, 500);
    composer.value = '';
    const a = assistantTurn('a2', 'Done text', 'streaming');
    thread.append(userTurn('u2', PROMPT), a);
    await vi.waitFor(() => expect(sent.some((m) => m.type === 'cs:progress')).toBe(true), { timeout: 3000 });
    a.setAttribute('data-talvt-turn-state', 'complete'); // attribute-only mutation
    await vi.waitFor(() => expect(sent.some((m) => m.type === 'cs:complete')).toBe(true), { timeout: 3000 });
  });

  it('fails instead of waiting forever when the turn state reports an error', async () => {
    const { thread, composer } = page([userTurn('u1', 'q1'), assistantTurn('a1', 'A1')]);
    await controller.submit({ requestId: 'r1', prompt: PROMPT, expectHistory: true }, 500);
    composer.value = '';
    thread.append(userTurn('u2', PROMPT), assistantTurn('a2', '', 'error'));
    await vi.waitFor(() => expect(sent.some((m) => m.type === 'cs:failed')).toBe(true), { timeout: 3000 });
  });
});
