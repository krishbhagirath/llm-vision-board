import { ExternalLink, RefreshCw } from 'lucide-react';
import { Button } from '@/components/Button';
import { Popover } from '@/components/Popover';
import { attempt } from '@/components/toastStore';
import { useProviderStatus } from '@/hooks/useProviderStatus';
import { useSettings } from '@/hooks/useSettings';
import { bg } from '@/lib/bgClient';
import type { ProviderStatus } from '@/lib/messages';
import { useUiStore } from '@/state/uiStore';

type Tone = 'ok' | 'warn' | 'idle';

export interface ProviderSummary {
  tone: Tone;
  /** Short pill text. */
  pill: string;
  /** Headline inside the popover. */
  headline: string;
  /** What to do next, if anything. */
  hint: string | null;
  needsOpen: boolean;
}

/** Pure: turn the raw provider state into display text. */
export function summarizeProvider(status: ProviderStatus | null, unavailable: boolean): ProviderSummary {
  if (unavailable || !status) {
    return unavailable
      ? {
          tone: 'idle',
          pill: 'Manual mode',
          headline: 'Extension connection unavailable',
          hint: 'Copy and paste still works. Open this page from the extension to connect ChatGPT.',
          needsOpen: false,
        }
      : { tone: 'idle', pill: 'Checking…', headline: 'Checking ChatGPT…', hint: null, needsOpen: false };
  }
  if (!status.tabOpen)
    return { tone: 'warn', pill: 'Not connected', headline: 'ChatGPT is not open', hint: 'Open ChatGPT in a tab to send prompts and read replies.', needsOpen: true };
  if (!status.scriptReady)
    return { tone: 'warn', pill: 'Reload ChatGPT', headline: 'ChatGPT tab needs a reload', hint: 'Reload the chatgpt.com tab so Vision Board can connect to it.', needsOpen: false };
  if (status.loggedOutHint)
    return {
      tone: 'warn',
      pill: 'Log in',
      headline: 'You may be logged out of ChatGPT',
      hint: 'Log in on chatgpt.com. Vision Board never handles your password.',
      needsOpen: true,
    };
  return { tone: 'ok', pill: 'ChatGPT connected', headline: 'ChatGPT is connected', hint: null, needsOpen: false };
}

const dotCls: Record<Tone, string> = { ok: 'bg-ok', warn: 'bg-warn', idle: 'bg-faint' };

function Dot({ tone, pulse }: { tone: Tone; pulse?: boolean }) {
  return <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${dotCls[tone]} ${pulse ? 'animate-pulse motion-reduce:animate-none' : ''}`} />;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-6 text-xs">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium tabular-nums text-fg">{value}</dd>
    </div>
  );
}

interface Props {
  /** Kept for backwards compatibility; the pill is always compact. */
  compact?: boolean;
  /** Show the "Open Settings" link (only works where the settings dialog is mounted). */
  showSettingsLink?: boolean;
  /** Hide the text and show only the status dot (very narrow top bars). */
  dotOnly?: boolean;
}

/** Compact provider status pill; click for details and actions. */
export function ProviderStatusBar({ showSettingsLink = false, dotOnly = false }: Props) {
  const { status, unavailable, refresh } = useProviderStatus();
  const settings = useSettings();
  const automation = settings?.chatgptAutomation ?? false;
  const s = summarizeProvider(status, unavailable);
  const busy = !!status?.generating;

  return (
    <Popover
      label="ChatGPT connection details"
      placement="bottom-end"
      trigger={
        <button
          type="button"
          aria-label={`ChatGPT status: ${s.pill}. Show details`}
          className="inline-flex h-7 items-center gap-2 rounded-full border border-line bg-card px-2.5 text-xs font-medium text-fg shadow-sm transition-colors hover:bg-hover"
        >
          <Dot tone={s.tone} pulse={busy} />
          {!dotOnly && <span className="max-w-32 truncate">{busy ? 'Generating…' : s.pill}</span>}
        </button>
      }
    >
      <div className="w-72 space-y-3">
        <div className="flex items-start gap-2.5">
          <span className="mt-1.5">
            <Dot tone={s.tone} />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold">{s.headline}</div>
            {s.hint && <p className="mt-0.5 text-xs text-muted">{s.hint}</p>}
          </div>
        </div>
        {status && (
          <dl className="space-y-1.5 rounded-md bg-subtle px-3 py-2">
            <Row label="Queued requests" value={String(status.queued)} />
            <Row label="Generating" value={status.generating ? 'Yes' : 'No'} />
          </dl>
        )}
        <div className="flex items-center justify-between gap-2 rounded-md border border-line px-3 py-2">
          <div className="text-xs">
            <div className="font-medium">{automation ? 'Automatic mode' : 'Manual mode'}</div>
            <div className="text-muted">{automation ? 'Send fills ChatGPT for you.' : 'You copy prompts and paste replies.'}</div>
          </div>
          {showSettingsLink && (
            <Button size="sm" variant="ghost" onClick={() => useUiStore.getState().openDialog({ kind: 'settings' })}>
              Settings
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          {!unavailable && (
            <Button size="sm" variant={s.needsOpen ? 'primary' : 'secondary'} onClick={() => void attempt(() => bg.openChatGPT())}>
              <ExternalLink size={13} />
              Open ChatGPT
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={refresh}>
            <RefreshCw size={13} />
            Check again
          </Button>
        </div>
      </div>
    </Popover>
  );
}
