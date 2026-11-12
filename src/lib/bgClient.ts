import type { CaptureResult, ProviderStatus, UiToBackground } from './messages';
import type { ID } from '@/types';

/** Typed wrapper used by extension pages (board + side panel) to talk to the background. */
async function call<T>(msg: UiToBackground): Promise<T> {
  return (await chrome.runtime.sendMessage(msg)) as T;
}

export const bg = {
  kick: () => call<{ ok: boolean }>({ type: 'bg:kick' }),
  cancel: (requestId: ID) => call<{ ok: boolean }>({ type: 'bg:cancel', requestId }),
  status: () => call<ProviderStatus>({ type: 'bg:status' }),
  openChatGPT: (url?: string | null) => call<{ ok: boolean }>({ type: 'bg:openChatGPT', url }),
  openBoard: (nodeId?: ID) => call<{ ok: boolean }>({ type: 'bg:openBoard', nodeId }),
  captureSelection: () => call<CaptureResult>({ type: 'bg:captureSelection' }),
  captureLatestReply: () => call<CaptureResult>({ type: 'bg:captureLatestReply' }),
  /** Side panel must be opened from a user gesture in an extension page. */
  openSidePanel: async () => {
    const win = await chrome.windows.getCurrent();
    if (win.id !== undefined) await chrome.sidePanel.open({ windowId: win.id });
  },
};
