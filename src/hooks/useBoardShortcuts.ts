import { useEffect, useRef } from 'react';
import { removeEdge } from '@/features/graph/graphOps';
import { createNodeAndSelect, undoLast } from '@/features/graph/ui/nodeActions';
import { attempt } from '@/components/toastStore';
import { useUiStore } from '@/state/uiStore';
import { setLayout } from '@/features/workspaces/workspaceOps';
import type { ID, LayoutMode } from '@/types';

const VIEW_KEYS: Record<string, LayoutMode> = { '1': 'tree', '2': 'board', '3': 'outline', '4': 'chat' };

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

/** Global keyboard shortcuts for the board. Ignores plain keys while typing. */
export function useBoardShortcuts(workspaceId: ID | null, nodeIds?: ReadonlySet<ID>): void {
  const wsRef = useRef(workspaceId);
  wsRef.current = workspaceId;
  const idsRef = useRef(nodeIds);
  idsRef.current = nodeIds;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUiStore.getState();
      const typing = isTyping(e.target);
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ui.openDialog({ kind: 'search' });
        return;
      }
      if (ui.dialog) return; // dialogs own the keyboard
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault();
        void undoLast();
        return;
      }
      if (e.altKey && !mod && !e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        const ids = idsRef.current;
        ui.navStep(e.key === 'ArrowLeft' ? -1 : 1, ids ? (id) => ids.has(id) : undefined);
        return;
      }
      if (e.altKey && !mod && !e.shiftKey && VIEW_KEYS[e.key]) {
        e.preventDefault();
        const ws = wsRef.current;
        if (ws) void attempt(() => setLayout(ws, VIEW_KEYS[e.key]!));
        return;
      }
      if (e.altKey && !mod && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        const ws = wsRef.current;
        if (!ws) return;
        void createNodeAndSelect({ workspaceId: ws, parentId: ui.selectedNodeId, title: 'New node' }).then((n) => {
          if (!n) return;
          useUiStore.getState().setPanelCollapsed(false);
          setTimeout(() => useUiStore.getState().requestRename(), 80);
        });
        return;
      }
      if (typing || mod || e.altKey) return;
      if (e.key === 'F2' && ui.selectedNodeId) {
        e.preventDefault();
        ui.setPanelCollapsed(false);
        setTimeout(() => useUiStore.getState().requestRename(), 50);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (ui.selectedEdgeId) {
          const id = ui.selectedEdgeId;
          ui.selectEdge(null);
          void attempt(() => removeEdge(id), 'Cross-link removed');
        } else if (ui.selectedNodeId) {
          e.preventDefault();
          ui.openDialog({ kind: 'deleteNode', nodeId: ui.selectedNodeId });
        }
      } else if (e.key === 'Escape') {
        if (ui.selectedEdgeId) ui.selectEdge(null);
        else ui.selectNode(null);
      } else if (e.key === '?') {
        e.preventDefault();
        ui.openDialog({ kind: 'shortcuts' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
