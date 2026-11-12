import { MessageSquareDashed } from 'lucide-react';
import { ResizablePanel } from '@/components/ResizablePanel';
import { Spinner } from '@/components/Button';
import { ancestorChain } from '@/features/graph/graphOps';
import { useSettings } from '@/hooks/useSettings';
import { useUiStore } from '@/state/uiStore';
import type { GraphNode } from '@/types';
import { Composer } from './Composer';
import { NodeHeader } from './NodeHeader';
import { Thread } from './Thread';
import { ThreadScroller } from './ThreadScroller';
import { useConversationData } from './useConversationData';

function PanelBody({ node, nodes }: { node: GraphNode; nodes: GraphNode[] }) {
  const settings = useSettings();
  const data = useConversationData(node);
  const setCollapsed = useUiStore((s) => s.setPanelCollapsed);

  if (!data || !settings) {
    return (
      <div className="grid flex-1 place-items-center text-muted">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }
  const path = ancestorChain(nodes, node.id);

  return (
    <>
      <NodeHeader node={node} path={path} conversation={data.conversation} onCollapse={() => setCollapsed(true)} />
      <ThreadScroller resetKey={node.id}>
        <Thread node={node} nodes={nodes} data={data} automation={settings.chatgptAutomation} />
      </ThreadScroller>
      <Composer key={node.id} node={node} data={data} settings={settings} />
    </>
  );
}

export function ConversationPanel({ node, nodes }: { node: GraphNode | undefined; nodes: GraphNode[] }) {
  return (
    <ResizablePanel>
      {node ? (
        <PanelBody key={node.id} node={node} nodes={nodes} />
      ) : (
        <div className="grid flex-1 place-items-center p-8 text-center">
          <div className="space-y-2">
            <MessageSquareDashed size={22} aria-hidden className="mx-auto text-faint" />
            <p className="text-sm text-muted">Select a node to read its conversation.</p>
          </div>
        </div>
      )}
    </ResizablePanel>
  );
}
