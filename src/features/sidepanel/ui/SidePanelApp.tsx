import { useState } from 'react';
import { ExternalLink, FolderPlus, ListTree, MessageSquareReply, TextCursorInput } from 'lucide-react';
import { Button, IconButton, Spinner, TextInput } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Toaster } from '@/components/Toast';
import { attempt } from '@/components/toastStore';
import { bg } from '@/lib/bgClient';
import { addManualResponse, getOrCreateConversation } from '@/features/conversations/conversationService';
import { Composer } from '@/features/conversations/ui/Composer';
import { useConversationData } from '@/features/conversations/ui/useConversationData';
import { createNodeAndSelect } from '@/features/graph/ui/nodeActions';
import { OutlineView } from '@/features/graph/ui/OutlineView';
import { CaptureButton } from '@/features/provider/ui/CaptureReplyButton';
import { ProviderStatusBar } from '@/features/provider/ui/ProviderStatusBar';
import { AppSettingsDialog } from '@/features/settings/ui/SettingsDialogs';
import { useActiveWorkspaceId } from '@/hooks/useActiveWorkspace';
import { useSelectionSync } from '@/hooks/useSelectionSync';
import { useSettings } from '@/hooks/useSettings';
import { useTheme } from '@/hooks/useTheme';
import { useWorkspaceGraph } from '@/hooks/useWorkspaceGraph';
import { useUiStore } from '@/state/uiStore';
import type { GraphNode } from '@/types';
import { CapturedSelectionDialog } from './CapturedSelectionDialog';
import { CurrentNodeCard } from './CurrentNodeCard';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

/** Selected node: card + capture actions live in the scroll area; the composer is pinned at the bottom. */
function SelectedNodeArea({ node, nodes, onCapture }: { node: GraphNode; nodes: GraphNode[]; onCapture: (c: { text: string; url: string | null }) => void }) {
  const settings = useSettings();
  const data = useConversationData(node);
  if (!settings || !data) {
    return (
      <div className="grid flex-1 place-items-center text-muted">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }
  return (
    <>
      <div className="space-y-3 p-3">
        <CurrentNodeCard node={node} nodes={nodes} data={data} automation={settings.chatgptAutomation} />
        <div className="flex flex-wrap gap-1.5">
          <CaptureButton kind="selection" label="Capture selection from ChatGPT" onConfirm={(text, url) => onCapture({ text, url })} />
          <CaptureButton
            label="Capture latest reply"
            onConfirm={(text, url) =>
              attempt(async () => {
                const conv = await getOrCreateConversation(node.id);
                await addManualResponse(conv.id, text, 'tab-capture', url);
              }, 'Reply saved to this question')
            }
          />
        </div>
      </div>
      <OutlineSection nodes={nodes} workspaceId={node.workspaceId} />
      <div className="sticky bottom-0 z-10 mt-auto">
        <Composer key={node.id} node={node} data={data} settings={settings} compact />
      </div>
    </>
  );
}

function OutlineSection({ nodes, workspaceId }: { nodes: GraphNode[]; workspaceId: string }) {
  return (
    <section aria-label="Outline" className="mx-3 mb-3 overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-1.5 text-xs font-medium text-muted">
        <ListTree size={13} aria-hidden />
        Outline
        <span className="ml-auto tabular-nums text-faint">{nodes.length}</span>
      </div>
      <OutlineView nodes={nodes} workspaceId={workspaceId} className="h-64" />
    </section>
  );
}

function FirstQuestion({ workspaceId, nodes }: { workspaceId: string; nodes: GraphNode[] }) {
  const [text, setText] = useState('');
  const add = async () => {
    if (!text.trim()) return;
    const n = await createNodeAndSelect({ workspaceId, parentId: null, question: text });
    if (n) setText('');
  };
  return (
    <>
      <div className="space-y-2 p-3">
        {nodes.length === 0 ? (
          <EmptyState icon={<MessageSquareReply />} title="Ask your first question" description="Each question gets its own ChatGPT conversation. Branch from any answer to go deeper." className="!p-4" />
        ) : (
          <p className="rounded-lg border border-dashed border-line px-3 py-3 text-center text-ui text-muted">Pick a question from the outline to read or continue it.</p>
        )}
        <div className="flex gap-1.5">
          <TextInput aria-label="New top-level question" value={text} placeholder="New top-level question" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} />
          <Button variant="primary" disabled={!text.trim()} onClick={() => void add()}>
            Add
          </Button>
        </div>
      </div>
      {nodes.length > 0 && <OutlineSection nodes={nodes} workspaceId={workspaceId} />}
    </>
  );
}

export function SidePanelApp() {
  useTheme();
  const { loading, workspaces, activeId } = useActiveWorkspaceId();
  const graph = useWorkspaceGraph(activeId);
  const selectedId = useUiStore((s) => s.selectedNodeId);
  const dialog = useUiStore((s) => s.dialog);
  const ws = graph?.workspace?.id === activeId ? graph?.workspace : undefined;
  const nodes = graph?.nodes ?? [];
  useSelectionSync(ws, nodes);
  const selected = nodes.find((n) => n.id === selectedId);
  const [capture, setCapture] = useState<{ text: string; url: string | null } | null>(null);

  if (loading) {
    return (
      <div className="grid h-full place-items-center text-muted">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-[300px] flex-col bg-app">
      <header className="flex shrink-0 items-center gap-1 border-b border-line bg-surface px-2 py-1.5">
        <div className="min-w-0 flex-1">{workspaces.length > 0 ? <WorkspaceSwitcher workspaces={workspaces} activeId={activeId} /> : <span className="px-2 text-sm font-semibold">Vision Board</span>}</div>
        <ProviderStatusBar dotOnly />
        <IconButton aria-label="Open board" onClick={() => void attempt(() => bg.openBoard(selectedId ?? undefined))}>
          <ExternalLink size={16} />
        </IconButton>
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <ErrorBoundary region="side panel">
          {workspaces.length === 0 ? (
            <EmptyState
              icon={<FolderPlus />}
              title="No workspaces yet"
              description="Create your first workspace in the full board, then come back here to work beside ChatGPT."
              className="my-auto"
            >
              <Button variant="primary" onClick={() => void attempt(() => bg.openBoard())}>
                <TextCursorInput size={14} aria-hidden />
                Open board
              </Button>
            </EmptyState>
          ) : !ws ? (
            <div className="grid flex-1 place-items-center text-muted">
              <Spinner className="h-5 w-5" />
            </div>
          ) : selected ? (
            <SelectedNodeArea key={selected.id} node={selected} nodes={nodes} onCapture={setCapture} />
          ) : (
            <FirstQuestion workspaceId={ws.id} nodes={nodes} />
          )}
        </ErrorBoundary>
      </main>

      {capture && ws && <CapturedSelectionDialog text={capture.text} url={capture.url} workspaceId={ws.id} selected={selected} onClose={() => setCapture(null)} />}
      {dialog?.kind === 'settings' && <AppSettingsDialog />}
      <Toaster />
    </div>
  );
}
