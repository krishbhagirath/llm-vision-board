import { ChatGPTContentController } from '@/providers/chatgpt/contentController';
import type { BackgroundToContent, ContentToBackground } from '@/lib/messages';

/**
 * Content script for chatgpt.com only (see `matches`). It never reads cookies,
 * storage tokens or network traffic — only the visible DOM.
 */
export default defineContentScript({
  matches: ['https://chatgpt.com/*'],
  runAt: 'document_idle',
  main() {
    const w = window as unknown as { __llmVisionBoardLoaded?: boolean };
    if (w.__llmVisionBoardLoaded) return; // guard against double injection
    w.__llmVisionBoardLoaded = true;

    const send = (msg: ContentToBackground) => {
      chrome.runtime.sendMessage(msg).catch(() => {
        /* extension reloaded / background unavailable */
      });
    };
    const controller = new ChatGPTContentController(send);

    chrome.runtime.onMessage.addListener((msg: BackgroundToContent, _sender, sendResponse) => {
      if (!msg || typeof msg !== 'object' || !('type' in msg) || !String(msg.type).startsWith('cs:')) return false;
      Promise.resolve(controller.handle(msg))
        .then(sendResponse)
        .catch((err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err), retryable: true }));
      return true; // async response
    });

    send({ type: 'cs:ready', url: location.href });
  },
});
