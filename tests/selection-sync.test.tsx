import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSelectionSync } from '@/hooks/useSelectionSync';
import { useUiStore } from '@/state/uiStore';
import { db } from '@/storage/db';
import { createWorkspace } from '@/features/workspaces/workspaceOps';
import { createNode } from '@/features/graph/graphOps';

describe('useSelectionSync (board ↔ side panel)', () => {
  it('persists a freshly created node selected before the live node list refreshed', async () => {
    const ws = await createWorkspace('Sync');
    const { rerender } = renderHook(({ w, nodes }) => useSelectionSync(w, nodes), { initialProps: { w: ws, nodes: [] as never[] } });
    const node = await createNode({ workspaceId: ws.id, question: 'New?' });
    // The board selects the node immediately; `nodes` (from useLiveQuery) is still stale/empty.
    act(() => useUiStore.getState().selectNode(node.id));
    rerender({ w: ws, nodes: [] });
    await vi.waitFor(async () => expect((await db.workspaces.get(ws.id))!.selectedNodeId).toBe(node.id));
  });

  it('does not persist a selection that belongs to another workspace', async () => {
    const a = await createWorkspace('A');
    const b = await createWorkspace('B');
    const foreign = await createNode({ workspaceId: b.id, question: 'Other' });
    renderHook(() => useSelectionSync(a, []));
    act(() => useUiStore.getState().selectNode(foreign.id));
    await new Promise((r) => setTimeout(r, 50));
    expect((await db.workspaces.get(a.id))!.selectedNodeId).toBeNull();
  });
});
