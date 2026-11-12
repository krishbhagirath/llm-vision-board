import { useCallback, type ReactNode } from 'react';
import { PANEL_MAX, PANEL_MIN, useUiStore } from '@/state/uiStore';
import { useEscape, useViewportWidth } from '@/hooks/useViewport';
import { ErrorBoundary } from './ErrorBoundary';

export const DRAWER_BREAKPOINT = 900;

/**
 * Right-docked panel with a draggable left edge (width persisted via the store).
 * Below DRAWER_BREAKPOINT it becomes an overlay drawer with a backdrop.
 */
export function ResizablePanel({ children }: { children: ReactNode }) {
  const width = useUiStore((s) => s.panelWidth);
  const setWidth = useUiStore((s) => s.setPanelWidth);
  const setCollapsed = useUiStore((s) => s.setPanelCollapsed);
  const vw = useViewportWidth();
  const drawer = vw < DRAWER_BREAKPOINT;
  useEscape(drawer, () => setCollapsed(true));

  const onDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = useUiStore.getState().panelWidth;
      const move = (ev: PointerEvent) => setWidth(Math.min(PANEL_MAX, Math.max(PANEL_MIN, startW + (startX - ev.clientX))));
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        document.body.style.userSelect = '';
      };
      document.body.style.userSelect = 'none';
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [setWidth],
  );

  const onKeyResize = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') (e.preventDefault(), setWidth(width + 24));
    else if (e.key === 'ArrowRight') (e.preventDefault(), setWidth(width - 24));
  };

  if (drawer) {
    return (
      <div
        className="fixed inset-0 z-40 flex justify-end bg-black/35"
        onMouseDown={(e) => e.target === e.currentTarget && setCollapsed(true)}
      >
        <aside
          aria-label="Conversation"
          className="anim-slide-r relative flex h-full w-[min(92vw,480px)] flex-col border-l border-line bg-surface shadow-lg"
        >
          <ErrorBoundary region="conversation panel">{children}</ErrorBoundary>
        </aside>
      </div>
    );
  }

  return (
    <aside aria-label="Conversation" style={{ width }} className="relative flex h-full shrink-0 flex-col border-l border-line bg-surface">
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize conversation panel"
        aria-valuenow={width}
        aria-valuemin={PANEL_MIN}
        aria-valuemax={PANEL_MAX}
        tabIndex={0}
        onPointerDown={onDown}
        onKeyDown={onKeyResize}
        onDoubleClick={() => setWidth(460)}
        className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize transition-colors hover:bg-accent/30 focus-visible:bg-accent/40"
      />
      <ErrorBoundary region="conversation panel">{children}</ErrorBoundary>
    </aside>
  );
}
