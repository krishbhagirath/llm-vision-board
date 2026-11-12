import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

export type Placement =
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'bottom-start'
  | 'bottom-end'
  | 'top-start'
  | 'top-end'
  | 'right-start';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, Math.max(min, max)));

/** Pure positioning: place a floating box next to an anchor, flipping on the main axis and clamping into the viewport. */
export function computePosition(
  anchor: Box,
  size: { width: number; height: number },
  placement: Placement,
  viewport: { width: number; height: number },
  gap = 6,
  margin = 8,
): { x: number; y: number; placement: Placement } {
  const side = placement.split('-')[0] as 'top' | 'bottom' | 'left' | 'right';
  const align = placement.split('-')[1] as 'start' | 'end' | undefined;
  let s = side;
  const fitsBelow = anchor.y + anchor.height + gap + size.height <= viewport.height - margin;
  const fitsAbove = anchor.y - gap - size.height >= margin;
  const fitsRight = anchor.x + anchor.width + gap + size.width <= viewport.width - margin;
  const fitsLeft = anchor.x - gap - size.width >= margin;
  if (s === 'bottom' && !fitsBelow && fitsAbove) s = 'top';
  else if (s === 'top' && !fitsAbove && fitsBelow) s = 'bottom';
  else if (s === 'right' && !fitsRight && fitsLeft) s = 'left';
  else if (s === 'left' && !fitsLeft && fitsRight) s = 'right';

  let x: number;
  let y: number;
  if (s === 'top' || s === 'bottom') {
    y = s === 'bottom' ? anchor.y + anchor.height + gap : anchor.y - gap - size.height;
    x = align === 'start' ? anchor.x : align === 'end' ? anchor.x + anchor.width - size.width : anchor.x + anchor.width / 2 - size.width / 2;
  } else {
    x = s === 'right' ? anchor.x + anchor.width + gap : anchor.x - gap - size.width;
    y = align === 'start' ? anchor.y : align === 'end' ? anchor.y + anchor.height - size.height : anchor.y + anchor.height / 2 - size.height / 2;
  }
  return {
    x: clamp(x, margin, viewport.width - size.width - margin),
    y: clamp(y, margin, viewport.height - size.height - margin),
    placement: align ? (`${s}-${align}` as Placement) : s,
  };
}

export type Anchor = HTMLElement | { x: number; y: number } | null;

function anchorBox(anchor: Anchor): Box | null {
  if (!anchor) return null;
  if ('getBoundingClientRect' in anchor) {
    const r = anchor.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }
  return { x: anchor.x, y: anchor.y, width: 0, height: 0 };
}

/** Positions a `position: fixed` floating element relative to an anchor. Hidden until measured. */
export function useFloating(open: boolean, anchor: Anchor, placement: Placement, gap = 6) {
  const elRef = useRef<HTMLElement | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const update = useCallback(() => {
    const el = elRef.current;
    const box = anchorBox(anchor);
    if (!el || !box) return;
    const p = computePosition(box, { width: el.offsetWidth, height: el.offsetHeight }, placement, { width: window.innerWidth, height: window.innerHeight }, gap);
    setPos((prev) => (prev && prev.x === p.x && prev.y === p.y ? prev : { x: p.x, y: p.y }));
  }, [anchor, placement, gap]);

  const setRef = useCallback(
    (el: HTMLElement | null) => {
      elRef.current = el;
      if (el) update();
    },
    [update],
  );
  useLayoutEffect(() => {
    if (open) update();
    else setPos(null);
  }, [open, update]);
  useEffect(() => {
    if (!open) return;
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, update]);
  const style: CSSProperties = pos ? { position: 'fixed', left: pos.x, top: pos.y } : { position: 'fixed', left: 0, top: 0, visibility: 'hidden' };
  return { ref: setRef, style };
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute('hidden') && el.getClientRects().length > 0);
}

/** Keep Tab focus inside `root`. */
export function trapTab(e: { key: string; shiftKey: boolean; preventDefault: () => void }, root: HTMLElement | null): void {
  if (e.key !== 'Tab' || !root) return;
  const items = focusableIn(root);
  if (!items.length) {
    e.preventDefault();
    root.focus();
    return;
  }
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const active = document.activeElement;
  if (e.shiftKey && (active === first || active === root)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
/** "Ctrl+K" on Windows/Linux, "⌘K" on macOS. Input uses "Mod" for the primary modifier. */
export function formatShortcut(s: string): string {
  return isMac ? s.replace(/Mod\+?/g, '⌘').replace(/Alt\+/g, '⌥').replace(/Shift\+/g, '⇧') : s.replace(/Mod/g, 'Ctrl');
}
