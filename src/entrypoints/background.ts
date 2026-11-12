import { ChromeChatGPTTransport } from '@/background/chromeTransport';
import { RequestOrchestrator } from '@/providers/orchestrator';
import { getSettings } from '@/storage/db';
import { CHATGPT_NEW_CHAT_URL, type CaptureResult, type ContentToBackground, type ProviderStatus, type UiToBackground } from '@/lib/messages';

/**
 * MV3 service worker. It can be terminated at any time, so it keeps no essential
 * state in memory: requests live in IndexedDB and are reconciled in `resume()`.
 */
export default defineBackground(() => {
  const transport = new ChromeChatGPTTransport();
  const orchestrator = new RequestOrchestrator({ transport });
  const WATCHDOG = 'lvb-watchdog';

  chrome.alarms.create(WATCHDOG, { periodInMinutes: 0.5 });
  chrome.alarms.onAlarm.addListener((a) => {
    if (a.name === WATCHDOG) void orchestrator.watchdog();
  });

  // Toolbar icon opens the full board; side panel is opened explicitly.
  chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => undefined);
  chrome.action.onClicked.addListener(() => void openBoard());

  chrome.commands.onCommand.addListener((command, tab) => {
    if (command === 'open-board') void openBoard();
    if (command === 'open-side-panel' && tab?.windowId !== undefined) {
      // Must be called synchronously inside the user gesture.
      chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined);
    }
  });

  chrome.tabs.onRemoved.addListener((tabId) => void orchestrator.onTabRemoved(tabId));

  chrome.runtime.onMessage.addListener((msg: UiToBackground | ContentToBackground, sender, sendResponse) => {
    if (!msg || typeof msg !== 'object' || !('type' in msg)) return false;

    // Messages from the ChatGPT content script
    if (msg.type.startsWith('cs:')) {
      const tabId = sender.tab?.id;
      if (tabId === undefined || !sender.url?.startsWith('https://chatgpt.com')) return false;
      const m = msg as ContentToBackground;
      if (m.type === 'cs:ready') {
        transport.notifyReady(tabId, m.url);
        if (sender.tab?.active) void transport.rememberTab(tabId);
      }
      void orchestrator.handleContentMessage(tabId, m);
      return false;
    }

    // Messages from extension pages only
    if (sender.id !== chrome.runtime.id || sender.tab?.url?.startsWith('https://')) return false;
    const m = msg as UiToBackground;
    handleUi(m).then(sendResponse, (err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    return true;
  });

  async function handleUi(m: UiToBackground): Promise<unknown> {
    switch (m.type) {
      case 'bg:kick':
        await orchestrator.kick();
        return { ok: true };
      case 'bg:cancel':
        await orchestrator.cancel(m.requestId);
        return { ok: true };
      case 'bg:status':
        return status();
      case 'bg:openChatGPT': {
        const tabId = await transport.findTab();
        if (tabId !== null && !m.url) {
          const tab = await chrome.tabs.update(tabId, { active: true });
          if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
          return { ok: true, tabId };
        }
        if (tabId !== null && m.url) {
          const tab = await chrome.tabs.update(tabId, { active: true, url: m.url });
          if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
          return { ok: true, tabId };
        }
        const tab = await chrome.tabs.create({ url: m.url ?? CHATGPT_NEW_CHAT_URL });
        if (tab.id !== undefined) await transport.rememberTab(tab.id);
        return { ok: true, tabId: tab.id };
      }
      case 'bg:openBoard':
        await openBoard(m.nodeId);
        return { ok: true };
      case 'bg:captureSelection':
      case 'bg:captureLatestReply': {
        const tabId = await transport.findTab();
        if (tabId === null) return { ok: false, text: '', url: null, error: 'ChatGPT is not connected. Open ChatGPT to continue.' } satisfies CaptureResult;
        try {
          return await transport.request<CaptureResult>(tabId, { type: m.type === 'bg:captureSelection' ? 'cs:getSelection' : 'cs:captureLatest' });
        } catch (err) {
          return { ok: false, text: '', url: null, error: `Could not reach the ChatGPT tab (${err instanceof Error ? err.message : String(err)}). Reload it and retry.` } satisfies CaptureResult;
        }
      }
    }
  }

  async function status(): Promise<ProviderStatus> {
    const settings = await getSettings();
    const tabId = await transport.findTab();
    const ping = tabId !== null ? await transport.ping(tabId) : null;
    const active = await orchestrator.activeRequest();
    return {
      tabOpen: tabId !== null,
      tabId,
      scriptReady: !!ping,
      composerFound: ping?.composerFound ?? false,
      loggedOutHint: ping?.loggedOutHint ?? false,
      generating: ping?.generating ?? false,
      url: ping?.url ?? null,
      automationEnabled: settings.chatgptAutomation,
      activeRequestId: active?.id ?? null,
      queued: await orchestrator.queuedCount(),
    };
  }

  async function openBoard(nodeId?: string): Promise<void> {
    const base = chrome.runtime.getURL('/board.html');
    const url = nodeId ? `${base}#node=${encodeURIComponent(nodeId)}` : base;
    // runtime.getContexts sees our own pages without needing the broad "tabs" permission.
    const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.TAB] }).catch(() => []);
    const existing = contexts.find((c) => c.documentUrl?.startsWith(base) && c.tabId >= 0);
    if (existing) {
      const tab = await chrome.tabs.update(existing.tabId, nodeId ? { active: true, url } : { active: true });
      if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
    } else {
      await chrome.tabs.create({ url });
    }
  }

  // Service worker (re)started: reconcile any request that was in flight.
  void orchestrator.resume();
});
