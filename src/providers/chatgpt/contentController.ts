import type {
  BackgroundToContent,
  CaptureResult,
  ContentToBackground,
  NavigateResult,
  PingResult,
  SubmitPayload,
  SubmitResult,
} from '@/lib/messages';
import { normalizeProviderUrl, CHATGPT_NEW_CHAT_URL } from '@/lib/messages';
import { normalizeWs } from '@/lib/id';
import {
  assistantMessages,
  composerText,
  describePage,
  extractMarkdown,
  findComposer,
  findSendButton,
  findStopButton,
  isGenerating,
  loggedOutHint,
  messageKey,
  promptMatches,
  providerMessageId,
  setComposerText,
  turnState,
  userMessages,
  waitFor,
} from './dom';
import { SEL, queryFirst } from './selectors';

const DEDUPE_KEY = 'llm-vision-board:submitted';
const PROGRESS_THROTTLE_MS = 400;
/** How long a no-reload switch may take before the background falls back to a full reload. */
export const SOFT_NAV_TIMEOUT_MS = 12_000;
/** How long to wait for an existing conversation's history to render before submitting. */
const HISTORY_TIMEOUT_MS = 15_000;

type Send = (msg: ContentToBackground) => void;

/** True when `a` comes after `b` in document order. */
function isAfter(a: Node, b: Node): boolean {
  return !!(b.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING);
}

/** Snapshot of the conversation DOM taken immediately before submitting. */
export interface Baseline {
  els: WeakSet<Element>;
  keys: Set<string>;
  /** Last message element (any role) in document order, if any. */
  last: Element | null;
  /** Whether user turns are detectable on this page at all (enables prompt anchoring). */
  userTurnsDetectable: boolean;
}

export function takeBaseline(): Baseline {
  const users = userMessages();
  const assistants = assistantMessages();
  const all = [...users, ...assistants];
  const els = new WeakSet<Element>(all);
  const keys = new Set<string>();
  users.forEach((el, i) => keys.add(`u:${messageKey(el, i)}`));
  assistants.forEach((el, i) => keys.add(`a:${messageKey(el, i)}`));
  let last: Element | null = null;
  for (const el of all) if (!last || isAfter(el, last)) last = el;
  return { els, keys, last, userTurnsDetectable: users.length > 0 };
}

function isNew(el: Element, prefix: 'u' | 'a', b: Baseline): boolean {
  if (b.els.has(el)) return false;
  const id = providerMessageId(el);
  if (id && b.keys.has(`${prefix}:${id}`)) return false;
  // Old turns that render late (virtualized history) appear ABOVE the baseline; ours appear below it.
  if (b.last && b.last.isConnected && !isAfter(el, b.last)) return false;
  return true;
}

/** The user turn created by this submission: newest new user turn (prefer one matching the prompt text). */
export function findAnchor(b: Baseline, prompt: string): Element | null {
  const fresh = userMessages().filter((el) => isNew(el, 'u', b));
  if (!fresh.length) return null;
  return [...fresh].reverse().find((el) => promptMatches(el, prompt)) ?? fresh.at(-1)!;
}

/**
 * Runs inside the ChatGPT tab. Submits ONE prompt at a time on explicit request
 * from the background, then observes the page with a MutationObserver:
 *   waiting   → our user turn / a new assistant turn has not appeared yet
 *   streaming → the assistant turn after OUR user turn exists and is still generating
 *   complete  → generation finished (Stop button gone and turn state not in progress)
 * Completion is driven by page state changes, never by a fixed delay.
 */
export class ChatGPTContentController {
  private tracking: Tracker | null = null;

  constructor(private readonly send: Send) {}

