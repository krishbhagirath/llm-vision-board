import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useToastStore } from './toastStore';

const tone = {
  success: { icon: CheckCircle2, cls: 'text-ok' },
  error: { icon: AlertCircle, cls: 'text-danger' },
  info: { icon: Info, cls: 'text-accent' },
} as const;

export function Toaster() {
  const items = useToastStore((s) => s.items);
  const dismiss = useToastStore((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[90] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4" aria-live="polite">
      {items.map((t) => {
        const T = tone[t.kind];
        return (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className="anim-pop pointer-events-auto flex items-start gap-2.5 rounded-lg border border-line bg-elevated px-3 py-2.5 text-ui shadow-lg"
          >
            <T.icon size={16} className={`mt-0.5 shrink-0 ${T.cls}`} aria-hidden />
            <span className="min-w-0 flex-1 break-words">{t.message}</span>
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  dismiss(t.id);
                  void t.action?.onClick();
                }}
                className="mt-px shrink-0 rounded px-1.5 text-ui font-semibold text-accent hover:bg-accent-soft"
              >
                {t.action.label}
              </button>
            )}
            {t.count > 1 && <span className="mt-0.5 rounded-full bg-subtle px-1.5 text-[11px] font-medium tabular-nums text-muted">×{t.count}</span>}
            <button onClick={() => dismiss(t.id)} className="mt-0.5 rounded text-muted hover:text-fg" aria-label="Dismiss notification">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
