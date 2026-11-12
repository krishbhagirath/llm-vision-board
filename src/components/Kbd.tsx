import type { ReactNode } from 'react';

export function Kbd({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'inverse' }) {
  return (
    <kbd
      className={`inline-flex min-w-5 items-center justify-center rounded border px-1 font-sans text-[11px] font-medium leading-4 ${
        tone === 'inverse' ? 'border-app/30 text-app/80' : 'border-line-strong bg-subtle text-muted'
      }`}
    >
      {children}
    </kbd>
  );
}
