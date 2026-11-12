import { useMemo, useState } from 'react';
import { BookOpen, ChevronUp } from 'lucide-react';
import { Button } from '@/components/Button';
import { StatusGlyph } from '@/features/graph/ui/StatusDot';
import { cardState } from '@/features/graph/ui/graphView';
import { ancestorChain } from '@/features/graph/graphOps';
import { AncestorChips } from '@/features/conversations/ui/NodeHeader';
import { Thread } from '@/features/conversations/ui/Thread';
import { ThreadScroller } from '@/features/conversations/ui/ThreadScroller';
import type { ConversationData } from '@/features/conversations/ui/useConversationData';
import { useNodeStatusMap } from '@/hooks/useNodeStatus';
import { useUiStore } from '@/state/uiStore';
import { truncate } from '@/lib/id';
import type { GraphNode } from '@/types';

interface Props {
  node: GraphNode;
  nodes: GraphNode[];
  data: ConversationData;
  automation: boolean;
}

/** The selected node at a glance: where it sits, the question, the latest answer, and a compact full reader on demand. */
export function CurrentNodeCard({ node, nodes, data, automation }: Props) {
  const [reading, setReading] = useState(false);
  const selectNode = useUiStore((s) => s.selectNode);
  const status = useNodeStatusMap(node.workspaceId);
  const path = useMemo(() => ancestorChain(nodes, node.id), [nodes, node.id]);
  const lastAnswer = [...data.messages].reverse().find((m) => m.role === 'assistant' && m.status === 'complete' && m.content.trim());
  const preview = node.answerPreview || (lastAnswer ? truncate(lastAnswer.content.replace(/[#*`>_|-]+/g, ' ').replace(/\s+/g, ' '), 240) : '');

  return (
    <section aria-label="Selected question" className="rounded-xl border border-line bg-card shadow-sm">
      <div className="space-y-2 px-3 pb-3 pt-2.5">
        <AncestorChips path={path} onSelect={selectNode} />
        <div className="flex items-start gap-2">
          <span className="mt-1">
            <StatusGlyph state={cardState(node, status.get(node.id))} />
          </span>
          <h2 className="min-w-0 flex-1 text-sm font-semibold leading-5 tracking-[-0.01em]">{node.title}</h2>
        </div>
        {node.question && node.question !== node.title && <p className="line-clamp-3 text-ui text-muted">{node.question}</p>}
        {preview ? (
          <p className="line-clamp-4 rounded-md bg-subtle px-2.5 py-2 text-ui leading-5 text-fg">{preview}</p>
        ) : (
          <p className="text-ui italic text-muted">No answer yet. Ask below, or capture one from ChatGPT.</p>
        )}
        <Button size="sm" variant="ghost" aria-expanded={reading} className="-ml-1.5" onClick={() => setReading((r) => !r)}>
          {reading ? <ChevronUp size={13} aria-hidden /> : <BookOpen size={13} aria-hidden />}
          {reading ? 'Hide conversation' : 'Show full conversation'}
        </Button>
      </div>
      {reading && (
        <div className="flex max-h-[56vh] flex-col border-t border-line">
          <ThreadScroller resetKey={node.id}>
            <Thread node={node} nodes={nodes} data={data} automation={automation} compact />
          </ThreadScroller>
        </div>
      )}
    </section>
  );
}
