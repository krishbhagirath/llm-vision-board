import { db, updateSettings } from '@/storage/db';
import {
  createNode,
  deleteSubtree,
  moveNode,
  restoreBundle,
  setPositions,
  updateNode,
  type CreateNodeInput,
} from '@/features/graph/graphOps';
import { computeCardLayout } from './graphView';
import { visibleNodes } from '@/features/graph/graphOps';
import { updateWorkspace } from '@/features/workspaces/workspaceOps';
import { attempt, errMsg, toast } from '@/components/toastStore';
import { useUiStore } from '@/state/uiStore';
import type { GraphNode, ID, Position, Workspace } from '@/types';

/** Graph operations wrapped with error toasts and undo-stack entries. UI-only glue. */

export async function createNodeAndSelect(input: CreateNodeInput): Promise<GraphNode | undefined> {
  const node = await attempt(() => createNode(input));
  if (node) {
    useUiStore.getState().selectNode(node.id);
    useUiStore.getState().requestFocusNode(node.id);
  }
  return node;
}

export async function renameNodeUndoable(node: GraphNode, title: string): Promise<void> {
  const next = title.trim();
  if (!next || next === node.title) return;
  const old = node.title;
  const ok = await attempt(() => updateNode(node.id, { title: next }));
  if (ok) {
    useUiStore.getState().pushUndo({ label: 'Rename node', undo: async () => void (await updateNode(node.id, { title: old })) });
  }
}

export async function moveNodeUndoable(node: GraphNode, newParentId: ID | null): Promise<void> {
  const oldParent = node.parentId;
  const moved = await attempt(() => moveNode(node.id, newParentId), 'Node moved');
  if (moved) {
    useUiStore.getState().pushUndo({ label: 'Move node', undo: async () => void (await moveNode(node.id, oldParent)) });
  }
}

export async function deleteBranchUndoable(nodeId: ID): Promise<void> {
  const node = await db.nodes.get(nodeId);
  const bundle = await attempt(() => deleteSubtree(nodeId));
  if (!bundle) return;
  const ui = useUiStore.getState();
  if (ui.selectedNodeId && bundle.nodes.some((n) => n.id === ui.selectedNodeId)) ui.selectNode(node?.parentId ?? null);
  const entry = { label: 'Delete branch', undo: () => restoreBundle(bundle) };
  ui.pushUndo(entry);
  toast.success(`Deleted ${bundle.nodes.length} node${bundle.nodes.length === 1 ? '' : 's'}`, {
    label: 'Undo',
    onClick: async () => {
      // Undo exactly this deletion (not whatever happens to be on top of the stack), and keep Ctrl+Z from repeating it.
      useUiStore.setState((s) => ({ undoStack: s.undoStack.filter((e) => e !== entry) }));
      try {
        await entry.undo();
        toast.success('Branch restored');
      } catch (e) {
        toast.error(errMsg(e));
      }
    },
  });
}

export async function persistPositions(
  updates: Array<{ id: ID; position: Position }>,
  previous: ReadonlyMap<ID, Position>,
  label = 'Move nodes',
): Promise<void> {
  if (!updates.length) return;
  try {
    await setPositions(updates);
  } catch (e) {
    toast.error(errMsg(e));
    return;
  }
  const undoUpdates = updates.flatMap((u) => {
    const p = previous.get(u.id);
    return p ? [{ id: u.id, position: p }] : [];
  });
  useUiStore.getState().pushUndo({ label, undo: () => setPositions(undoUpdates) });
}

/** Copy the computed tree layout into stored board positions (undoable). */
export async function autoLayoutBoard(workspace: Workspace, nodes: readonly GraphNode[]): Promise<void> {
  const layout = computeCardLayout(visibleNodes(nodes), workspace.settings.treeDirection);
  const prev = new Map(nodes.map((n) => [n.id, n.position] as const));
  const updates = [...layout.entries()].map(([id, position]) => ({ id, position }));
  await persistPositions(updates, prev, 'Auto-layout');
  useUiStore.getState().requestFit();
}

export async function undoLast(): Promise<void> {
  const entry = useUiStore.getState().popUndo();
  if (!entry) {
    toast.info('Nothing to undo');
    return;
  }
  await attempt(entry.undo, `Undid: ${entry.label}`);
}

/** Switch workspace (and optionally select + center a node, expanding collapsed ancestors). */
export async function openNode(nodeId: ID): Promise<void> {
  const node = await db.nodes.get(nodeId);
  if (!node) {
    toast.error('That node no longer exists');
    return;
  }
  // Expand collapsed ancestors so the node is actually visible.
  let cur = node.parentId ? await db.nodes.get(node.parentId) : undefined;
  const guard = new Set<ID>();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    if (cur.collapsed) await db.nodes.update(cur.id, { collapsed: false });
    cur = cur.parentId ? await db.nodes.get(cur.parentId) : undefined;
  }
  await updateSettings({ lastWorkspaceId: node.workspaceId });
  await updateWorkspace(node.workspaceId, { selectedNodeId: node.id });
  const ui = useUiStore.getState();
  ui.selectNode(node.id);
  ui.requestFocusNode(node.id);
}

export async function openWorkspace(workspaceId: ID): Promise<void> {
  await updateSettings({ lastWorkspaceId: workspaceId });
  const ws = await db.workspaces.get(workspaceId);
  useUiStore.getState().selectNode(ws?.selectedNodeId ?? null);
  useUiStore.getState().requestFit();
}
