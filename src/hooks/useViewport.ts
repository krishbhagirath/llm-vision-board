import { useEffect, useState, useSyncExternalStore } from 'react';

/** Current window.innerWidth, updated on resize. */
export function useViewportWidth(): number {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

export function prefersReducedMotion(): boolean {
  return !!mq?.matches;
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      mq?.addEventListener('change', cb);
      return () => mq?.removeEventListener('change', cb);
    },
    () => !!mq?.matches,
    () => false,
  );
}

/** Observed content width of an element (px), or 0 before first measure. */
export function useElementWidth<T extends HTMLElement>(): [React.RefCallback<T>, number] {
  const [el, setEl] = useState<T | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, w];
}

/** While `active`, Escape calls `onEscape` (capture phase) and does not reach other Escape handlers such as deselect. */
export function useEscape(active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!active) return;
    const on = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // Let dialogs / menus / popovers above us handle their own Escape first.
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      e.stopPropagation();
      onEscape();
    };
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
  }, [active, onEscape]);
}
