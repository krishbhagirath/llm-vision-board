import { create } from 'zustand';

export interface ToastItem {
  id: number;
  kind: 'success' | 'error' | 'info';
  message: string;
  /** How many identical pushes were merged into this toast. */
  count: number;
  /** Optional inline action (e.g. Undo). Toasts with an action are never merged with others. */
  action?: ToastAction;
}

export interface ToastAction {
  label: string;
  onClick: () => void | Promise<void>;
}

export const MAX_TOASTS = 3;

/**
 * Pure: add a toast. An identical (kind + message) toast is refreshed (count++, moved to the end) instead of duplicated;
 * the list is capped at MAX_TOASTS (oldest dropped). Returns the new list and the id that was added/refreshed.
 */
export function addToast(
  items: readonly ToastItem[],
  kind: ToastItem['kind'],
  message: string,
  nextId: number,
  action?: ToastAction,
): { items: ToastItem[]; id: number; dropped: number[] } {
  const existing = action ? undefined : items.find((t) => t.kind === kind && !t.action && t.message === message);
  let list: ToastItem[];
  let id: number;
  if (existing) {
    id = existing.id;
    list = [...items.filter((t) => t.id !== id), { ...existing, count: existing.count + 1 }];
  } else {
    id = nextId;
    list = [...items, action ? { id, kind, message, count: 1, action } : { id, kind, message, count: 1 }];
  }
  const dropped = list.slice(0, Math.max(0, list.length - MAX_TOASTS)).map((t) => t.id);
  return { items: list.slice(-MAX_TOASTS), id, dropped };
}

interface ToastState {
  items: ToastItem[];
  push: (kind: ToastItem['kind'], message: string, action?: ToastAction) => void;
  dismiss: (id: number) => void;
}

let seq = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

export const useToastStore = create<ToastState>((set, get) => ({
  items: [],
  push: (kind, message, action) => {
    const r = addToast(get().items, kind, message, seq++, action);
    for (const d of r.dropped) {
      clearTimeout(timers.get(d));
      timers.delete(d);
    }
    set({ items: r.items });
    // (Re)start the dismiss timer so a repeated message stays visible.
    clearTimeout(timers.get(r.id));
    timers.set(
      r.id,
      setTimeout(() => get().dismiss(r.id), kind === 'error' ? 7000 : action ? 9000 : 3500),
    );
  },
  dismiss: (id) => {
    clearTimeout(timers.get(id));
    timers.delete(id);
    set((s) => ({ items: s.items.filter((t) => t.id !== id) }));
  },
}));

export const toast = {
  success: (m: string, action?: ToastAction) => useToastStore.getState().push('success', m, action),
  error: (m: string) => useToastStore.getState().push('error', m),
  info: (m: string, action?: ToastAction) => useToastStore.getState().push('info', m, action),
};

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Run an async action; surface failures as a toast. Returns undefined on failure. */
export async function attempt<T>(fn: () => Promise<T>, successMsg?: string): Promise<T | undefined> {
  try {
    const r = await fn();
    if (successMsg) toast.success(successMsg);
    return r;
  } catch (e) {
    toast.error(errMsg(e));
    return undefined;
  }
}
