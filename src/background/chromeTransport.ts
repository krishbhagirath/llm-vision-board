import { CHATGPT_NEW_CHAT_URL, normalizeProviderUrl, type BackgroundToContent, type NavigateResult, type PingResult, type SubmitPayload, type SubmitResult } from '@/lib/messages';
import type { PrepareMode, ProviderTransport } from '@/providers/types';

const TAB_KEY = 'providerTabId';
const READY_TIMEOUT_MS = 45_000;
const CONTENT_SCRIPT_FILE = 'content-scripts/chatgpt.js';

interface ReadyWaiter {
  matches: (url: string) => boolean;
  resolve: () => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** ChatGPT transport backed by chrome.tabs / chrome.scripting. */
export class ChromeChatGPTTransport implements ProviderTransport {
  private waiters = new Map<number, ReadyWaiter>();

  async findTab(): Promise<number | null> {
    const stored = (await chrome.storage.session.get(TAB_KEY))[TAB_KEY] as number | undefined;
    if (typeof stored === 'number') {
      const tab = await chrome.tabs.get(stored).catch(() => null);
      if (tab?.url?.startsWith('https://chatgpt.com')) return stored;
    }
    const tabs = await chrome.tabs.query({ url: 'https://chatgpt.com/*' });
    if (!tabs.length) return null;
    tabs.sort((a, b) => Number(b.active) - Number(a.active) || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
    const id = tabs[0]!.id ?? null;
    if (id !== null) await chrome.storage.session.set({ [TAB_KEY]: id });
    return id;
  }

  /** Called by the background for every cs:ready so pending navigations can resolve. */
  notifyReady(tabId: number, url: string): void {
    const w = this.waiters.get(tabId);
    if (w && w.matches(url)) {
      clearTimeout(w.timer);
      this.waiters.delete(tabId);
      w.resolve();
    }
  }

  async prepareTab(tabId: number, targetUrl: string | null, opts: { allowSoft: boolean } = { allowSoft: false }): Promise<PrepareMode> {
    const tab = await chrome.tabs.get(tabId);
    const current = normalizeProviderUrl(tab.url);
    const desired = targetUrl ? normalizeProviderUrl(targetUrl) : normalizeProviderUrl(CHATGPT_NEW_CHAT_URL);
    if (current === desired && tab.status === 'complete') {
      await this.ensureScript(tabId);
      return 'already';
    }
    if (opts.allowSoft && tab.status === 'complete' && (await this.ping(tabId))) {
      // Try an in-page switch (click ChatGPT's own link). The content script only reports
      // success once the target conversation is verifiably rendered with no stale turns.
      const res = await this.send<NavigateResult | undefined>(tabId, { type: 'cs:navigate', targetUrl }).catch(() => undefined);
      if (res?.ok) return res.mode === 'already' ? 'already' : 'soft';
      // Anything else (link not in sidebar, timeout, unrecognised page) → safe full reload below.
    }
    await this.hardNavigate(tabId, targetUrl, desired);
    return 'hard';
  }

  private async hardNavigate(tabId: number, targetUrl: string | null, desired: string | null): Promise<void> {
    const matches = (url: string) => normalizeProviderUrl(url) === desired;
    const ready = new Promise<void>((resolve, reject) => {
      this.waiters.get(tabId)?.reject(new Error('Superseded by a newer navigation'));
      const timer = setTimeout(() => {
        this.waiters.delete(tabId);
        reject(new Error('ChatGPT page did not finish loading in time'));
      }, READY_TIMEOUT_MS);
      this.waiters.set(tabId, { matches, resolve, reject, timer });
    });
    await chrome.tabs.update(tabId, { url: targetUrl ?? CHATGPT_NEW_CHAT_URL });
    await ready;
  }

  private async ensureScript(tabId: number): Promise<void> {
    if (await this.ping(tabId)) return;
    // Tab predates installation / extension reload: inject the declared content script.
    await chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT_FILE] });
    if (!(await this.ping(tabId))) throw new Error('ChatGPT tab is not responding. Reload the ChatGPT tab and retry.');
  }

  private async send<T>(tabId: number, msg: BackgroundToContent): Promise<T> {
    return (await chrome.tabs.sendMessage(tabId, msg)) as T;
  }

  async submit(tabId: number, payload: SubmitPayload): Promise<SubmitResult> {
    await this.ensureScript(tabId);
    return this.send<SubmitResult>(tabId, { type: 'cs:submit', payload });
  }

  async cancel(tabId: number, requestId: string): Promise<void> {
    await this.send(tabId, { type: 'cs:cancel', requestId });
  }

  async ping(tabId: number): Promise<PingResult | null> {
    try {
      const r = await this.send<PingResult | undefined>(tabId, { type: 'cs:ping' });
      return r?.ok ? r : null;
    } catch {
      return null;
    }
  }

  async request<T>(tabId: number, msg: BackgroundToContent): Promise<T> {
    await this.ensureScript(tabId);
    return this.send<T>(tabId, msg);
  }

  async rememberTab(tabId: number): Promise<void> {
    await chrome.storage.session.set({ [TAB_KEY]: tabId });
  }
}
