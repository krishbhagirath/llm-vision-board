import { db, getSettings } from '@/storage/db';
import { now as realNow } from '@/lib/id';
import type { ContentToBackground } from '@/lib/messages';
import { normalizeProviderUrl } from '@/lib/messages';
import { TERMINAL_REQUEST_STATUSES, type ID, type MessageStatus, type ProviderRequest, type RequestStatus } from '@/types';
import type { ProviderTransport } from './types';
import { refreshNodePreview } from '@/features/conversations/answerPreview';

type Progress = Extract<ContentToBackground, { type: 'cs:progress' }>;
type Complete = Extract<ContentToBackground, { type: 'cs:complete' }>;
type Failed = Extract<ContentToBackground, { type: 'cs:failed' }>;

const ACTIVE: RequestStatus[] = ['dispatching', 'submitted', 'streaming'];
const isActive = (s: RequestStatus) => ACTIVE.includes(s);

/** Max time allowed for navigation + composer discovery before submission. */
export const DISPATCH_TIMEOUT_MS = 60_000;

export interface OrchestratorOptions {
  transport: ProviderTransport;
  now?: () => number;
  /** Override settings lookup (tests). */
  timeoutMs?: () => Promise<number>;
}

/**
 * Request orchestrator — runs in the background service worker.
 *
 * Invariants:
 *  - At most ONE active request (dispatching/submitted/streaming) at a time: ChatGPT is
 *    driven through one visible tab, so parallel requests could interleave.
 *  - All state is persisted in IndexedDB; the worker may be killed at any time and
 *    `resume()` reconstructs what to do.
 *  - Writes from the content script are accepted only if requestId matches the
 *    persisted ACTIVE request AND the sender tab matches AND the target
 *    message/conversation still belong to the request's node. Anything else is dropped,
 *    so a response can never land under the wrong node.
 */
export class RequestOrchestrator {
  private readonly transport: ProviderTransport;
  private readonly now: () => number;
  private readonly timeoutMs: () => Promise<number>;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(opts: OrchestratorOptions) {
    this.transport = opts.transport;
    this.now = opts.now ?? realNow;
    this.timeoutMs = opts.timeoutMs ?? (async () => (await getSettings()).requestTimeoutSec * 1000);
  }

  /** Serialize all state transitions inside this worker. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  async activeRequest(): Promise<ProviderRequest | undefined> {
    return db.requests.where('status').anyOf(ACTIVE).first();
  }

  async queuedCount(): Promise<number> {
    return db.requests.where('status').equals('queued').count();
  }

  /** Start the next queued request if nothing is active. */
  kick(): Promise<void> {
    return this.serial(() => this.processNext());
  }

  private async processNext(): Promise<void> {
    if (await this.activeRequest()) return;
    const next = (await db.requests.where('status').equals('queued').sortBy('createdAt'))[0];
    if (!next) return;
    const settings = await getSettings();
    if (!settings.chatgptAutomation) {
      await this.finish(next.id, 'failed', 'ChatGPT automation is disabled in Settings. Use the manual copy/paste flow or enable it.');
      return this.processNext();
    }
    const tabId = await this.transport.findTab();
    if (tabId === null) {
      await this.finish(next.id, 'failed', 'ChatGPT is not connected. Open ChatGPT to continue.');
      return this.processNext();
    }
    await this.setStatus(next.id, 'dispatching', { tabId });
    // Dispatch outside the serial chain so content-script events can be handled meanwhile.
    void this.dispatch(next.id, tabId);
  }

  private async dispatch(requestId: ID, tabId: number): Promise<void> {
    try {
      const req = await db.requests.get(requestId);
      if (!req || req.status !== 'dispatching') return;
      const { softNavigation } = await getSettings();
      await db.requests.update(requestId, { detail: req.targetUrl ? 'Opening this branch’s ChatGPT conversation…' : 'Starting a new ChatGPT conversation…' });
      const mode = await this.transport.prepareTab(tabId, req.targetUrl, { allowSoft: softNavigation });
      const fresh = await db.requests.get(requestId);
      if (!fresh || fresh.status !== 'dispatching') return; // cancelled meanwhile
      await db.requests.update(requestId, { detail: 'Sending your prompt…' });
      const result = await this.transport.submit(tabId, {
        requestId,
        prompt: fresh.prompt,
        expectHistory: !!fresh.targetUrl,
        // After an in-page switch, stale DOM is possible: only accept a reply anchored to our own prompt.
        requireAnchor: mode === 'soft',
      });
      if (!result.ok) {
        await this.serial(() => this.finish(requestId, 'failed', result.error));
      } else {
        await this.serial(async () => {
          const r = await db.requests.get(requestId);
          if (r?.status === 'dispatching') await this.setStatus(requestId, 'submitted', { detail: 'Waiting for ChatGPT to answer…' });
        });
        return;
      }
    } catch (err) {
      await this.serial(() => this.finish(requestId, 'failed', `Could not reach the ChatGPT tab: ${errMsg(err)}`));
    }
    await this.kick();
  }

