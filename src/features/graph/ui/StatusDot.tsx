import { AlertCircle, Check, Circle } from 'lucide-react';
import { Spinner } from '@/components/Button';
import type { CardState } from './graphView';

export const STATUS_LABEL: Record<CardState, string> = {
  answered: 'Answered',
  streaming: 'ChatGPT is answering',
  pending: 'Waiting for ChatGPT',
  failed: 'Last request failed',
  unexplored: 'Not asked yet',
};

/** Compact status glyph: check (answered), spinner (pending/generating), alert (failed), hollow circle (unexplored). */
export function StatusGlyph({ state, size = 14 }: { state: CardState; size?: number }) {
  const label = STATUS_LABEL[state];
  switch (state) {
    case 'answered':
      return (
        <span role="img" aria-label={label} title={label} className="flex shrink-0 items-center justify-center rounded-full bg-status-answered text-white" style={{ width: size, height: size }}>
          <Check size={size - 5} strokeWidth={3.5} />
        </span>
      );
    case 'streaming':
    case 'pending':
      return (
        <span role="img" aria-label={label} title={label} className="shrink-0 text-status-pending">
          <Spinner className="h-3.5 w-3.5" />
        </span>
      );
    case 'failed':
      return (
        <span role="img" aria-label={label} title={label} className="shrink-0 text-status-failed">
          <AlertCircle size={size} />
        </span>
      );
    default:
      return (
        <span role="img" aria-label={label} title={label} className="shrink-0 text-status-unexplored">
          <Circle size={size} strokeWidth={2} />
        </span>
      );
  }
}

/** Back-compat wrapper for callers that only know the provider status. */
export function StatusDot({ status }: { status: 'pending' | 'streaming' | 'failed' | undefined }) {
  if (!status) return null;
  return <StatusGlyph state={status} />;
}
