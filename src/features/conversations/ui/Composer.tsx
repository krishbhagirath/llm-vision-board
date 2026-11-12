import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, ClipboardCopy, GitBranchPlus } from 'lucide-react';
import { Button } from '@/components/Button';
import { Kbd } from '@/components/Kbd';
import { Tooltip } from '@/components/Tooltip';
import { attempt, toast } from '@/components/toastStore';
import { bg } from '@/lib/bgClient';
import { recordManualQuestion } from '@/features/conversations/conversationService';
import { ContextIndicator } from '@/features/context/ui/ContextIndicator';
import { HandoffControl } from '@/features/context/ui/HandoffDialog';
import { formatTokenEstimate } from '@/features/context/tokens';
import { createNodeAndSelect } from '@/features/graph/ui/nodeActions';
import { useUiStore } from '@/state/uiStore';
import type { AppSettings, GraphNode, ID } from '@/types';
import { busyReason } from './messageState';
import { copyText, sendAutomated } from './sendActions';
import type { ConversationData } from './useConversationData';

const drafts = new Map<ID, string>();

interface Props {
  node: GraphNode;
  data: ConversationData;
  settings: AppSettings;
  compact?: boolean;
}

export function Composer({ node, data, settings, compact = false }: Props) {
  const initial = drafts.get(node.id) ?? (data.messages.length === 0 ? node.question : '');
  const [draft, setDraftState] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  const composerNonce = useUiStore((s) => s.composerNonce);
  const openDialog = useUiStore((s) => s.openDialog);
  const automation = settings.chatgptAutomation;

  const setDraft = (v: string) => {
    drafts.set(node.id, v);
    setDraftState(v);
  };
  useEffect(() => {
    if (composerNonce > 0) ref.current?.focus();
  }, [composerNonce]);

  // Auto-grow: 2 to 8 lines.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(Math.max(el.scrollHeight, compact ? 44 : 52), 190)}px`;
  }, [draft, compact]);

  const busy = !!data.activeRequest || data.messages.some((m) => m.role === 'assistant' && (m.status === 'pending' || m.status === 'streaming'));
  const why = busyReason(data.activeRequest) ?? (busy ? 'A request for this node is still in progress.' : null);
  const tokensSent = data.conversation?.context.approxTokensSent ?? 0;
  const overBudget = tokensSent > settings.handoffSuggestTokens;
  const text = draft.trim();
  const canSend = !!text && !busy;

  const sendHere = async () => {
    if (!canSend) return;
    if (automation) {
      if (await sendAutomated(node.id, text)) setDraft('');
    } else {
      const r = await attempt(() => recordManualQuestion(node.id, text));
      if (!r) return;
      setDraft('');
      if (await copyText(r.prompt)) toast.success('Prompt copied. Paste it into ChatGPT.');
      else toast.error('Could not copy automatically. Use "Copy prompt again" below.');
      try {
        await bg.openChatGPT(r.conversation.providerUrl);
      } catch {
        toast.info('Open ChatGPT yourself and paste the prompt.');
      }
    }
  };

  const newBranch = async () => {
    if (!text) return;
    const child = await createNodeAndSelect({ workspaceId: node.workspaceId, parentId: node.id, question: text });
    if (!child) return;
    setDraft('');
    if (automation) await sendAutomated(child.id, text);
  };

  const primaryLabel = automation ? 'Send to ChatGPT' : 'Copy prompt & open ChatGPT';

  return (
    <div className={`space-y-2 border-t border-line bg-surface ${compact ? 'p-2.5' : 'p-3'}`}>
      {overBudget && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-warn/30 bg-warn-soft px-2.5 py-1.5 text-xs text-warn">
          <span>This conversation has used {formatTokenEstimate(tokensSent)}. A handoff keeps answers focused.</span>
          <HandoffControl nodeId={node.id} label="Handoff…" />
        </div>
      )}
      <ContextIndicator nodeId={node.id} text={draft} />
      <div className="rounded-xl border border-line-strong bg-card shadow-sm transition-shadow focus-within:border-accent focus-within:ring-2 focus-within:ring-[var(--ring)]">
        <textarea
          ref={ref}
          rows={2}
          value={draft}
          aria-label="Message"
          placeholder={automation ? 'Ask a follow-up…' : 'Write your question…'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void sendHere();
            }
            if (e.key === 'Escape') (e.target as HTMLElement).blur();
          }}
          className="block w-full resize-none rounded-t-xl bg-transparent px-3 pb-1 pt-2.5 text-sm leading-6 text-fg placeholder:text-faint focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-1.5 px-2 pb-2">
          <Tooltip content="Ask this as a new child branch instead of continuing here">
            <Button size="sm" variant="ghost" disabled={!text} onClick={() => void newBranch()}>
              <GitBranchPlus size={14} aria-hidden />
              New branch
            </Button>
          </Tooltip>
          {data.conversation && (
            <span className={compact ? 'hidden' : ''}>
              <HandoffControl nodeId={node.id} variant="ghost" label="Handoff…" />
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-1 text-[11px] text-faint sm:inline-flex">
              <Kbd>Enter</Kbd> send
            </span>
            <Button variant="primary" size="sm" disabled={!canSend} onClick={() => void sendHere()}>
              {automation ? <ArrowUp size={14} aria-hidden /> : <ClipboardCopy size={14} aria-hidden />}
              {primaryLabel}
            </Button>
          </div>
        </div>
      </div>
      <p className="px-0.5 text-[11px] leading-4 text-muted" aria-live="polite">
        {why ? (
          <>
            <span className="font-medium text-fg">Send is paused.</span> {why}
          </>
        ) : automation ? (
          <>Automatic mode: Send types into your open ChatGPT tab. </>
        ) : (
          <>Manual mode: you copy the prompt into ChatGPT, then paste the answer back. </>
        )}
        {!why && (
          <button type="button" className="rounded font-medium text-accent hover:underline" onClick={() => openDialog({ kind: 'settings' })}>
            Change in Settings
          </button>
        )}
      </p>
    </div>
  );
}