  handle(msg: BackgroundToContent): Promise<unknown> | unknown {
    switch (msg.type) {
      case 'cs:ping':
        return this.ping();
      case 'cs:submit':
        return this.submit(msg.payload);
      case 'cs:navigate':
        return this.navigate(msg.targetUrl);
      case 'cs:cancel':
        return this.cancel(msg.requestId);
      case 'cs:getSelection':
        return this.selection();
      case 'cs:captureLatest':
        return this.captureLatest();
    }
  }

  ping(): PingResult {
    return {
      ok: true,
      url: location.href,
      composerFound: !!findComposer(),
      loggedOutHint: loggedOutHint(),
      generating: isGenerating(),
      trackingRequestId: this.tracking?.requestId ?? null,
    };
  }

  /**
   * No-reload switch to another ChatGPT conversation by clicking ChatGPT's own link
   * (sidebar conversation link or "New chat"), exactly like the user would.
   * Resolves ok only once the target conversation is verifiably on screen:
   *  - URL matches the target,
   *  - for a new chat: no messages are rendered,
   *  - for an existing chat: its turns are rendered and NONE of the previous
   *    conversation's turns remain (no stale DOM).
   * Any doubt → { ok:false } and the background does a full reload instead.
   */
  async navigate(targetUrl: string | null, timeoutMs = SOFT_NAV_TIMEOUT_MS): Promise<NavigateResult> {
    const desired = normalizeProviderUrl(targetUrl ?? CHATGPT_NEW_CHAT_URL);
    if (!desired) return { ok: false, reason: 'invalid target URL' };
    if (this.tracking) return { ok: false, reason: 'a request is still being tracked in this tab' };
    if (isGenerating()) return { ok: false, reason: 'ChatGPT is generating' };
    if (normalizeProviderUrl(location.href) === desired) return { ok: true, mode: 'already' };
    // Anchoring must work for a safe soft switch: if the page shows replies but we can't see user turns, refuse.
    if (assistantMessages().length > 0 && userMessages().length === 0) return { ok: false, reason: 'user turns not detectable' };

    const link = targetUrl ? findConversationLink(desired) : queryFirst<HTMLElement>(document, SEL.newChat);
    if (!link) return { ok: false, reason: targetUrl ? 'conversation link not in sidebar' : 'New chat control not found' };

    const before = takeBaseline();
    link.click();
    const settled = await waitFor(() => {
      if (normalizeProviderUrl(location.href) !== desired) return false;
      if (!findComposer() || isGenerating()) return false;
      const users = userMessages();
      const assistants = assistantMessages();
      const stale = [...users, ...assistants].some((el) => before.els.has(el) || (providerMessageId(el) !== null && (before.keys.has(`u:${providerMessageId(el)}`) || before.keys.has(`a:${providerMessageId(el)}`))));
      if (stale) return false;
      if (!targetUrl) return users.length === 0 && assistants.length === 0;
      return assistants.length > 0 && users.length > 0;
    }, timeoutMs);
    return settled ? { ok: true, mode: 'soft' } : { ok: false, reason: 'target conversation did not render in time' };
  }

  private submittedIds(): string[] {
    try {
      return JSON.parse(sessionStorage.getItem(DEDUPE_KEY) ?? '[]') as string[];
    } catch {
      return [];
    }
  }

  private markSubmitted(id: string): void {
    const ids = [...this.submittedIds(), id].slice(-50);
    sessionStorage.setItem(DEDUPE_KEY, JSON.stringify(ids));
  }

