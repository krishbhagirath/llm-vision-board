import type { ReactNode } from 'react';

interface Props {
  icon?: ReactNode;
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, children, className = '' }: Props) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 p-8 text-center ${className}`}>
      {icon && <div className="flex h-10 w-10 items-center justify-center rounded-full bg-subtle text-muted [&>svg]:h-5 [&>svg]:w-5">{icon}</div>}
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        {description && <p className="mx-auto max-w-xs text-ui text-muted">{description}</p>}
      </div>
      {children}
    </div>
  );
}
