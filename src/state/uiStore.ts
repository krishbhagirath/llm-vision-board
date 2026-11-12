import { create } from 'zustand';
import type { ID } from '@/types';
import { EMPTY_HISTORY, pushHistory, stepHistory, type NavHistory } from './navHistory';

/** Ephemeral UI state only. Workspace data lives in IndexedDB and is read with useLiveQuery. */

export type DialogState =
  | null
  | { kind: 'search' }
  | { kind: 'settings' }
  | { kind: 'newWorkspace' }
  | { kind: 'workspaceSettings' }
  | { kind: 'shortcuts' }
  | { kind: 'deleteNode'; nodeId: ID }
  | { kind: 'moveNode'; nodeId: ID }
  | { kind: 'linkNode'; nodeId: ID };

export interface UndoEntry {
  label: string;
  undo: () => Promise<void>;
}

function readLs(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLs(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

export const PANEL_MIN = 340;
export const PANEL_MAX = 900;

interface UiState {
  selectedNodeId: ID | null;
  selectedEdgeId: ID | null;
  selectNode: (id: ID | null) => void;
  selectEdge: (id: ID | null) => void;
  /** Back/forward through previously selected nodes. `exists` skips deleted nodes. */
  navHistory: NavHistory;
  navStep: (dir: -1 | 1, exists?: (id: ID) => boolean) => void;

  /** Narrow viewports show the conversation as an overlay drawer; this is its open state. */
  drawerOpen: boolean;
  setDrawerOpen: (v: boolean) => void;

  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;
  panelWidth: number;
  setPanelWidth: (w: number) => void;
  panelCollapsed: boolean;
  setPanelCollapsed: (v: boolean) => void;

  dialog: DialogState;
  openDialog: (d: Exclude<DialogState, null>) => void;
  closeDialog: () => void;

  undoStack: UndoEntry[];
  pushUndo: (e: UndoEntry) => void;
  popUndo: () => UndoEntry | undefined;

  renameNonce: number;
  requestRename: () => void;
  composerNonce: number;
  requestComposerFocus: () => void;
  fitNonce: number;
  requestFit: () => void;
  focusRequest: { nodeId: ID; ts: number } | null;
  requestFocusNode: (nodeId: ID) => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  selectedNodeId: null,
  selectedEdgeId: null,
  selectNode: (id) =>
    set((s) => ({
      selectedNodeId: id,
      selectedEdgeId: null,
      navHistory: id ? pushHistory(s.navHistory, id) : s.navHistory,
    })),
  navHistory: EMPTY_HISTORY,
  navStep: (dir, exists) => {
    const r = stepHistory(get().navHistory, dir, exists);
    if (r) set({ navHistory: r.history, selectedNodeId: r.id, selectedEdgeId: null, focusRequest: { nodeId: r.id, ts: Date.now() } });
  },
  drawerOpen: false,
  setDrawerOpen: (v) => set({ drawerOpen: v }),
  selectEdge: (id) => set({ selectedEdgeId: id }),

  sidebarCollapsed: readLs('lvb.sidebarCollapsed') === '1',
  setSidebarCollapsed: (v) => {
    writeLs('lvb.sidebarCollapsed', v ? '1' : '0');
    set({ sidebarCollapsed: v });
  },
  panelWidth: Math.min(PANEL_MAX, Math.max(PANEL_MIN, Number(readLs('lvb.panelWidth')) || 460)),
  setPanelWidth: (w) => {
    const c = Math.min(PANEL_MAX, Math.max(PANEL_MIN, Math.round(w)));
    writeLs('lvb.panelWidth', String(c));
    set({ panelWidth: c });
  },
  panelCollapsed: readLs('lvb.panelCollapsed') === '1',
  setPanelCollapsed: (v) => {
    writeLs('lvb.panelCollapsed', v ? '1' : '0');
    set({ panelCollapsed: v, drawerOpen: !v });
  },

  dialog: null,
  openDialog: (d) => set({ dialog: d }),
  closeDialog: () => set({ dialog: null }),

  undoStack: [],
  pushUndo: (e) => set((s) => ({ undoStack: [...s.undoStack.slice(-29), e] })),
  popUndo: () => {
    const stack = get().undoStack;
    const last = stack[stack.length - 1];
    if (last) set({ undoStack: stack.slice(0, -1) });
    return last;
  },

  renameNonce: 0,
  requestRename: () => set((s) => ({ renameNonce: s.renameNonce + 1 })),
  composerNonce: 0,
  requestComposerFocus: () => set((s) => ({ composerNonce: s.composerNonce + 1, panelCollapsed: false, drawerOpen: true })),
  fitNonce: 0,
  requestFit: () => set((s) => ({ fitNonce: s.fitNonce + 1 })),
  focusRequest: null,
  requestFocusNode: (nodeId) => set({ focusRequest: { nodeId, ts: Date.now() } }),
}));
