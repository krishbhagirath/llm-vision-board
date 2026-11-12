import { memo, useState } from 'react';
import { Check, Copy, GitBranch } from 'lucide-react';
import { IconButton } from '@/components/Button';
import { Markdown } from '@/components/Markdown';
import { toast } from '@/components/toastStore';
import type { Message, ProviderRequest } from '@/types';
import { MessageStatus } from './MessageStatus';
import { SOURCE_LABEL } from './messageState';
import { copyText } from './sendActions';

function UserMessage({ message }: { message: Message }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md border border-accent/15 bg-accent-soft px-3.5 py-2 text-sm leading-6 text-fg">
        {message.content}
      </div>
    </div>
  );
}

interface Props {
  message: Message;
  request?: ProviderRequest;
  readOnly?: boolean;
  /** Whole-answer branch: parent opens the inline question popover anchored to this button. */
  onBranchAnswer?: (message: Message, anchor: HTMLElement) => void;
}

function AssistantMessage({ message: m, request, readOnly = false, onBranchAnswer }: Props) {
  const [copied, setCopied] = useState(false);
  const hasText = m.content.trim().length > 0;
  const showBody = hasText && m.status !== 'pending';
  const complete = m.status === 'complete' && hasText;
  const sourceBadge = m.source === 'manual-paste' || m.source === 'tab-capture';

  return (
    <article data-assistant-message-id={m.id} aria-label="ChatGPT answer" className="vb-answer group/answer space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-muted">ChatGPT</span>
        {complete && sourceBadge && (
          <span className="rounded-full border border-line bg-subtle px-2 text-[11px] font-medium leading-4 text-muted">{SOURCE_LABEL[m.source]}</span>
        )}
        {complete && !readOnly && (
          <div className="vb-answer-actions ml-auto flex items-center gap-0.5">
            <IconButton
              size="sm"
              aria-label={copied ? 'Copied' : 'Copy answer'}
              onClick={async () => {
                if (await copyText(m.content)) {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1400);
                } else toast.error('Copy failed. Select the text and copy it manually.');
              }}
            >
              {copied ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
            </IconButton>
            {onBranchAnswer && (
              <IconButton size="sm" aria-label="Branch from this answer" onClick={(e) => onBranchAnswer(m, e.currentTarget)}>
                <GitBranch size={14} />
              </IconButton>
            )}
          </div>
        )}
      </div>

      {showBody && (
        <div data-answer-body className={m.status === 'streaming' ? 'md-live' : undefined}>
          <Markdown content={m.content} className="text-[14px]" />
        </div>
      )}
      <MessageStatus message={m} request={request} readOnly={readOnly} />
    </article>
  );
}

function MessageItemImpl(props: Props) {
  const m = props.message;
  if (m.role === 'user') return <UserMessage message={m} />;
  if (m.role === 'system') return <div className="text-xs text-muted">{m.content}</div>;
  return <AssistantMessage {...props} />;
}

export const MessageItem = memo(MessageItemImpl);
