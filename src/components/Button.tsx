import { forwardRef, type ButtonHTMLAttributes, type ComponentProps, type InputHTMLAttributes, type ReactNode } from 'react';
import { Tooltip } from './Tooltip';
import type { Placement } from './floating';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-[background-color,color,box-shadow,opacity] duration-[var(--dur-fast)] disabled:opacity-50 whitespace-nowrap select-none';
const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg shadow-sm hover:bg-accent-hover',
  secondary: 'border border-line-strong bg-card text-fg shadow-sm hover:bg-hover',
  ghost: 'text-muted hover:bg-hover hover:text-fg',
  danger: 'bg-danger text-white shadow-sm hover:opacity-90',
};
const sizes: Record<Size, string> = { sm: 'h-7 px-2.5 text-xs', md: 'h-8 px-3 text-ui', lg: 'h-10 px-4 text-sm' };

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Shows a spinner and disables the button. */
  loading?: boolean;
}

export function Button({ variant = 'secondary', size = 'md', loading, disabled, className = '', type = 'button', children, ...rest }: ButtonProps) {
  return (
    <button type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...rest}>
      {loading && <Spinner />}
      {children}
    </button>
  );
}

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /** Required: accessible name, also shown as the tooltip. */
  'aria-label': string;
  /** Keyboard shortcut hint shown in the tooltip, e.g. "Mod+K". */
  shortcut?: string;
  /** Override tooltip text, or false to disable it. */
  tooltip?: string | false;
  tooltipSide?: Placement;
  size?: 'sm' | 'md';
  /** Toggled-on look (also sets aria-pressed when defined). */
  active?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className = '', type = 'button', shortcut, tooltip, tooltipSide, size = 'md', active, title: _title, children, ...rest },
  ref,
) {
  const btn = (
    <button
      ref={ref}
      type={type}
      aria-pressed={active}
      className={`inline-flex shrink-0 items-center justify-center rounded-md transition-colors duration-[var(--dur-fast)] disabled:opacity-40 ${
        size === 'sm' ? 'h-6 w-6' : 'h-8 w-8'
      } ${active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-hover hover:text-fg'} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
  if (tooltip === false) return btn;
  return (
    <Tooltip content={tooltip ?? rest['aria-label']} shortcut={shortcut} side={tooltipSide}>
      {btn}
    </Tooltip>
  );
});

const fieldCls =
  'w-full rounded-md border border-line-strong bg-card px-3 py-1.5 text-sm text-fg placeholder:text-faint transition-shadow focus:border-accent focus:outline-none focus:ring-2 focus:ring-[var(--ring)]';

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput({ className = '', ...rest }, ref) {
  return <input ref={ref} className={`${fieldCls} ${className}`} {...rest} />;
});

export function TextArea({ className = '', ...rest }: ComponentProps<'textarea'>) {
  return <textarea className={`${fieldCls} resize-y ${className}`} {...rest} />;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="block text-xs text-faint">{hint}</span>}
    </label>
  );
}

export function Spinner({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg className={`spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-line-strong'}`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`}
      />
    </button>
  );
}
