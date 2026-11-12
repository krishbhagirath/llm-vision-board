import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { formatShortcut, useFloating, type Anchor, type Placement } from './floating';
import { Tooltip } from './Tooltip';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  icon?: ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  hidden?: boolean;
  /** Draw a divider above this item. */
  separatorBefore?: boolean;
}

interface MenuPanelProps {
  anchor: Anchor;
  items: MenuItem[];
  label: string;
  placement?: Placement;
  onClose: (opts?: { restoreFocus?: boolean }) => void;
}

/** The floating list. Arrow keys / Home / End navigate, Enter selects, Esc closes, Tab closes. */
export function MenuPanel({ anchor, items, label, placement = 'bottom-end', onClose }: MenuPanelProps) {
  const { ref, style } = useFloating(true, anchor, placement, 4);
  const panel = useRef<HTMLDivElement | null>(null);
  const visible = items.filter((i) => !i.hidden);

  useEffect(() => {
    const first = panel.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])');
    first?.focus();
    const onDown = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node)) onClose({ restoreFocus: false });
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const move = (dir: 1 | -1 | 'first' | 'last') => {
    const els = [...(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
    if (!els.length) return;
    const i = els.indexOf(document.activeElement as HTMLElement);
    const next = dir === 'first' ? 0 : dir === 'last' ? els.length - 1 : (i + dir + els.length) % els.length;
    els[next]?.focus();
  };

  return createPortal(
    <div
      ref={(el) => {
        panel.current = el;
        ref(el);
      }}
      role="menu"
      aria-label={label}
      style={style}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') (e.preventDefault(), move(1));
        else if (e.key === 'ArrowUp') (e.preventDefault(), move(-1));
        else if (e.key === 'Home') (e.preventDefault(), move('first'));
        else if (e.key === 'End') (e.preventDefault(), move('last'));
        else if (e.key === 'Escape') (e.stopPropagation(), e.preventDefault(), onClose({ restoreFocus: true }));
        else if (e.key === 'Tab') (e.preventDefault(), onClose({ restoreFocus: true }));
      }}
      className="anim-pop z-[75] min-w-52 max-w-[calc(100vw-16px)] rounded-lg border border-line bg-elevated p-1 shadow-lg"
    >
      {visible.map((i) => (
        <div key={i.label}>
          {i.separatorBefore && <div role="separator" className="my-1 h-px bg-line" />}
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            disabled={i.disabled}
            onClick={() => {
              onClose({ restoreFocus: true });
              i.onSelect();
            }}
            className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-ui outline-none transition-colors focus:bg-hover disabled:opacity-40 ${
              i.danger ? 'text-danger' : 'text-fg'
            }`}
          >
            {i.icon && <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted [&>svg]:h-4 [&>svg]:w-4">{i.icon}</span>}
            <span className="flex-1 truncate">{i.label}</span>
            {i.shortcut && <span className="text-xs text-faint">{formatShortcut(i.shortcut)}</span>}
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}

interface MenuProps {
  trigger: ReactNode;
  items: MenuItem[];
  align?: 'left' | 'right';
  direction?: 'down' | 'up';
  /** Accessible name of the trigger button (and the menu). */
  label: string;
  /** Extra classes for the trigger button. */
  triggerClassName?: string;
}

export function Menu({ trigger, items, align = 'right', direction = 'down', label, triggerClassName = '' }: MenuProps) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const placement: Placement = `${direction === 'down' ? 'bottom' : 'top'}-${align === 'right' ? 'end' : 'start'}`;
  return (
    <>
      <Tooltip content={label} disabled={open}>
        <button
          ref={btn}
          type="button"
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && !open) {
              e.preventDefault();
              setOpen(true);
            }
          }}
          className={`inline-flex h-8 min-w-8 items-center justify-center rounded-md px-1 text-muted transition-colors hover:bg-hover hover:text-fg aria-expanded:bg-hover aria-expanded:text-fg ${triggerClassName}`}
        >
          {trigger}
        </button>
      </Tooltip>
      {open && (
        <MenuPanel
          anchor={btn.current}
          items={items}
          label={label}
          placement={placement}
          onClose={(o) => {
            setOpen(false);
            if (o?.restoreFocus !== false) btn.current?.focus();
          }}
        />
      )}
    </>
  );
}

/** Right-click / programmatic menu at a viewport point. */
export function ContextMenu({ point, items, label, onClose }: { point: { x: number; y: number }; items: MenuItem[]; label: string; onClose: () => void }) {
  return <MenuPanel anchor={point} items={items} label={label} placement="bottom-start" onClose={onClose} />;
}