  async submit(p: SubmitPayload, historyTimeoutMs = HISTORY_TIMEOUT_MS): Promise<SubmitResult> {
    if (this.tracking?.requestId === p.requestId) return { ok: true, duplicate: true };
    if (this.submittedIds().includes(p.requestId)) {
      return { ok: false, error: 'This request was already submitted on this page, but the page has since reloaded. Retry to send it again.', retryable: true };
    }
    if (this.tracking) return { ok: false, error: 'Another Vision Board request is still in progress in this tab.', retryable: true };

    const composer = await waitFor(() => findComposer(), 20_000);
    if (!composer) {
      return {
        ok: false,
        error: loggedOutHint() ? 'You appear to be logged out of ChatGPT. Log in on chatgpt.com, then retry.' : 'Could not find the ChatGPT message box on the page.',
        retryable: true,
      };
    }
    if (p.expectHistory) {
      // Existing conversation: its earlier turns must be on screen before we snapshot the baseline.
      const loaded = await waitFor(() => assistantMessages().length > 0, historyTimeoutMs);
      if (!loaded) {
        return { ok: false, error: `This branch's ChatGPT conversation did not finish loading (or its replies can't be recognised). Retry, or open it and use "Capture latest reply". [diagnostics: ${describePage()}]`, retryable: true };
      }
    }
    if (isGenerating()) return { ok: false, error: 'ChatGPT is still answering something else in this tab. Wait for it to finish, then retry.', retryable: true };
    if (normalizeWs(composerText(composer))) {
      return { ok: false, error: 'The ChatGPT message box already contains unsent text. Clear it (or send it) first, then retry.', retryable: true };
    }

    const baseline = takeBaseline();
    if (p.requireAnchor && p.expectHistory && !baseline.userTurnsDetectable) {
      return { ok: false, error: 'Cannot safely identify your messages on this ChatGPT page. Retry (the tab will be fully reloaded).', retryable: true };
    }

    setComposerText(composer, p.prompt);
    if (!normalizeWs(composerText(composer))) return { ok: false, error: 'Could not insert the prompt into the ChatGPT message box.', retryable: true };

    const sendBtn = await waitFor(() => {
      const b = findSendButton();
      return b && !b.disabled && b.getAttribute('aria-disabled') !== 'true' ? b : null;
    }, 10_000);
    if (!sendBtn) return { ok: false, error: 'The ChatGPT send button did not become available. The prompt is in the message box — you can press Send yourself, then use "Capture latest reply".', retryable: true };

    this.markSubmitted(p.requestId);
    this.tracking = new Tracker(p.requestId, p.prompt, baseline, !!p.requireAnchor, this.send, () => {
      this.tracking = null;
    });
    sendBtn.click();
    this.tracking.start();
    return { ok: true, duplicate: false };
  }

  cancel(requestId: string): { ok: boolean } {
    if (this.tracking?.requestId !== requestId) return { ok: false };
    findStopButton()?.click();
    this.tracking.stop();
    this.tracking = null;
    return { ok: true };
  }

  selection(): CaptureResult {
    const text = window.getSelection()?.toString().trim() ?? '';
    return { ok: !!text, text, url: location.href, error: text ? undefined : 'Select some text on the ChatGPT page first.' };
  }

  captureLatest(): CaptureResult {
    const last = assistantMessages().at(-1);
    const state = last ? turnState(last) : null;
    if (isGenerating() || (state !== null && state !== 'complete' && !/error|fail/i.test(state))) {
      return { ok: false, text: '', url: location.href, error: 'ChatGPT is still generating — wait until it finishes.' };
    }
    if (!last) return { ok: false, text: '', url: location.href, error: `No ChatGPT reply found on this page. [diagnostics: ${describePage()}]` };
    const text = extractMarkdown(last);
    return { ok: !!text, text, url: location.href, error: text ? undefined : 'The latest reply is empty.' };
  }
}

/** Sidebar/history link to a specific conversation (works for project-scoped /g/…/c/<id> too). */
function findConversationLink(desired: string): HTMLElement | null {
  const id = /\/c\/([\w-]+)$/.exec(desired)?.[1];
  if (!id) return null;
  for (const a of document.querySelectorAll<HTMLAnchorElement>('a[href*="/c/"]')) {
    const n = normalizeProviderUrl(a.href);
    if (n && n.endsWith(`/c/${id}`)) return a;
  }
  return null;
}

class Tracker {
  private observer: MutationObserver | null = null;
  private sawGenerating = false;
  private lastSent = '';
  private lastSentAt = 0;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private done = false;

