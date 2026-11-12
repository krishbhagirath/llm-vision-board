import { useEffect, useRef } from 'react';
import { updateWorkspace } from '@/features/workspaces/workspaceOps';
import { useUiStore } from '@/state/uiStore';
import { db } from '@/storage/db';
import type { GraphNode, Workspace } from '@/types';

/**
 * Keeps the ephemeral selection (zustand) and workspace.selectedNodeId (IndexedDB) in agreement,
 * so the board and the side panel select the same node. Selection in the store is applied immediately;
 * persisting is a write-through, and external changes (e.g. side panel) flow back in.
 */
export function useSelectionSync(workspace: Workspace | undefined, nodes: GraphNode[]): void {
  const wsId = workspace?.id;
  const wsSel = workspace?.selectedNodeId ?? null;
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const wsSelRef = useRef(wsSel);
  wsSelRef.current = wsSel;
  const selectedNodeId = useUiStore((s) => s.selectedNodeId);

  // Workspace switched: adopt its stored selection.
  useEffect(() => {
    if (wsId) useUiStore.getState().selectNode(wsSelRef.current);
  }, [wsId]);

  // Stored selection changed elsewhere: follow it.
  useEffect(() => {
    if (wsId && useUiStore.getState().selectedNodeId !== wsSel) useUiStore.getState().selectNode(wsSel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsSel]);

  // Local selection changed: persist it.
  useEffect(() => {
    if (!wsId) return;
    const sel = useUiStore.getState().selectedNodeId;
    if (sel === wsSelRef.current) return;
    if (sel === null) {
      void updateWorkspace(wsId, { selectedNodeId: null });
      return;
    }
    // Check membership in the DB, not the (possibly not-yet-refreshed) live query: a node that was
    // just created and selected may not be in `nodes` yet, and must still be persisted.
    void db.nodes.get(sel).then((n) => {
      if (n && n.workspaceId === wsId && useUiStore.getState().selectedNodeId === sel) {
        return updateWorkspace(wsId, { selectedNodeId: sel });
      }
    });
  }, [selectedNodeId, wsId]);
}
