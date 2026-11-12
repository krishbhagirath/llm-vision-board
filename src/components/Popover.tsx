import { useCallback, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { trapTab, useFloating, type Placement } from './floating';

interface PopoverProps {
  /** The trigger element (a button). Wrapped so clicks toggle the popover. */
  trigger: ReactElement<Record<string, unknown>>;
  /** Accessible name of the popover panel. */
  label: string;
  placement?: Placement;
  children: ReactNode | ((close: () => void) => ReactNode);
  className?: string;
}

/** Click-to-open floating panel. Esc / outside click closes and focus returns to the trigger. */
export function Popover({ trigger, label, placement = 'bottom-end', children, className = '' }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const panel = useRef<HTMLElement | null>(null);
  const id = useId();
  const { ref, style } = useFloating(open, anchor, placement, 8);
  const close = useCallback(() => {
    setOpen(false);
    anchor?.querySelector<HTMLElement>('button, [tabindex]')?.focus();
  }, [anchor]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchor?.contains(t) || panel.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    const t = window.setTimeout(() => panel.current?.focus(), 0);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.clearTimeout(t);
    };
  }, [open, anchor]);

  return (
    <>
      <span
        ref={setAnchor}
        className="inline-flex"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        data-popover-open={open || undefined}
      >
        {trigger}
      </span>
      {open &&
        createPortal(
          <div
            ref={(el) => {
              panel.current = el;
              ref(el);
            }}
            id={id}
            role="dialog"
            aria-label={label}
            tabIndex={-1}
            style={style}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                close();
              }
              trapTab(e, panel.current);
            }}
            className={`anim-pop z-[70] max-w-[calc(100vw-16px)] rounded-lg border border-line bg-elevated p-3 text-sm shadow-lg outline-none ${className}`}
          >
            {typeof children === 'function' ? children(close) : children}
          </div>,
          document.body,
        )}
    </>
  );
}
