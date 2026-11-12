import { useState } from 'react';
import { ClipboardPaste, Copy } from 'lucide-react';
import { Button, TextArea, TextInput } from '@/components/Button';
import { attempt, toast } from '@/components/toastStore';
import { addManualResponse } from '@/features/conversations/conversationService';
import { CaptureButton } from '@/features/provider/ui/CaptureReplyButton';
import type { ConversationData } from './useConversationData';
import { copyText } from './sendActions';

/**
 * Manual mode, step 2: appears where the answer will go once a question has been recorded but not answered.
 * Paste ChatGPT's reply, or capture it from the open tab, and save it into this node.
 */
export function ManualStep({ data }: { data: ConversationData }) {
  const last = data.messages[data.messages.length - 1];
  const [answer, setAnswer] = useState('');
  const [url, setUrl] = useState('');
  const [captured, setCaptured] = useState<string | null>(null);
  const convId = data.conversation?.id;
  if (!last || last.role !== 'user' || !convId || data.activeRequest) return null;

  const save = async () => {
    const source = captured !== null && captured === answer.trim() ? 'tab-capture' : 'manual-paste';
    await attempt(() => addManualResponse(convId, answer, source, url.trim() || null), 'Answer saved');
    setAnswer('');
    setUrl('');
    setCaptured(null);
  };

  return (
    <section aria-label="Add ChatGPT's answer" className="space-y-2.5 rounded-xl border border-dashed border-accent/50 bg-accent-soft/40 p-3">
      <div>
        <h3 className="text-ui font-semibold">Bring ChatGPT's answer back</h3>
        <p className="mt-0.5 text-xs text-muted">Paste the prompt into ChatGPT, then paste its reply here. Nothing is sent for you in manual mode.</p>
      </div>
      {last.sentPrompt && (
        <Button
          size="sm"
          onClick={async () => {
            if (await copyText(last.sentPrompt ?? '')) toast.success('Prompt copied');
            else toast.error('Copy failed. Open "View exact prompt" above the message box and copy it from there.');
          }}
        >
          <Copy size={13} aria-hidden />
          Copy prompt again
        </Button>
      )}
      <TextArea rows={5} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Paste ChatGPT's answer here" aria-label="ChatGPT's answer" />
      <TextInput value={url} onChange={(e) => setUrl(e.target.value)} placeholder={data.conversation?.providerUrl ?? 'ChatGPT conversation URL (optional)'} aria-label="ChatGPT conversation URL" />
      <div className="flex flex-wrap gap-1.5">
        <CaptureButton
          onConfirm={(t, u) => {
            setAnswer(t);
            setCaptured(t.trim());
            if (u) setUrl(u);
          }}
        />
        <Button size="sm" variant="primary" disabled={!answer.trim()} onClick={() => void save()}>
          <ClipboardPaste size={13} aria-hidden />
          Save answer
        </Button>
      </div>
    </section>
  );
}