  constructor(
    readonly requestId: string,
    private readonly prompt: string,
    private readonly baseline: Baseline,
    private readonly requireAnchor: boolean,
    private readonly send: Send,
    private readonly onDone: () => void,
  ) {}

  start(): void {
    this.observer = new MutationObserver(() => this.schedule());
    this.observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [...SEL.observedAttributes] });
    this.schedule();
  }

  stop(): void {
    this.done = true;
    this.observer?.disconnect();
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
  }

  /** Throttle evaluation; this is rate-limiting only, not a completion heuristic. */
  private schedule(): void {
    if (this.done || this.pendingTimer) return;
    const wait = Math.max(0, PROGRESS_THROTTLE_MS - (Date.now() - this.lastSentAt));
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      this.evaluate();
    }, wait);
  }

  /** Must the reply be anchored to our user turn? Yes whenever user turns are detectable or required. */
  private anchoringActive(): boolean {
    return this.requireAnchor || this.baseline.userTurnsDetectable || userMessages().length > 0;
  }

  /** The assistant reply to OUR prompt, or null if it hasn't appeared (or can't be told apart safely). */
  private reply(): { el: HTMLElement | null; anchored: boolean } {
    const fresh = assistantMessages().filter((el) => isNew(el, 'a', this.baseline));
    if (this.anchoringActive()) {
      const anchor = findAnchor(this.baseline, this.prompt);
      if (!anchor) return { el: null, anchored: false };
      const after = fresh.filter((el) => isAfter(el, anchor));
      return { el: after.at(-1) ?? null, anchored: true };
    }
    return { el: fresh.at(-1) ?? null, anchored: false };
  }

  private evaluate(): void {
    if (this.done) return;
    const { el, anchored } = this.reply();
    const state = el ? turnState(el) : null;
    if (state && /error|fail/i.test(state)) {
      this.finish({ type: 'cs:failed', requestId: this.requestId, error: `ChatGPT reported an error for this answer (turn state "${state}"). Check the ChatGPT tab, then Retry.`, interrupted: false });
      return;
    }
    // Newer markup exposes a per-turn state; anything but "complete" means still generating.
    const generating = isGenerating() || (state !== null && state !== 'complete');
    if (generating) this.sawGenerating = true;
    const content = el ? extractMarkdown(el) : '';
    const ref = el ? providerMessageId(el) : null;

    if (el && generating) {
      if (content && content !== this.lastSent) {
        this.lastSent = content;
        this.lastSentAt = Date.now();
        this.send({ type: 'cs:progress', requestId: this.requestId, content, providerMessageRef: ref });
      }
      return;
    }
    if (el && !generating && (this.sawGenerating || content)) {
      if (this.requireAnchor && !anchored) {
        this.finish({ type: 'cs:failed', requestId: this.requestId, error: 'Could not confirm which ChatGPT reply belongs to this prompt. Use "Capture latest reply" after checking the ChatGPT tab.', interrupted: false });
        return;
      }
      this.finish({
        type: 'cs:complete',
        requestId: this.requestId,
        content,
        url: location.href,
        providerMessageRef: ref,
        promptVerified: this.verifyPrompt(),
      });
      return;
    }
    if (!el && this.sawGenerating && !generating) {
      this.finish({ type: 'cs:failed', requestId: this.requestId, error: `ChatGPT stopped but no reply to this prompt could be found on the page. Try "Capture latest reply". [diagnostics: ${describePage()}]`, interrupted: false });
    }
    // otherwise: still waiting for the first sign of a response
  }

  private verifyPrompt(): boolean {
    const anchor = findAnchor(this.baseline, this.prompt);
    return !!anchor && promptMatches(anchor, this.prompt);
  }

  private finish(msg: ContentToBackground): void {
    this.stop();
    this.onDone();
    this.send(msg);
  }
}
