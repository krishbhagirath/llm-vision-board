import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronRight, Layers, Lock } from 'lucide-react';
import { Popover } from '@/components/Popover';
import { previewPrompt } from '@/features/conversations/conversationService';
import { estimateTokens, formatTokenEstimate } from '@/features/context/tokens';
import type { ID } from '@/types';
import { breakdown, contextLine } from './contextSummary';

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

function Row({ title, tokens, note }: { title: string; tokens: number; note?: string }) {
  return (
    <li className="flex items-baseline gap-2">
      <span className="min-w-0 flex-1 truncate" title={title}>
        {title}
        {note && <span className="text-faint"> · {note}</span>}
      </span>
      <span className="shrink-0 tabular-nums text-faint">≈{tokens}</span>
    </li>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h4 className="text-xs font-semibold text-muted">{title}</h4>
      {children}
    </section>
  );
}

interface Props {
  nodeId: ID;
  /** What is typed in the composer right now. */
  text: string;
}

/**
 * One quiet line above the composer: what the next message carries from the map.
 * Click for the breakdown and the exact prompt. Uses the side-effect-free `previewPrompt`.
 */
export function ContextIndicator({ nodeId, text }: Props) {
  const debounced = useDebounced(text, 250);
  const preview = useLiveQuery(() => previewPrompt(nodeId, debounced).catch(() => null), [nodeId, debounced]);
  const [showPrompt, setShowPrompt] = useState(false);
  if (!preview) return null;

  const items = preview.contextPackage?.items ?? null;
  const tokens = estimateTokens(preview.prompt);
  const line = contextLine(items, preview.firstTurn, tokens);
  const b = breakdown(items ?? []);

  return (
    <div className="flex min-w-0 [&>span]:max-w-full [&>span]:min-w-0">
    <Popover
      label="Context for the next message"
      placement="top-start"
      className="w-[min(380px,calc(100vw-16px))]"
      trigger={
        <button
          type="button"
          aria-label={`${line}. Show what is included`}
          className="group flex min-w-0 max-w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs text-muted transition-colors hover:bg-hover hover:text-fg"
        >
          <Layers size={13} aria-hidden className="shrink-0 text-accent" />
          <span className="min-w-0 truncate">{line}</span>
          <ChevronRight size={12} aria-hidden className="shrink-0 text-faint group-hover:text-muted" />
        </button>
      }
    >
      <div className="space-y-3 text-xs">
        <div>
          <div className="text-sm font-semibold">{preview.firstTurn ? 'Sent with your next message' : 'Your next message'}</div>
          <p className="mt-0.5 text-muted">
            {preview.firstTurn
              ? 'This is the first message in this ChatGPT conversation, so the map context below is included once.'
              : 'ChatGPT already holds the earlier context, so only your message is sent.'}
          </p>
        </div>

        {preview.firstTurn && items && items.length === 0 && <p className="text-muted">Nothing from the map applies yet. This is a top-level question.</p>}

        {b.workspace && (
          <Section title="Workspace goal">
            <ul className="space-y-0.5">
              <Row title={b.workspace.text} tokens={b.workspace.approxTokens} />
            </ul>
          </Section>
        )}
        {b.ancestors.length > 0 && (
          <Section title={`Ancestors, root first (${b.ancestors.length})`}>
            <ol className="space-y-0.5">
              {b.ancestors.map((a, i) => (
                <Row key={`${a.nodeId}-${i}`} title={`${i + 1}. ${a.title}`} tokens={a.approxTokens} note={a.text ? undefined : 'title only'} />
              ))}
            </ol>
          </Section>
        )}
        {b.passage && (
          <Section title="Selected passage">
            <blockquote className="max-h-20 overflow-hidden rounded-md border-l-[3px] border-accent bg-accent-soft/60 px-2.5 py-1.5 leading-5 text-fg">{b.passage.text}</blockquote>
          </Section>
        )}
        {b.linked.length > 0 && (
          <Section title="Linked concepts">
            <ul className="space-y-0.5">
              {b.linked.map((l, i) => (
                <Row key={`${l.nodeId}-${i}`} title={l.title} tokens={l.approxTokens} />
              ))}
            </ul>
          </Section>
        )}
        {b.handoff && (
          <Section title="Handoff summary">
            <ul className="space-y-0.5">
              <Row title="Summary of your earlier conversation on this node" tokens={b.handoff.approxTokens} />
            </ul>
          </Section>
        )}

        <p className="flex items-start gap-1.5 text-faint">
          <Lock size={12} aria-hidden className="mt-0.5 shrink-0" />
          Sibling branches are never included.
        </p>

        <div className="border-t border-line pt-2">
          <button
            type="button"
            aria-expanded={showPrompt}
            onClick={() => setShowPrompt((o) => !o)}
            className="flex w-full items-center justify-between rounded text-muted hover:text-fg"
          >
            <span className="inline-flex items-center gap-1">
              <ChevronRight size={12} aria-hidden className={showPrompt ? 'rotate-90' : ''} style={{ transition: 'transform 120ms' }} />
              View exact prompt
            </span>
            <span className="tabular-nums">{formatTokenEstimate(tokens)}</span>
          </button>
          {showPrompt && (
            <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-subtle p-2 font-mono text-[11px] leading-4 text-fg">
              {preview.prompt || '(type a message to see the prompt)'}
            </pre>
          )}
        </div>
      </div>
    </Popover>
    </div>
  );
}
