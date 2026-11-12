import type { PingResult, SubmitPayload, SubmitResult } from '@/lib/messages';
import type { ID, ProviderId } from '@/types';

export type PrepareMode = 'already' | 'soft' | 'hard';

/** Static description of a provider; drives what the UI offers. */
export interface ProviderInfo {
  id: ProviderId;
  label: string;
  capabilities: {
    automatedSubmit: boolean;
    streaming: boolean;
    cancel: boolean;
    tabCapture: boolean;
  };
  newConversationUrl: string | null;
}

/**
 * Background-side transport for a browser-tab provider. The orchestrator is
 * written against this interface so it can be unit-tested with a mock and so
 * other web providers (Claude.ai, Gemini, …) can be added later.
 */
export interface ProviderTransport {
  /** Find the tab to drive (null when none is open). */
  findTab(): Promise<number | null>;
  /**
   * Make the tab show `targetUrl` (an existing provider conversation) or a fresh
   * chat when null. Resolves once that conversation is verifiably on screen.
   * 'already' = no navigation needed, 'soft' = switched in-page without reload,
   * 'hard' = full page load.
   */
  prepareTab(tabId: number, targetUrl: string | null, opts?: { allowSoft: boolean }): Promise<PrepareMode | void>;
  submit(tabId: number, payload: SubmitPayload): Promise<SubmitResult>;
  cancel(tabId: number, requestId: ID): Promise<void>;
  /** null when the content script is unreachable. */
  ping(tabId: number): Promise<PingResult | null>;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  'chatgpt-web': {
    id: 'chatgpt-web',
    label: 'ChatGPT (your browser session)',
    capabilities: { automatedSubmit: true, streaming: true, cancel: true, tabCapture: true },
    newConversationUrl: 'https://chatgpt.com/',
  },
  manual: {
    id: 'manual',
    label: 'Manual copy/paste',
    capabilities: { automatedSubmit: false, streaming: false, cancel: false, tabCapture: false },
    newConversationUrl: null,
  },
};
