import type { ID } from '@/types';

/** Node navigation history (browser-style back/forward). Pure helpers; state lives in uiStore. */
export interface NavHistory {
  entries: ID[];
  /** Index of the current entry, or -1 when empty. */
  index: number;
}

export const NAV_HISTORY_CAP = 50;
export const EMPTY_HISTORY: NavHistory = { entries: [], index: -1 };

/** Record a newly selected node. Drops forward entries, ignores duplicates of the current entry, caps the length. */
export function pushHistory(h: NavHistory, id: ID): NavHistory {
  if (h.entries[h.index] === id) return h;
  const kept = h.entries.slice(0, h.index + 1);
  kept.push(id);
  const trimmed = kept.length > NAV_HISTORY_CAP ? kept.slice(kept.length - NAV_HISTORY_CAP) : kept;
  return { entries: trimmed, index: trimmed.length - 1 };
}

export function canGoBack(h: NavHistory): boolean {
  return h.index > 0;
}
export function canGoForward(h: NavHistory): boolean {
  return h.index >= 0 && h.index < h.entries.length - 1;
}

/**
 * Move through history, skipping entries for which `exists` is false (deleted nodes).
 * Returns the new history and the node to select, or null if there is nowhere to go.
 */
export function stepHistory(h: NavHistory, dir: -1 | 1, exists: (id: ID) => boolean = () => true): { history: NavHistory; id: ID } | null {
  let i = h.index + dir;
  while (i >= 0 && i < h.entries.length) {
    const id = h.entries[i]!;
    if (exists(id)) return { history: { entries: h.entries, index: i }, id };
    i += dir;
  }
  return null;
}
