import type { ID } from '@/types';

/**
 * Typed runtime-message protocol between extension contexts.
 *  UI (board / side panel)  ⇄  background service worker  ⇄  ChatGPT content script
 * Requests themselves live in IndexedDB; messages only signal and carry streaming data.
 */

export interface ProviderStatus {
  /** A chatgpt.com tab exists. */
  tabOpen: boolean;
  tabId: number | null;
  /** Content script answered a ping. */
  scriptReady: boolean;
  /** The composer textbox was found. */
  composerFound: boolean;
  /** Visible login/sign-up controls suggest the user is logged out. */
  loggedOutHint: boolean;
  generating: boolean;
  url: string | null;
  automationEnabled: boolean;
  activeRequestId: ID | null;
  queued: number;
}

// ---- UI → background ----
export type UiToBackground =
  | { type: 'bg:kick' }
  | { type: 'bg:cancel'; requestId: ID }
  | { type: 'bg:status' }
  | { type: 'bg:openChatGPT'; url?: string | null }
  | { type: 'bg:openBoard'; nodeId?: ID }
  | { type: 'bg:captureSelection' }
  | { type: 'bg:captureLatestReply' };

export interface CaptureResult {
  ok: boolean;
  text: string;
  url: string | null;
  error?: string;
}

// ---- background → content script ----
export interface SubmitPayload {
  requestId: ID;
  prompt: string;
  /**
   * The target is an existing ChatGPT conversation: wait until its history is rendered
   * before snapshotting the baseline (otherwise late-rendering old turns look "new").
   */
  expectHistory?: boolean;
  /**
   * Only accept a reply that follows the user turn created by this submission. Set after
   * no-reload switching, where stale DOM from the previous conversation is possible.
   */
  requireAnchor?: boolean;
}

export type NavigateResult =
  | { ok: true; mode: 'already' | 'soft' }
  | { ok: false; reason: string };
export type BackgroundToContent =
  | { type: 'cs:ping' }
  | { type: 'cs:submit'; payload: SubmitPayload }
  | { type: 'cs:navigate'; targetUrl: string | null }
  | { type: 'cs:cancel'; requestId: ID }
  | { type: 'cs:getSelection' }
  | { type: 'cs:captureLatest' };

export interface PingResult {
  ok: true;
  url: string;
  composerFound: boolean;
  loggedOutHint: boolean;
  generating: boolean;
  trackingRequestId: ID | null;
}

export type SubmitResult =
  | { ok: true; duplicate: boolean }
  | { ok: false; error: string; retryable: boolean };

// ---- content script → background ----
export type ContentToBackground =
  | { type: 'cs:ready'; url: string }
  | { type: 'cs:progress'; requestId: ID; content: string; providerMessageRef: string | null }
  | {
      type: 'cs:complete';
      requestId: ID;
      content: string;
      url: string;
      providerMessageRef: string | null;
      promptVerified: boolean;
    }
  | { type: 'cs:failed'; requestId: ID; error: string; interrupted: boolean };

export const CHATGPT_ORIGIN = 'https://chatgpt.com';
export const CHATGPT_NEW_CHAT_URL = 'https://chatgpt.com/';

/** Normalize a ChatGPT URL to origin+path (ignores query/hash) for comparison. */
export function normalizeProviderUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.replace(/\/+$/, '') || '/'}`;
  } catch {
    return null;
  }
}

/** True when the URL is a specific ChatGPT conversation (/c/<id>, incl. project/GPT scoped). */
export function isConversationUrl(url: string | null | undefined): boolean {
  const n = normalizeProviderUrl(url);
  return !!n && n.startsWith(CHATGPT_ORIGIN) && /\/c\/[\w-]+$/.test(n);
}
