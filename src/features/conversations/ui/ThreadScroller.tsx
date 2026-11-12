import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown } from 'lucide-react';

const STICK_PX = 80;
const PILL_PX = 140;

/**
 * Scroll container that follows new content (streaming answers) while the reader is at the bottom,
 * and stops following as soon as they scroll up. A "Jump to latest" pill brings them back.
 */
export function ThreadScroller({ resetKey, children, className = '' }: { resetKey: string; children: ReactNode; className?: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [away, setAway] = useState(false);

  const toBottom = useCallback((smooth = false) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // New node: start at the bottom.
  useLayoutEffect(() => {
    stick.current = true;
    setAway(false);
    toBottom();
  }, [resetKey, toBottom]);

  // Content grew (tokens streamed in, markdown laid out): follow if the reader is still at the bottom.
  useEffect(() => {
    const el = inner.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (stick.current) toBottom();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [toBottom]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        className={`min-h-0 flex-1 overflow-y-auto ${className}`}
        onScroll={(e) => {
          const el = e.currentTarget;
          const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
          stick.current = dist < STICK_PX;
          setAway(dist > PILL_PX);
        }}
      >
        <div ref={inner}>{children}</div>
      </div>
      {away && (
        <button
          type="button"
          onClick={() => {
            stick.current = true;
            toBottom(true);
          }}
          className="anim-pop absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-elevated px-3 py-1.5 text-xs font-medium text-fg shadow-md transition-colors hover:bg-hover"
        >
          <ArrowDown size={13} aria-hidden />
          Jump to latest
        </button>
      )}
    </div>
  );
}
