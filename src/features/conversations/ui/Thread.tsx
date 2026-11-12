import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { attempt } from '@/components/toastStore';
import { childrenIndex, updateNode } from '@/features/graph/graphOps';
import type { GraphNode, Message } from '@/types';
import { BranchPopover } from './BranchPopover';
import { ExploreNext } from './ExploreNext';
import { HighlightBranch } from './HighlightBranch';
import { ManualStep } from './ManualStep';
import { MessageItem } from './MessageItem';
import { SourceQuote } from './SourceQuote';
import { createBranch } from './sendActions';
import { rectToBox } from './usePlacement';
import type { ConversationData } from './useConversationData';

function SummaryField({ node }: { node: GraphNode }) {
  const [value, setValue] = useState(node.summary);
  const [open, setOpen] = useState(false);
  useEffect(() => setValue(node.summary), [node.id, node.summary]);
  return (
    <div className="text-xs">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 rounded text-muted hover:text-fg">
        <ChevronRight size={12} aria-hidden className={open ? 'rotate-90' : ''} style={{ transition: 'transform 120ms' }} />
        Summary used as context for child branches{node.summary.trim() ? '' : ' (automatic)'}
      </button>
      {open && (
        <textarea
          rows={3}
          value={value}
          aria-label="Summary used as context for child branches"
          placeholder="Optional. If empty, the first answer is condensed automatically."
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            if (value !== node.summary) void attempt(() => updateNode(node.id, { summary: value }));
          }}
          className="mt-1.5 block w-full resize-y rounded-md border border-line bg-card px-2.5 py-1.5 text-xs focus:border-accent focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
        />
      )}
    </div>
  );
}

/** Earlier conversation(s) archived by a handoff, then a divider where the current conversation continues. */
function ContinuedDivider({ data }: { data: ConversationData }) {
  const [open, setOpen] = useState(false);
  if (!data.archived.length) return null;
  const count = data.archived.reduce((n, a) => n + a.messages.length, 0);
  return (
    <div className="space-y-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-md border border-line bg-subtle px-3 py-1.5 text-left text-xs text-muted hover:text-fg"
      >
        <ChevronRight size={13} aria-hidden className={open ? 'rotate-90' : ''} style={{ transition: 'transform 120ms' }} />
        <span className="flex-1">Earlier conversation · {count} message{count === 1 ? '' : 's'}</span>
        <span className="text-faint">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="space-y-4 border-l-2 border-line pl-3 opacity-90">
          {data.archived.map((a) => (
            <div key={a.conversation.id} className="space-y-4">
              {a.messages.map((m) => (
                <MessageItem key={m.id} message={m} readOnly />
              ))}
            </div>
          ))}
        </div>
      )}
      <div role="separator" className="flex items-center gap-3 text-[11px] font-medium text-muted">
        <span aria-hidden className="h-px flex-1 bg-line" />
        Continued from earlier conversation
        <span aria-hidden className="h-px flex-1 bg-line" />
      </div>
    </div>
  );
}

interface Props {
  node: GraphNode;
  nodes: GraphNode[];
  data: ConversationData;
  automation: boolean;
  /** Narrow layout (side panel): hides the editable summary and tightens spacing. */
  compact?: boolean;
}

/** Everything inside the scrolling area of a node's conversation. */
export function Thread({ node, nodes, data, automation, compact = false }: Props) {
  const [answerBranch, setAnswerBranch] = useState<{ message: Message; el: HTMLElement } | null>(null);
  const parent = useMemo(() => nodes.find((n) => n.id === node.parentId), [nodes, node.parentId]);
  const childTitles = useMemo(() => (childrenIndex(nodes).get(node.id) ?? []).map((c) => c.title), [nodes, node.id]);
  const lastAnswer = [...data.messages].reverse().find((m) => m.role === 'assistant' && m.status === 'complete' && m.content.trim());
  const lastMessage = data.messages[data.messages.length - 1];
  const showSuggestions = !!lastAnswer && !!lastMessage && lastMessage.id === lastAnswer.id;
  const onBranchAnswer = useCallback((message: Message, el: HTMLElement) => setAnswerBranch({ message, el }), []);

  return (
    <div className={`space-y-4 ${compact ? 'px-3 py-3' : 'px-4 py-4'}`}>
      <SourceQuote node={node} parent={parent} compact={compact} />
      {!compact && <SummaryField node={node} />}
      <ContinuedDivider data={data} />

      <HighlightBranch node={node} automation={automation}>
        <div className="space-y-5">
          {data.messages.length === 0 && (
            <div className="space-y-2 py-2">
              {node.question && (
                <div className="flex justify-end">
                  <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md border border-dashed border-accent/40 px-3.5 py-2 text-sm leading-6 text-muted">{node.question}</div>
                </div>
              )}
              <p className="text-center text-xs text-muted">{node.question ? 'Not asked yet. Send it from the box below.' : 'No messages yet. Ask your first question below.'}</p>
            </div>
          )}
          {data.messages.map((m) => (
            <MessageItem key={m.id} message={m} request={data.requestByMessage.get(m.id)} onBranchAnswer={onBranchAnswer} />
          ))}
          <ManualStep data={data} />
        </div>
      </HighlightBranch>

      {showSuggestions && lastAnswer && <ExploreNext node={node} answer={lastAnswer} childTitles={childTitles} />}

      {answerBranch && (
        <BranchPopover
          getBox={() => rectToBox(answerBranch.el.getBoundingClientRect())}
          passage={null}
          heading="Branch from this answer"
          automation={automation}
          placement="bottom-end"
          onCancel={() => {
            answerBranch.el.focus();
            setAnswerBranch(null);
          }}
          onSubmit={async (question, send) => {
            const child = await createBranch({ parent: node, question, passage: null, messageId: answerBranch.message.id, send });
            if (child) setAnswerBranch(null);
          }}
        />
      )}
    </div>
  );
}
