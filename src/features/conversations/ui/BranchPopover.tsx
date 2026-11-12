import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CornerDownLeft, GitBranch } from 'lucide-react';
import { Button, Spinner } from '@/components/Button';
import { trapTab, type Box, type Placement } from '@/components/floating';
import { readBranchAutoSend, writeBranchAutoSend } from './sendActions';
import { usePlacement } from './usePlacement';

interface Props {
  /** Geometry of the thing the popover hangs off (read again on scroll/resize). */
  getBox: () => Box | null;
  /** Quoted passage; null for a whole-answer branch. */
  passage: string | null;
  /** Shown above the input, e.g. "Branch from this answer". */
  heading: string;
  /** Only in automation mode is "send right away" meaningful. */
  automation: boolean;
  placement?: Placement;
  onSubmit: (question: string, send: boolean) => Promise<void>;
  onCancel: () => void;
}

/** Inline question box for a new branch. Enter creates it, Esc cancels. No modal, no backdrop. */
export function BranchPopover({ getBox, passage, heading, automation, placement = 'bottom-start', onSubmit, onCancel }: Props) {
  const [question, setQuestion] = useState('');
  const [send, setSend] = useState(() => readBranchAutoSend());
  const [busy, setBusy] = useState(false);
  const panel = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLTextAreaElement | null>(null);
  const { ref, style } = usePlacement(getBox, placement, 10);

  // Focus once the popover has been positioned (a visibility:hidden element cannot take focus).
  const placed = style.visibility !== 'hidden';
  useEffect(() => {
    if (placed) input.current?.focus({ preventScroll: true });
  }, [placed]);

  // Clicking elsewhere dismisses an empty popover; one with typed text stays so nothing is lost by accident.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (panel.current?.contains(e.target as Node)) return;
      if (!input.current?.value.trim()) onCancel();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onCancel]);

  // Auto-grow the textarea up to ~5 lines.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [question]);

  const submit = async () => {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    try {
      await onSubmit(q, automation && send);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      ref={(el) => {
        panel.current = el;
        ref(el);
      }}
      role="dialog"
      aria-label={heading}
      style={{ ...style, width: 'min(360px, calc(100vw - 16px))' }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onCancel();
        }
        trapTab(e, panel.current);
      }}
      className="anim-pop z-[70] rounded-xl border border-line bg-elevated p-3 shadow-lg"
    >
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted">
        <GitBranch size={13} aria-hidden className="text-accent" />
        {heading}
      </div>
      {passage && (
        <blockquote className="mb-2.5 max-h-20 overflow-hidden rounded-md border-l-[3px] border-accent bg-accent-soft/60 px-2.5 py-1.5 text-xs leading-5 text-fg [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3]">
          {passage}
        </blockquote>
      )}
      <textarea
        ref={input}
        rows={1}
        value={question}
        aria-label="Your question"
        placeholder={passage ? 'Ask about this passage…' : 'Ask a follow-up as a new branch…'}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void submit();
          }
        }}
        className="block w-full resize-none rounded-md border border-line-strong bg-card px-2.5 py-1.5 text-ui text-fg placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
      />
      <div className="mt-2.5 flex items-center gap-2">
        {automation ? (
          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-xs text-muted">
            <input
              type="checkbox"
              checked={send}
              onChange={(e) => {
                setSend(e.target.checked);
                writeBranchAutoSend(e.target.checked);
              }}
              className="h-3.5 w-3.5 accent-[var(--accent)]"
            />
            <span className="truncate">Send to ChatGPT right away</span>
          </label>
        ) : (
          <span className="min-w-0 flex-1 truncate text-xs text-faint">Creates the branch; you send it from there.</span>
        )}
        <Button size="sm" variant="primary" disabled={!question.trim() || busy} onClick={() => void submit()}>
          {busy ? <Spinner /> : <CornerDownLeft size={13} aria-hidden />}
          Create branch
        </Button>
      </div>
    </div>,
    document.body,
  );
}
