import { useRef, type ReactNode } from 'react';
import { Tooltip } from './Tooltip';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  /** e.g. "Alt+1" shown in the tooltip. */
  shortcut?: string;
  /** Hide the visible text label (icon-only) but keep it as accessible name + tooltip. */
  hideLabel?: boolean;
}

interface Props<T extends string> {
  value: T;
  options: SegmentOption<T>[];
  onChange: (v: T) => void;
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}

/** Single-choice control with radiogroup semantics and arrow-key roving focus. */
export function SegmentedControl<T extends string>({ value, options, onChange, label, size = 'md', className = '' }: Props<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const n = (i + dir + options.length) % options.length;
    refs.current[n]?.focus();
    onChange(options[n]!.value);
  };
  return (
    <div role="radiogroup" aria-label={label} className={`inline-flex rounded-lg border border-line bg-subtle p-0.5 ${className}`}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <Tooltip key={o.value} content={o.label} shortcut={o.shortcut} disabled={!o.hideLabel && !o.shortcut}>
            <button
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={o.label}
              tabIndex={on ? 0 : -1}
              onClick={() => onChange(o.value)}
              onKeyDown={(e) => onKey(e, i)}
              className={`inline-flex items-center gap-1.5 rounded-md font-medium transition-colors duration-[var(--dur-fast)] ${
                size === 'sm' ? 'h-6 px-2 text-xs' : 'h-7 px-2.5 text-xs'
              } ${on ? 'bg-card text-fg shadow-sm' : 'text-muted hover:text-fg'}`}
            >
              {o.icon && <span className="flex [&>svg]:h-3.5 [&>svg]:w-3.5">{o.icon}</span>}
              {!o.hideLabel && <span>{o.label}</span>}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
