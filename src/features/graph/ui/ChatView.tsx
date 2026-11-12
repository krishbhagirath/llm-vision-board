import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { MessageSquareText } from 'lucide-react';
import { db } from '@/storage/db';
import { ancestorChain } from '@/features/graph/graphOps';
import { Markdown } from '@/components/Markdown';
import { EmptyState } from '@/components/EmptyState';
import { Badge } from '@/components/Badge';
import { useUiStore } from '@/state/uiStore';
import type { GraphNode, ID, Message } from '@/types';
import { StatusGlyph } from './StatusDot';
import { cardState } from './graphView';

/** Read-only linear thread of the selected node's path (root to node). */
export function ChatView({ nodes }: { nodes: GraphNode[] }) {
  const selectedId = useUiStore((s) => s.selectedNodeId);
  const selectNode = useUiStore((s) => s.selectNode);
  const node = nodes.find((n) => n.id === selectedId);
  const path = useMemo(() => (node ? [...ancestorChain(nodes, node.id), node] : []), [nodes, node]);
  const convIds = useMemo(() => path.flatMap((n) => (n.conversationId ? [n.conversationId] : [])), [path]);
  const key = convIds.join(',');
  // Only the messages of nodes on the path are loaded.
  const messages = useLiveQuery(
    async () => (convIds.length ? db.messages.where('conversationId').anyOf(convIds).toArray() : ([] as Message[])),
    [key],
  );

  if (!node)
    return (
      <EmptyState
        className="h-full"
        icon={<MessageSquareText />}
        title="Pick a node to read its thread"
        description="The chat view shows the path from the root to the selected node as one conversation."
      />
    );
  const byConv = new Map<ID, Message[]>();
  for (const m of messages ?? []) {
    const list = byConv.get(m.conversationId) ?? [];
    list.push(m);
    byConv.set(m.conversationId, list);
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[720px] space-y-10 px-6 py-8">
        {path.map((n) => {
          const msgs = (byConv.get(n.conversationId ?? '') ?? []).sort((a, b) => a.createdAt - b.createdAt);
          const current = n.id === node.id;
          return (
            <section key={n.id} aria-current={current ? 'true' : undefined} className="space-y-4">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => selectNode(n.id)}
                  title="Select this node"
                  className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    current ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-card text-muted hover:border-line-strong hover:text-fg'
                  }`}
                >
                  <StatusGlyph state={cardState(n, undefined)} size={12} />
                  <span className="truncate">{n.title}</span>
                </button>
                {current && <Badge tone="accent">Current</Badge>}
              </div>
              {msgs.length === 0 && (
                <div className="space-y-2">
                  {n.question && <div className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent-soft px-4 py-2.5 text-sm">{n.question}</div>}
                  <p className="text-sm italic text-muted">Not asked yet</p>
                </div>
              )}
              {msgs.map((m) =>
                m.role === 'user' ? (
                  <div key={m.id} className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent-soft px-4 py-2.5 text-sm">
                    {m.content}
                  </div>
                ) : m.status === 'complete' || m.status === 'streaming' ? (
                  <Markdown key={m.id} content={m.content} className="text-[15px]" />
                ) : (
                  <p key={m.id} className="text-sm text-status-failed">
                    {m.status === 'pending' ? 'Waiting for ChatGPT…' : `Answer ${m.status}`}
                    {m.error ? ` — ${m.error}` : ''}
                  </p>
                ),
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
