import { afterEach, describe, expect, it, vi } from 'vitest';
import { addToast, toast, useToastStore } from '@/components/toastStore';

afterEach(() => {
  for (const t of useToastStore.getState().items) useToastStore.getState().dismiss(t.id);
});

describe('toast actions', () => {
  it('stores the action on the item and never merges action toasts', () => {
    const action = { label: 'Undo', onClick: vi.fn() };
    const a = addToast([], 'success', 'Deleted 3 nodes', 1, action);
    const b = addToast(a.items, 'success', 'Deleted 3 nodes', 2, action);
    expect(b.items).toHaveLength(2);
    expect(b.items[0]!.action).toBe(action);
    expect(b.items[1]!.count).toBe(1);
  });

  it('does not merge a plain toast into an action toast with the same text', () => {
    const a = addToast([], 'success', 'Same', 1, { label: 'Undo', onClick: () => undefined });
    const b = addToast(a.items, 'success', 'Same', 2);
    expect(b.items).toHaveLength(2);
    expect(b.items[1]!.action).toBeUndefined();
  });

  it('still merges identical plain toasts', () => {
    const a = addToast([], 'info', 'Hi', 1);
    expect(addToast(a.items, 'info', 'Hi', 2).items[0]!.count).toBe(2);
  });

  it('toast.success passes the action through the store', () => {
    const onClick = vi.fn();
    toast.success('Deleted', { label: 'Undo', onClick });
    const item = useToastStore.getState().items.find((t) => t.message === 'Deleted');
    expect(item?.action?.label).toBe('Undo');
    void item?.action?.onClick();
    expect(onClick).toHaveBeenCalledOnce();
  });
});