  // ---------------- content-script events ----------------

  handleContentMessage(tabId: number, msg: ContentToBackground): Promise<void> {
    switch (msg.type) {
      case 'cs:progress':
        return this.serial(() => this.onProgress(tabId, msg));
      case 'cs:complete':
        return this.serial(() => this.onComplete(tabId, msg)).then(() => this.kick());
      case 'cs:failed':
        return this.serial(() => this.onFailed(tabId, msg)).then(() => this.kick());
      case 'cs:ready':
        return this.serial(() => this.onTabReady(tabId)).then(() => this.kick());
    }
  }

  /** Load the request and verify the event is allowed to write to it. */
  private async accept(tabId: number, requestId: ID): Promise<ProviderRequest | null> {
    const req = await db.requests.get(requestId);
    if (!req || !isActive(req.status) || req.tabId !== tabId) return null;
    const [msg, conv, node] = await Promise.all([
      db.messages.get(req.assistantMessageId),
      db.conversations.get(req.conversationId),
      db.nodes.get(req.nodeId),
    ]);
    if (!msg || !conv || !node) {
      await this.finish(req.id, 'cancelled', 'Target node or conversation no longer exists');
      return null;
    }
    if (msg.conversationId !== conv.id || conv.nodeId !== node.id) {
      await this.finish(req.id, 'failed', 'Integrity check failed: response target does not match the request node');
      return null;
    }
    return req;
  }

  private async onProgress(tabId: number, msg: Progress): Promise<void> {
    const req = await this.accept(tabId, msg.requestId);
    if (!req) return;
    const t = this.now();
    await db.transaction('rw', db.requests, db.messages, async () => {
      await db.requests.update(req.id, { status: 'streaming', detail: 'ChatGPT is writing…', updatedAt: t, lastActivityAt: t });
      await db.messages.update(req.assistantMessageId, {
        content: msg.content,
        status: 'streaming',
        providerMessageRef: msg.providerMessageRef,
        updatedAt: t,
      });
    });
  }

  private async onComplete(tabId: number, msg: Complete): Promise<void> {
    const req = await this.accept(tabId, msg.requestId);
    if (!req) return;
    if (!msg.content.trim()) {
      await this.finish(req.id, 'failed', 'ChatGPT finished but no response text could be read from the page. Use "Capture latest reply" or paste it manually.');
      return;
    }
    const t = this.now();
    const warnings: string[] = [];
    if (!msg.promptVerified) warnings.push('Could not confirm the submitted prompt on the ChatGPT page — verify this answer matches your question.');
    const conv = (await db.conversations.get(req.conversationId))!;
    const newUrl = normalizeProviderUrl(msg.url);
    if (conv.providerUrl && newUrl && normalizeProviderUrl(conv.providerUrl) !== newUrl) {
      warnings.push(`ChatGPT conversation URL changed from ${conv.providerUrl} to ${newUrl}.`);
    }
    await db.transaction('rw', db.requests, db.messages, db.conversations, async () => {
      await db.messages.update(req.assistantMessageId, {
        content: msg.content,
        status: 'complete',
        providerMessageRef: msg.providerMessageRef,
        error: warnings.length ? warnings.join(' ') : null,
        updatedAt: t,
      });
      await db.conversations.update(conv.id, {
        providerUrl: newUrl && /\/c\//.test(newUrl) ? newUrl : conv.providerUrl,
        updatedAt: t,
        context: { ...conv.context, warnings: [...conv.context.warnings, ...warnings] },
      });
      await db.requests.update(req.id, { status: 'complete', error: null, updatedAt: t, lastActivityAt: t });
    });
    await refreshNodePreview(conv.id);
  }

  private async onFailed(tabId: number, msg: Failed): Promise<void> {
    const req = await this.accept(tabId, msg.requestId);
    if (!req) return;
    await this.finish(req.id, msg.interrupted ? 'interrupted' : 'failed', msg.error);
  }

