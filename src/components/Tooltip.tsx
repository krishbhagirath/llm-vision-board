import { cloneElement, useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { formatShortcut, useFloating, type Placement } from './floating';
import { Kbd } from './Kbd';

interface TooltipProps {
  content: string;
  /** e.g. "Mod+K" (Mod renders as Ctrl / ⌘). */
  shortcut?: string;
  side?: Placement;
  /** ms before showing on hover. Keyboard focus shows immediately. */
  delay?: number;
  disabled?: boolean;
  children: ReactElement<Record<string, unknown>>;
}

/** Hover + keyboard-focus tooltip. The child must be a single focusable element. */
export function Tooltip({ content, shortcut, side = 'top', delay = 450, disabled, children }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const id = useId();
  const { ref, style } = useFloating(open, anchor, side, 8);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const show = (immediate: boolean) => {
    window.clearTimeout(timer.current);
    if (disabled) return;
    if (immediate) setOpen(true);
    else timer.current = window.setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
  };

  return (
    <span
      ref={setAnchor}
      className="inline-flex"
      onMouseEnter={() => show(false)}
      onMouseLeave={hide}
      onFocus={() => show(true)}
      onBlur={hide}
      onKeyDown={(e) => e.key === 'Escape' && hide()}
      onMouseDown={hide}
    >
      {cloneElement(children, open ? { 'aria-describedby': id } : {})}
      {open &&
        createPortal(
          <div
            ref={ref}
            id={id}
            role="tooltip"
            style={style}
            className="anim-fade pointer-events-none z-[80] flex max-w-64 items-center gap-2 rounded-md bg-fg px-2 py-1 text-xs font-medium text-app shadow-md"
          >
            <span>{content}</span>
            {shortcut && <Kbd tone="inverse">{formatShortcut(shortcut)}</Kbd>}
          </div>,
          document.body,
        )}
    </span>
  );
}
