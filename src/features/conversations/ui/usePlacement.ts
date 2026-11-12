import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { computePosition, type Box, type Placement } from '@/components/floating';

/**
 * Places a `position: fixed` element next to a (possibly moving) box, e.g. a text selection's bounding rect.
 * `getBox` is read on every update (mount, scroll, resize), so it may return fresh geometry each time.
 */
export function usePlacement(getBox: () => Box | null, placement: Placement, gap = 8) {
  const elRef = useRef<HTMLElement | null>(null);
  const boxRef = useRef(getBox);
  boxRef.current = getBox;
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const raf = useRef(0);

  const update = useCallback(() => {
    const el = elRef.current;
    const box = boxRef.current();
    if (!el || !box) return;
    const p = computePosition(box, { width: el.offsetWidth, height: el.offsetHeight }, placement, { width: window.innerWidth, height: window.innerHeight }, gap);
    setPos((prev) => (prev && prev.x === p.x && prev.y === p.y ? prev : { x: p.x, y: p.y }));
  }, [placement, gap]);

  const ref = useCallback(
    (el: HTMLElement | null) => {
      elRef.current = el;
      if (el) update();
    },
    [update],
  );

  useLayoutEffect(() => {
    update();
  });

  useEffect(() => {
    const schedule = () => {
      cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(update);
    };
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    return () => {
      cancelAnimationFrame(raf.current);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
    };
  }, [update]);

  const style: CSSProperties = pos ? { position: 'fixed', left: pos.x, top: pos.y } : { position: 'fixed', left: 0, top: 0, visibility: 'hidden' };
  return { ref, style };
}

export function rectToBox(r: DOMRect): Box {
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}
