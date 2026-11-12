import { useState } from 'react';
import { AlertTriangle, Ban, Check, ChevronRight, ClipboardPaste, Copy, RotateCw, Unplug } from 'lucide-react';
import { Button, Spinner, TextArea } from '@/components/Button';
import { attempt, toast } from '@/components/toastStore';
import { bg } from '@/lib/bgClient';
import { relativeTime } from '@/hooks/relativeTime';
import { resolveAssistantMessage, retryRequest } from '@/features/conversations/conversationService';
import { CaptureButton } from '@/features/provider/ui/CaptureReplyButton';
import type { Message, ProviderRequest } from '@/types';
import { SOURCE_LABEL, deriveAssistantState, type AssistantState } from './messageState';
import { copyText } from './sendActions';

function Details({ diagnostics }: { diagnostics: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-xs">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 rounded text-muted hover:text-fg"
      >
        <ChevronRight size={12} aria-hidden className={open ? 'rotate-90' : ''} style={{ transition: 'transform 120ms' }} />
        Details
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5">
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-subtle p-2 font-mono text-[11px] leading-4 text-muted">{diagnostics}</pre>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              if (await copyText(diagnostics)) toast.success('Details copied');
              else toast.error('Copy failed. Select the text and copy it manually.');
            }}
          >
            <Copy size={12} aria-hidden />
            Copy details
          </Button>
        </div>
      )}
    </div>
  );
}

function Recovery({ message, request, state }: { message: Message; request: ProviderRequest | undefined; state: AssistantState }) {
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState('');
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {state.canRetry && request && (
          <Button
            size="sm"
            variant="primary"
            onClick={() =>
              void attempt(async () => {
                await retryRequest(request.id);
                await bg.kick();
              })
            }
          >
            <RotateCw size={13} aria-hidden />
            Retry
          </Button>
        )}
        <CaptureButton
          onConfirm={(t) => void attempt(() => resolveAssistantMessage(message.id, t, 'tab-capture'), 'Reply saved')}
        />
        <Button size="sm" aria-expanded={pasting} onClick={() => setPasting((p) => !p)}>
          <ClipboardPaste size={13} aria-hidden />
          Paste response
        </Button>
      </div>
      {pasting && (
        <div className="space-y-2">
          <TextArea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste ChatGPT's answer here" aria-label="Pasted response" />
          <Button
            size="sm"
            variant="primary"
            disabled={!text.trim()}
            onClick={() => void attempt(() => resolveAssistantMessage(message.id, text, 'manual-paste'), 'Response saved')}
          >
            Save response
          </Button>
        </div>
      )}
    </div>
  );
}

const FAIL_ICON = { failed: AlertTriangle, interrupted: Unplug, cancelled: Ban } as const;
const FAIL_HINT = {
  failed: 'ChatGPT did not return an answer for this prompt.',
  interrupted: 'The connection to ChatGPT was lost before the answer finished.',
  cancelled: 'You cancelled this request.',
} as const;

interface Props {
  message: Message;
  request?: ProviderRequest;
  /** Archived (read-only) messages show no recovery actions. */
  readOnly?: boolean;
}

/**
 * The one status component for an assistant message:
 * Waiting for ChatGPT / Writing (cancellable) / Captured / Failed, Interrupted, Cancelled (with recovery).
 * Uses `request.detail` for the live step. Raw `[diagnostics: …]` text sits behind "Details".
 */
export function MessageStatus({ message, request, readOnly = false }: Props) {
  const state = deriveAssistantState(message, request);

  if (state.phase === 'waiting' || state.phase === 'writing') {
    return (
      <div role="status" className="flex items-center gap-2 text-xs text-muted">
        <Spinner className="h-3.5 w-3.5 text-status-pending" />
        <span className="font-medium text-fg">{state.label}</span>
        <span className="min-w-0 truncate">{state.detail}</span>
        {!readOnly && state.canCancel && request && (
          <Button size="sm" variant="ghost" className="ml-auto !h-6 !px-2" onClick={() => void attempt(() => bg.cancel(request.id))}>
            Cancel
          </Button>
        )}
      </div>
    );
  }

  if (state.phase === 'captured') {
    const source = SOURCE_LABEL[message.source];
    return (
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
          <Check size={13} aria-hidden className="text-status-answered" />
          <span className="font-medium">Captured</span>
          {source && <span>· {source}</span>}
          <span className="text-faint">· {relativeTime(message.updatedAt)}</span>
        </div>
        {state.human && (
          <div role="note" className="rounded-md border border-warn/30 bg-warn-soft px-2.5 py-1.5 text-xs text-warn">
            {state.human}
          </div>
        )}
        {state.diagnostics && <Details diagnostics={state.diagnostics} />}
      </div>
    );
  }

  const Icon = FAIL_ICON[state.phase];
  return (
    <div role="alert" className="space-y-2.5 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5">
      <div className="flex items-start gap-2">
        <Icon size={15} aria-hidden className="mt-0.5 shrink-0 text-danger" />
        <div className="min-w-0 space-y-0.5">
          <div className="text-ui font-semibold text-danger">{state.label}</div>
          <p className="text-ui text-fg">{state.human ?? FAIL_HINT[state.phase]}</p>
        </div>
      </div>
      {!readOnly && <Recovery message={message} request={request} state={state} />}
      {state.diagnostics && <Details diagnostics={state.diagnostics} />}
    </div>
  );
}