  /**
   * The content script (re)loaded in a tab. If a request was already submitted to
   * that tab, the page reload/navigation destroyed our observer: mark interrupted.
   * (During 'dispatching' a load is expected — we navigated it ourselves.)
   */
  private async onTabReady(tabId: number): Promise<void> {
    const req = await this.activeRequest();
    if (!req || req.tabId !== tabId) return;
    if (req.status === 'submitted' || req.status === 'streaming') {
      await this.finish(req.id, 'interrupted', 'The ChatGPT tab reloaded or navigated while the answer was being generated. Retry, or use "Capture latest reply".');
    }
  }

  onTabRemoved(tabId: number): Promise<void> {
    return this.serial(async () => {
      const req = await this.activeRequest();
      if (req && req.tabId === tabId) {
        await this.finish(req.id, 'interrupted', 'The ChatGPT tab was closed before the answer finished.');
      }
    }).then(() => this.kick());
  }

  // ---------------- user actions ----------------

  cancel(requestId: ID): Promise<void> {
    return this.serial(async () => {
      const req = await db.requests.get(requestId);
      if (!req) return;
      if (req.status === 'queued') {
        await this.finish(req.id, 'cancelled', 'Cancelled');
        return;
      }
      if (!isActive(req.status)) return;
      if (req.tabId !== null && req.status !== 'dispatching') {
        await this.transport.cancel(req.tabId, req.id).catch(() => undefined);
      }
      await this.finish(req.id, 'cancelled', 'Cancelled by you. (ChatGPT may still show a partial answer in its tab.)');
    }).then(() => this.kick());
  }

  // ---------------- recovery ----------------

  /** Called when the service worker starts: reconcile persisted state with reality. */
  resume(): Promise<void> {
    return this.serial(async () => {
      const req = await this.activeRequest();
      if (!req) return;
      if (req.tabId === null) {
        await this.finish(req.id, 'interrupted', 'Extension restarted before the request was sent.');
        return;
      }
      if (req.status === 'dispatching') {
        // Re-dispatch; the content script deduplicates by requestId so nothing is sent twice.
        void this.dispatch(req.id, req.tabId);
        return;
      }
      const ping = await this.transport.ping(req.tabId);
      if (!ping || ping.trackingRequestId !== req.id) {
        await this.finish(req.id, 'interrupted', 'Lost track of the answer (extension or tab restarted). Retry, or use "Capture latest reply".');
      }
    }).then(() => this.kick());
  }

  /** Periodic check (chrome.alarms) — detects stalled requests without fixed "done" delays. */
  watchdog(): Promise<void> {
    return this.serial(async () => {
      const req = await this.activeRequest();
      if (!req) return;
      const t = this.now();
      const limit = req.status === 'dispatching' ? DISPATCH_TIMEOUT_MS : await this.timeoutMs();
      if (t - req.lastActivityAt < limit) return;
      if (req.tabId !== null && req.status !== 'dispatching') {
        const ping = await this.transport.ping(req.tabId);
        if (ping && ping.trackingRequestId === req.id && ping.generating) {
          await db.requests.update(req.id, { lastActivityAt: t });
          return;
        }
      }
      await this.finish(req.id, 'failed', 'Timed out waiting for ChatGPT. Retry, or use "Capture latest reply".');
    }).then(() => this.kick());
  }

  // ---------------- helpers ----------------

  private async setStatus(id: ID, status: RequestStatus, extra: Partial<ProviderRequest> = {}): Promise<void> {
    const t = this.now();
    await db.requests.update(id, { status, updatedAt: t, lastActivityAt: t, ...extra });
  }

  private async finish(id: ID, status: 'complete' | 'failed' | 'interrupted' | 'cancelled', error: string | null): Promise<void> {
    const t = this.now();
    await db.transaction('rw', db.requests, db.messages, async () => {
      const req = await db.requests.get(id);
      // Never overwrite a terminal state (e.g. a late dispatch failure after the tab was closed).
      if (!req || TERMINAL_REQUEST_STATUSES.includes(req.status)) return;
      await db.requests.update(id, { status, error, updatedAt: t });
      const msg = await db.messages.get(req.assistantMessageId);
      if (msg && msg.status !== 'complete') {
        const ms: MessageStatus = status === 'complete' ? 'complete' : status;
        await db.messages.update(msg.id, { status: ms, error, updatedAt: t });
      }
    });
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
