import { useEffect, useMemo } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Toaster } from '@/components/Toast';
import { ConversationPanel } from '@/features/conversations/ui/ConversationPanel';
import { collectSubtree } from '@/features/graph/graphOps';
import { ChatView } from '@/features/graph/ui/ChatView';
import { EmptyWorkspace, WelcomeCard } from '@/features/graph/ui/EmptyStates';
import { GraphCanvas } from '@/features/graph/ui/GraphCanvas';
import { NodePickerDialog } from '@/features/graph/ui/NodePickerDialog';
import { deleteBranchUndoable, moveNodeUndoable, openNode } from '@/features/graph/ui/nodeActions';
import { OutlineView } from '@/features/graph/ui/OutlineView';
import { addLink } from '@/features/graph/graphOps';
import { SearchDialog } from '@/features/search/ui/SearchDialog';
import {
  AppSettingsDialog,
  NewWorkspaceDialog,
  ShortcutsDialog,
  WorkspaceSettingsDialog,
} from '@/features/settings/ui/SettingsDialogs';
import { HintChip } from '@/features/graph/ui/HintChip';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Skeleton } from '@/components/Skeleton';
import { useViewportWidth } from '@/hooks/useViewport';
import { DRAWER_BREAKPOINT } from '@/components/ResizablePanel';
import { attempt } from '@/components/toastStore';
import { useActiveWorkspaceId } from '@/hooks/useActiveWorkspace';
import { useBoardShortcuts } from '@/hooks/useBoardShortcuts';
import { useSelectionSync } from '@/hooks/useSelectionSync';
import { useTheme } from '@/hooks/useTheme';
import { useWorkspaceGraph } from '@/hooks/useWorkspaceGraph';
import { useUiStore } from '@/state/uiStore';
import { ImportPreviewHost } from './ImportPreviewDialog';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

function useHashNode(): void {
  useEffect(() => {
    const apply = () => {
      const m = /[#&]node=([^&]+)/.exec(window.location.hash);
      if (!m?.[1]) return;
      const id = decodeURIComponent(m[1]);
      history.replaceState(null, '', window.location.pathname + window.location.search);
      void openNode(id);
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, []);
}

function Dialogs({ graph }: { graph: ReturnType<typeof useWorkspaceGraph> }) {
  const dialog = useUiStore((s) => s.dialog);
  const close = useUiStore((s) => s.closeDialog);
  const nodes = graph?.nodes ?? [];
  if (!dialog) return null;
  switch (dialog.kind) {
    case 'search':
      return <SearchDialog workspace={graph?.workspace} nodes={nodes} />;
    case 'settings':
      return <AppSettingsDialog />;
    case 'newWorkspace':
      return <NewWorkspaceDialog />;
    case 'workspaceSettings':
      return <WorkspaceSettingsDialog workspace={graph?.workspace} />;
    case 'shortcuts':
      return <ShortcutsDialog />;
    case 'deleteNode': {
      const node = nodes.find((n) => n.id === dialog.nodeId);
      if (!node) return null;
      const count = collectSubtree(nodes, node.id).length;
      return (
        <ConfirmDialog
          title="Delete branch?"
          danger
          confirmLabel={`Delete ${count} node${count === 1 ? '' : 's'}`}
          onCancel={close}
          onConfirm={async () => {
            close();
            await deleteBranchUndoable(node.id);
          }}
        >
          <p>
            "{node.title}" and {count - 1} descendant{count - 1 === 1 ? '' : 's'} ({count} node{count === 1 ? '' : 's'} in total) with their messages will be deleted.
            Right after deleting, you can restore it with Undo (or Ctrl+Z) until this page is reloaded.
          </p>
        </ConfirmDialog>
      );
    }
    case 'moveNode': {
      const node = nodes.find((n) => n.id === dialog.nodeId);
      if (!node) return null;
      return (
        <NodePickerDialog
          title={`Move "${node.title}" to…`}
          mode="move"
          nodes={nodes}
          fromId={node.id}
          onClose={close}
          onPick={async (parentId) => {
            close();
            await moveNodeUndoable(node, parentId);
          }}
        />
      );
    }
    case 'linkNode': {
      const node = nodes.find((n) => n.id === dialog.nodeId);
      if (!node) return null;
      return (
        <NodePickerDialog
          title={`Add cross-link from "${node.title}" to…`}
          mode="link"
          nodes={nodes}
          fromId={node.id}
          onClose={close}
          onPick={async (target) => {
            close();
            if (target) await attempt(() => addLink(node.workspaceId, node.id, target), 'Cross-link added');
          }}
        />
      );
    }
  }
}

function LoadingState() {
  return (
    <div className="flex h-full gap-4 p-6" aria-busy="true" aria-label="Loading workspace">
      <div className="flex-1 space-y-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-24 w-72" />
        <Skeleton className="ml-24 h-24 w-72" />
      </div>
    </div>
  );
}

export function BoardApp() {
  const theme = useTheme();
  const { loading, workspaces, activeId } = useActiveWorkspaceId();
  const graph = useWorkspaceGraph(activeId);
  const selectedId = useUiStore((s) => s.selectedNodeId);
  const panelCollapsed = useUiStore((s) => s.panelCollapsed);
  const drawerOpen = useUiStore((s) => s.drawerOpen);
  const vw = useViewportWidth();

  const ws = graph?.workspace?.id === activeId ? graph?.workspace : undefined;
  const nodes = useMemo(() => graph?.nodes ?? [], [graph?.nodes]);
  const nodeIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);
  useBoardShortcuts(ws?.id ?? null, nodeIds);
  useSelectionSync(ws, nodes);
  useHashNode();

  const selectedNode = nodes.find((n) => n.id === selectedId);
  const showPanel = !!ws && nodes.length > 0 && (vw < DRAWER_BREAKPOINT ? drawerOpen : !panelCollapsed);

  let content;
  if (loading || (activeId && !ws)) {
    content = <LoadingState />;
  } else if (!ws) {
    content = <WelcomeCard />;
  } else if (nodes.length === 0) {
    content = <EmptyWorkspace workspaceId={ws.id} />;
  } else if (ws.layout === 'outline') {
    content = <OutlineView nodes={nodes} workspaceId={ws.id} className="mx-auto h-full max-w-4xl" />;
  } else if (ws.layout === 'chat') {
    content = <ChatView nodes={nodes} />;
  } else {
    content = <GraphCanvas workspace={ws} nodes={nodes} edges={graph?.edges ?? []} mode={ws.layout === 'board' ? 'board' : 'tree'} theme={theme} />;
  }

  return (
    <div className="flex h-full overflow-hidden bg-app">
      <ErrorBoundary region="sidebar" className="w-60 shrink-0 border-r border-line">
        <Sidebar workspaces={workspaces} activeId={activeId} />
      </ErrorBoundary>
      <main className="flex min-w-0 flex-1 flex-col">
        {ws && <TopBar workspace={ws} nodes={nodes} />}
        <div className="relative min-h-0 flex-1">
          <ErrorBoundary region="canvas">{content}</ErrorBoundary>
          {ws && nodes.length > 0 && (ws.layout === 'tree' || ws.layout === 'board') && <HintChip nodes={nodes} />}
        </div>
      </main>
      {showPanel && <ConversationPanel node={selectedNode} nodes={nodes} />}
      <Dialogs graph={graph} />
      <ImportPreviewHost />
      <Toaster />
    </div>
  );
}
