import { ACTIVE_REQUEST_STATUSES, type Message, type ProviderRequest } from '@/types';

/** Pure view-model for one assistant message: what to show, and which recovery actions make sense. */

export type AssistantPhase = 'waiting' | 'writing' | 'captured' | 'failed' | 'interrupted' | 'cancelled';

export interface AssistantState {
  phase: AssistantPhase;
  /** Short headline: "Waiting for ChatGPT", "Writing", "Captured", "Failed"… */
  label: string;
  /** Live step from the request (`request.detail`) or a sensible default. */
  detail: string | null;
  /** A request is queued or running for this message. */
  inFlight: boolean;
  canCancel: boolean;
  canRetry: boolean;
  /** Human sentence for failures (diagnostics stripped). */
  human: string | null;
  /** Raw `[diagnostics: …]` payload, if the error carried one. */
  diagnostics: string | null;
}

const DIAG = /\s*\[diagnostics:\s*([\s\S]*?)\]\s*$/;

/** Splits "Sentence. [diagnostics: …]" so the sentence can lead and the technical tail can sit behind a disclosure. */
export function splitDiagnostics(error: string | null | undefined): { human: string | null; diagnostics: string | null } {
  if (!error) return { human: null, diagnostics: null };
  const m = DIAG.exec(error);
  if (!m) return { human: error.trim() || null, diagnostics: null };
  const human = error.slice(0, m.index).trim();
  return { human: human || null, diagnostics: m[1]!.trim() || null };
}

const REQUEST_ACTIVE: ReadonlySet<string> = new Set(['queued', ...ACTIVE_REQUEST_STATUSES]);
const RETRYABLE: ReadonlySet<string> = new Set(['failed', 'interrupted', 'cancelled']);

export function isRequestActive(r: ProviderRequest | undefined): boolean {
  return !!r && REQUEST_ACTIVE.has(r.status);
}

/** The in-flight request of a conversation, if any (used to disable Send and explain why). */
export function activeRequestOf(requests: Iterable<ProviderRequest>): ProviderRequest | undefined {
  let found: ProviderRequest | undefined;
  for (const r of requests) if (isRequestActive(r) && (!found || r.createdAt > found.createdAt)) found = r;
  return found;
}

function defaultDetail(r: ProviderRequest | undefined): string {
  switch (r?.status) {
    case 'queued':
      return 'Queued. Starting as soon as ChatGPT is free…';
    case 'dispatching':
      return 'Sending your prompt…';
    case 'streaming':
      return 'ChatGPT is writing…';
    default:
      return 'Waiting for ChatGPT to answer…';
  }
}

export function deriveAssistantState(m: Message, r: ProviderRequest | undefined): AssistantState {
  const inFlight = isRequestActive(r);
  const { human, diagnostics } = splitDiagnostics(m.error);
  const detail = r?.detail?.trim() || null;
  const canRetry = !!r && RETRYABLE.has(r.status);
  switch (m.status) {
    case 'pending':
      return { phase: 'waiting', label: 'Waiting for ChatGPT', detail: detail ?? defaultDetail(r), inFlight, canCancel: inFlight, canRetry: false, human: null, diagnostics: null };
    case 'streaming':
      return { phase: 'writing', label: 'Writing', detail: detail ?? 'ChatGPT is writing…', inFlight, canCancel: inFlight, canRetry: false, human: null, diagnostics: null };
    case 'failed':
      return { phase: 'failed', label: 'Failed', detail: null, inFlight: false, canCancel: false, canRetry, human, diagnostics };
    case 'interrupted':
      return { phase: 'interrupted', label: 'Interrupted', detail: null, inFlight: false, canCancel: false, canRetry, human, diagnostics };
    case 'cancelled':
      return { phase: 'cancelled', label: 'Cancelled', detail: null, inFlight: false, canCancel: false, canRetry, human, diagnostics };
    default:
      // A warning on a complete message (e.g. a verification note) keeps the human sentence but is not a failure.
      return { phase: 'captured', label: 'Captured', detail: null, inFlight: false, canCancel: false, canRetry: false, human, diagnostics };
  }
}

export const SOURCE_LABEL: Record<Message['source'], string> = {
  automation: 'Received from ChatGPT',
  'manual-paste': 'Pasted manually',
  'tab-capture': 'Captured from ChatGPT tab',
  user: '',
};

/** Why Send is disabled while a node has an active request (shown next to the button). */
export function busyReason(r: ProviderRequest | undefined): string | null {
  if (!r || !isRequestActive(r)) return null;
  return r.status === 'streaming' ? 'ChatGPT is still writing the previous answer.' : 'A request for this node is still in progress.';
}
