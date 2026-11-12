import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, GitBranch } from 'lucide-react';
import { toast } from '@/components/toastStore';
import { formatShortcut } from '@/components/floating';
import { useUiStore } from '@/state/uiStore';
import type { GraphNode, ID } from '@/types';
import { BranchPopover } from './BranchPopover';
import { copyText, createBranch } from './sendActions';
import { rectToBox, usePlacement } from './usePlacement';

export interface AnswerSelection {
  text: string;
  messageId: ID;
  range: Range;
}

/** The current text selection, if it sits entirely inside ONE answer body within `container`. */
export function readAnswerSelection(container: HTMLElement): AnswerSelection | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const bodyOf = (n: Node | null) => (n instanceof Element ? n : n?.parentElement)?.closest<HTMLElement>('[data-answer-body]') ?? null;
  const a = bodyOf(sel.anchorNode);
  const f = bodyOf(sel.focusNode);
  if (!a || a !== f || !container.contains(a)) return null;
  const messageId = a.closest<HTMLElement>('[data-assistant-message-id]')?.dataset.assistantMessageId;
  const text = sel.toString().replace(/[ \t]+\n/g, '\n').trim();
  if (!messageId || text.length < 2) return null;
  const range = sel.getRangeAt(0);
  const r = range.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { text, messageId, range: range.cloneRange() };
}

const supportsHighlights = () => typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';

/** Keeps `range` visibly highlighted: CSS Custom Highlight API where available, otherwise fixed overlay rectangles. */
function usePaintedRange(range: Range | null): DOMRect[] {
  const [rects, setRects] = useState<DOMRect[]>([]);
  useEffect(() => {
    if (!range) {
      setRects([]);
      return;
    }
    if (supportsHighlights()) {
      CSS.highlights.set('vb-branch', new Highlight(range));
      return () => {
        CSS.highlights.delete('vb-branch');
      };
    }
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setRects([...range.getClientRects()]));
    };
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [range]);
  return rects;
}

function ToolbarButton({ onClick, children, label }: { onClick: () => void; children: ReactNode; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-fg transition-colors hover:bg-hover"
    >
      {children}
    </button>
  );
}

function SelectionToolbar({ sel, onBranch, onCopy, copied }: { sel: AnswerSelection; onBranch: () => void; onCopy: () => void; copied: boolean }) {
  const { ref, style } = usePlacement(() => rectToBox(sel.range.getBoundingClientRect()), 'top', 8);
  return createPortal(
    <div
      ref={ref}
      role="toolbar"
      aria-label="Selected text actions"
      style={style}
      // Pressing a toolbar button must not collapse the text selection.
      onMouseDown={(e) => e.preventDefault()}
      className="anim-pop z-[65] flex items-center gap-0.5 rounded-lg border border-line bg-elevated p-0.5 shadow-lg"
    >
      <ToolbarButton label={`Branch from selected text (${formatShortcut('Alt+B')})`} onClick={onBranch}>
        <GitBranch size={14} aria-hidden className="text-accent" />
        Branch
      </ToolbarButton>
      <span aria-hidden className="h-4 w-px bg-line" />
      <ToolbarButton label="Copy selected text" onClick={onCopy}>
        {copied ? <Check size={14} aria-hidden className="text-ok" /> : <Copy size={14} aria-hidden className="text-muted" />}
        {copied ? 'Copied' : 'Copy'}
      </ToolbarButton>
    </div>,
    document.body,
  );
}

interface Props {
  node: GraphNode;
  automation: boolean;
  children: ReactNode;
}

/**
 * Highlight-to-branch. Select text inside an answer: a small toolbar appears (Branch / Copy).
 * Branch turns into an inline question popover anchored to the selection while the passage stays highlighted.
 * Ignores selections outside answers, hides on scroll or when the selection collapses, and never blocks copying.
 */
export function HighlightBranch({ node, automation, children }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<AnswerSelection | null>(null);
  const [composing, setComposing] = useState<AnswerSelection | null>(null);
  const [copied, setCopied] = useState(false);
  const pointerDown = useRef(false);
  const composingRef = useRef(false);
  composingRef.current = composing !== null;

  const evaluate = useCallback(() => {
    if (composingRef.current || !box.current) return;
    setSel(readAnswerSelection(box.current));
  }, []);

  useEffect(() => {
    let timer = 0;
    const onChange = () => {
      if (composingRef.current) return;
      // While dragging, wait for pointer-up; keyboard selections settle after a short pause.
      window.clearTimeout(timer);
      const s = window.getSelection();
      if (!s || s.isCollapsed) {
        setSel(null);
        return;
      }
      if (!pointerDown.current) timer = window.setTimeout(evaluate, 160);
    };
    const onDown = (e: PointerEvent) => {
      pointerDown.current = true;
      // A fresh press anywhere but the toolbar starts a new selection.
      if (!(e.target as Element | null)?.closest('[role="toolbar"]')) setSel(null);
    };
    const onUp = () => {
      pointerDown.current = false;
      window.setTimeout(evaluate, 0);
    };
    const onScroll = (e: Event) => {
      if (composingRef.current) return;
      // Ignore scrolls inside the popover/toolbar themselves.
      if ((e.target as Element | null)?.closest?.('[role="toolbar"]')) return;
      setSel(null);
    };
    document.addEventListener('selectionchange', onChange);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('selectionchange', onChange);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [evaluate]);

  // Alt+B branches from the current selection (keyboard path to the toolbar action).
  useEffect(() => {
    if (!sel || composing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setComposing(sel);
        setSel(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel, composing]);

  const rects = usePaintedRange(composing?.range ?? null);

  const close = useCallback(() => {
    setComposing(null);
    setSel(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  const startBranch = () => {
    if (!sel) return;
    setComposing(sel);
    setSel(null);
  };

  return (
    <div ref={box}>
      {children}
      {sel && !composing && (
        <SelectionToolbar
          sel={sel}
          onBranch={startBranch}
          copied={copied}
          onCopy={async () => {
            if (await copyText(sel.text)) {
              setCopied(true);
              window.setTimeout(() => {
                setCopied(false);
                setSel(null);
              }, 700);
            } else toast.error('Copy failed. Use Ctrl+C on the selection instead.');
          }}
        />
      )}
      {composing && (
        <>
          {rects.map((r, i) => (
            <div key={i} className="vb-branch-rect" style={{ left: r.left, top: r.top, width: r.width, height: r.height }} />
          ))}
          <BranchPopover
            getBox={() => rectToBox(composing.range.getBoundingClientRect())}
            passage={composing.text}
            heading="Branch from selection"
            automation={automation}
            placement="bottom-start"
            onCancel={close}
            onSubmit={async (question, send) => {
              const child = await createBranch({ parent: node, question, passage: composing.text, messageId: composing.messageId, send });
              if (child) {
                close();
                if (!send) useUiStore.getState().requestComposerFocus();
              }
            }}
          />
        </>
      )}
    </div>
  );
}
