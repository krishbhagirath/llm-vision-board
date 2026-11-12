import { useState } from 'react';
import { Button, Spinner } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { toast, errMsg } from '@/components/toastStore';
import { bg } from '@/lib/bgClient';
import type { CaptureResult } from '@/lib/messages';

interface Props {
  label?: string;
  kind?: 'reply' | 'selection';
  /** Called only after the user confirms the previewed text. */
  onConfirm: (text: string, url: string | null) => void | Promise<void>;
  size?: 'sm' | 'md';
}

/** Reads the visible latest reply (or selection) from the ChatGPT tab on explicit click, then asks for confirmation. */
export function CaptureButton({ label, kind = 'reply', onConfirm, size = 'sm' }: Props) {
  const [busy, setBusy] = useState(false);
  const [captured, setCaptured] = useState<CaptureResult | null>(null);
  const defaultLabel = kind === 'reply' ? 'Capture latest reply from ChatGPT tab' : 'Capture selection from ChatGPT';

  const run = async () => {
    setBusy(true);
    try {
      const r = kind === 'reply' ? await bg.captureLatestReply() : await bg.captureSelection();
      if (!r || !r.ok || !r.text.trim()) toast.error(r?.error ?? `Nothing to capture. Make sure a ChatGPT tab is open${kind === 'selection' ? ' with text selected' : ' with a visible reply'}.`);
      else setCaptured(r);
    } catch (e) {
      toast.error(`Could not reach the ChatGPT tab: ${errMsg(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size={size} onClick={() => void run()} disabled={busy}>
        {busy && <Spinner />}
        {label ?? defaultLabel}
      </Button>
      {captured && (
        <ConfirmDialog
          title={kind === 'reply' ? 'Use this captured reply?' : 'Use this captured selection?'}
          confirmLabel="Use this text"
          onCancel={() => setCaptured(null)}
          onConfirm={async () => {
            const c = captured;
            setCaptured(null);
            await onConfirm(c.text, c.url);
          }}
        >
          <p className="mb-2 text-xs text-muted">Read from your ChatGPT tab just now. Review before it is saved.</p>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-subtle p-3 text-xs">{captured.text}</pre>
        </ConfirmDialog>
      )}
    </>
  );
}
