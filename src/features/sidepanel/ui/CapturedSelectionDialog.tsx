import { useState } from 'react';
import { Button, Field, TextArea } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { attempt } from '@/components/toastStore';
import { addManualResponse, getOrCreateConversation } from '@/features/conversations/conversationService';
import { createNodeAndSelect } from '@/features/graph/ui/nodeActions';
import type { GraphNode, ID } from '@/types';

/** A passage read from the ChatGPT tab: ask about it as a new branch, or keep it as the selected node's answer. */
export function CapturedSelectionDialog({
  text,
  url,
  workspaceId,
  selected,
  onClose,
}: {
  text: string;
  url: string | null;
  workspaceId: ID;
  selected: GraphNode | undefined;
  onClose: () => void;
}) {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const branch = async () => {
    if (!question.trim() || busy) return;
    setBusy(true);
    const n = await createNodeAndSelect({ workspaceId, parentId: selected?.id ?? null, question, sourcePassage: text });
    setBusy(false);
    if (n) onClose();
  };
  const asAnswer = async () => {
    if (!selected) return;
    setBusy(true);
    await attempt(async () => {
      const conv = await getOrCreateConversation(selected.id);
      await addManualResponse(conv.id, text, 'tab-capture', url);
    }, 'Saved as an answer for the selected node');
    setBusy(false);
    onClose();
  };
  return (
    <Dialog
      title="Captured from ChatGPT"
      description="Read from your ChatGPT tab just now."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          {selected && (
            <Button disabled={busy} onClick={() => void asAnswer()}>
              Use as answer here
            </Button>
          )}
          <Button variant="primary" disabled={busy || !question.trim()} onClick={() => void branch()}>
            {selected ? 'Create branch' : 'Create root question'}
          </Button>
        </>
      }
    >
      <blockquote className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border-l-[3px] border-accent bg-accent-soft/60 px-3 py-2 text-sm">{text}</blockquote>
      <Field label={selected ? `Question for a new branch under "${selected.title}"` : 'Question for a new root node'}>
        <TextArea
          rows={3}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void branch();
            }
          }}
          placeholder="Ask about this passage…"
        />
      </Field>
    </Dialog>
  );
}
