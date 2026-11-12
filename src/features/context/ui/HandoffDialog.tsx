import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button, TextArea } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { Dialog } from '@/components/Dialog';
import { attempt, errMsg, toast } from '@/components/toastStore';
import { db } from '@/storage/db';
import { useSettings } from '@/hooks/useSettings';
import {
  HANDOFF_SECTIONS,
  applyHandoff,
  discardHandoff,
  filterHandoffContent,
  generateHandoffDraft,
  renderHandoff,
  sectionCount,
  type HandoffSectionKey,
} from '@/features/context/handoff';
import { estimateTokens, formatTokenEstimate } from '@/features/context/tokens';
import type { ContextSnapshot, ID } from '@/types';

function TokenMeter({ handoffTokens, usedTokens, threshold }: { handoffTokens: number; usedTokens: number; threshold: number }) {
  const pct = (n: number) => `${Math.min(100, Math.round((n / Math.max(1, threshold)) * 100))}%`;
  return (
    <div className="space-y-1.5 rounded-lg border border-line bg-subtle/60 px-3 py-2.5 text-xs">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-muted">New conversation would start with</span>
        <span className="font-semibold tabular-nums">{formatTokenEstimate(handoffTokens)}</span>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-muted">Used so far in this one</span>
        <span className="tabular-nums">{formatTokenEstimate(usedTokens)}</span>
      </div>
      <div className="relative h-1.5 overflow-hidden rounded-full bg-line" role="img" aria-label={`Bars compare against the handoff suggestion threshold of ${formatTokenEstimate(threshold)}`}>
        <span className="absolute inset-y-0 left-0 rounded-full bg-warn/60" style={{ width: pct(usedTokens) }} />
        <span className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: pct(handoffTokens) }} />
      </div>
      <p className="text-faint">Bar scale: your handoff suggestion threshold, {formatTokenEstimate(threshold)}. All counts are estimates (about 4 characters per token).</p>
    </div>
  );
}

export function HandoffDialog({ snapshot, onClose }: { snapshot: ContextSnapshot; onClose: () => void }) {
  const settings = useSettings();
  const content = snapshot.content;
  const conversation = useLiveQuery(() => (snapshot.conversationId ? db.conversations.get(snapshot.conversationId) : undefined), [snapshot.conversationId]);
  const [include, setInclude] = useState<ReadonlySet<HandoffSectionKey>>(() => new Set(HANDOFF_SECTIONS.map((s) => s.key)));
  const [text, setText] = useState(snapshot.summary);
  const [edited, setEdited] = useState(false);
  const [rebuilt, setRebuilt] = useState(false);
  const [busy, setBusy] = useState(false);
  const tokens = useMemo(() => estimateTokens(text), [text]);

  const toggle = (key: HandoffSectionKey) => {
    if (!content) return;
    const next = new Set(include);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setInclude(next);
    setText(renderHandoff(filterHandoffContent(content, next)));
    setRebuilt(edited);
    setEdited(false);
  };

  return (
    <Dialog
      title="Create handoff"
      description="Start a fresh ChatGPT conversation for this node, seeded with a short summary of this one. Your original messages stay here."
      width="max-w-2xl"
      onClose={onClose}
      footer={
        <>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await attempt(() => discardHandoff(snapshot.id), 'Handoff discarded');
              onClose();
            }}
          >
            Discard
          </Button>
          <Button
            variant="primary"
            disabled={busy || !text.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await applyHandoff(snapshot.id, text);
                onClose();
              } catch (e) {
                toast.error(errMsg(e));
                setBusy(false);
              }
            }}
          >
            Confirm handoff
          </Button>
        </>
      }
    >
      <div role="note" className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-warn">
        <Badge tone="warn">Rule-based</Badge>
        <span>This summary is built from headings, bold terms and key sentences, not by an AI. Review it before confirming.</span>
      </div>

      {content && (
        <fieldset className="space-y-1.5">
          <legend className="mb-1 text-xs font-medium text-muted">Include in the summary</legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {HANDOFF_SECTIONS.map((s) => {
              const n = sectionCount(content, s.key);
              const id = `handoff-${s.key}`;
              return (
                <label
                  key={s.key}
                  htmlFor={id}
                  className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-ui ${n === 0 ? 'border-line opacity-60' : 'cursor-pointer border-line hover:bg-hover'}`}
                >
                  <input
                    id={id}
                    type="checkbox"
                    disabled={n === 0}
                    checked={include.has(s.key) && n > 0}
                    onChange={() => toggle(s.key)}
                    className="mt-0.5 h-3.5 w-3.5 accent-[var(--accent)]"
                  />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 font-medium">
                      {s.label}
                      <span className="text-xs font-normal tabular-nums text-faint">{n === 0 ? 'none found' : n}</span>
                    </span>
                    <span className="block truncate text-xs text-muted">{s.hint}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      <div className="space-y-1.5">
        <label htmlFor="handoff-text" className="text-xs font-medium text-muted">
          Final text sent to the new conversation (editable)
        </label>
        <TextArea
          id="handoff-text"
          rows={9}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setEdited(true);
            setRebuilt(false);
          }}
          className="font-mono text-xs leading-5"
        />
        {rebuilt && <p className="text-xs text-warn">The text was rebuilt from the selected sections; your manual edits were replaced.</p>}
        {edited && content && <p className="text-xs text-faint">Changing the sections above will rebuild the text and replace your edits.</p>}
      </div>

      {settings && <TokenMeter handoffTokens={tokens} usedTokens={conversation?.context.approxTokensSent ?? 0} threshold={settings.handoffSuggestTokens} />}
    </Dialog>
  );
}

/** Button that generates a handoff draft and opens the editing dialog. */
export function HandoffControl({ nodeId, label = 'Create handoff…', variant = 'secondary' }: { nodeId: ID; label?: string; variant?: 'secondary' | 'primary' | 'ghost' }) {
  const [snap, setSnap] = useState<ContextSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button
        size="sm"
        variant={variant}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const s = await attempt(() => generateHandoffDraft(nodeId));
          setBusy(false);
          if (s) setSnap(s);
        }}
      >
        {label}
      </Button>
      {snap && <HandoffDialog snapshot={snap} onClose={() => setSnap(null)} />}
    </>
  );
}
