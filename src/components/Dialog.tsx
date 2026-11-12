import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { trapTab } from './floating';
import { IconButton } from './Button';

interface DialogProps {
  open?: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Tailwind max-width class. */
  width?: string;
  /** Optional line under the title. */
  description?: string;
}

/** Modal dialog: labelled, focus-trapped, Esc closes, focus returns to the opener. */
export function Dialog({ open = true, title, onClose, children, footer, width = 'max-w-lg', description }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('[data-autofocus], textarea, input, select');
    (first ?? el)?.focus();
    return () => prev?.focus?.();
  }, [open]);
  if (!open) return null;
  return (
    <div
      className="anim-fade fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-4 pt-[10vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
        trapTab(e, ref.current);
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={`anim-pop w-full ${width} rounded-xl border border-line bg-elevated shadow-lg outline-none`}
      >
        <div className="flex items-start justify-between gap-3 px-5 pb-1 pt-4">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-base font-semibold">
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-0.5 text-xs text-muted">
                {description}
              </p>
            )}
          </div>
          <IconButton aria-label="Close dialog" size="sm" onClick={onClose} className="-mr-1.5 mt-0.5">
            <X size={16} />
          </IconButton>
        </div>
        <div className="space-y-4 px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}
