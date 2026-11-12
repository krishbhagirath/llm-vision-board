import { useState } from 'react';
import { GitBranch, MessageCircleQuestion, Navigation } from 'lucide-react';
import { Button, TextArea, TextInput } from '@/components/Button';
import { attempt } from '@/components/toastStore';
import { createSampleWorkspace } from '@/samples/sampleWorkspace';
import { updateSettings } from '@/storage/db';
import { createWorkspace } from '@/features/workspaces/workspaceOps';
import { useUiStore } from '@/state/uiStore';
import { createNodeAndSelect } from './nodeActions';
import type { ID } from '@/types';

/** Three tiny node cards joined by connectors. Pure CSS/SVG, follows the theme tokens. */
function MiniMap() {
  const card = 'absolute flex h-[34px] w-[84px] flex-col justify-center gap-1 rounded-md border border-line-strong bg-card px-2 shadow-sm';
  const bar = (w: string, tone = 'bg-line-strong') => <span className={`block h-1 rounded-full ${tone}`} style={{ width: w }} />;
  return (
    <div aria-hidden className="relative mx-auto h-[96px] w-[240px]">
      <svg className="absolute inset-0" width="240" height="96" viewBox="0 0 240 96" fill="none">
        <path d="M92 48 C 120 48, 120 20, 148 20" stroke="var(--accent)" strokeWidth="1.75" />
        <path d="M92 48 C 120 48, 120 76, 148 76" stroke="var(--line-strong)" strokeWidth="1.5" />
      </svg>
      <div className={`${card} left-2 top-[31px] !border-accent`}>
        <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-accent" />
        {bar('60%', 'bg-fg/70')}
        {bar('80%')}
      </div>
      <div className={`${card} left-[148px] top-[3px]`}>
        {bar('70%', 'bg-fg/60')}
        {bar('50%')}
      </div>
      <div className={`${card} left-[148px] top-[59px]`}>
        {bar('55%', 'bg-fg/60')}
        {bar('75%')}
      </div>
    </div>
  );
}

const STEPS = [
  { icon: MessageCircleQuestion, title: 'Ask', text: 'Start with one question.' },
  { icon: GitBranch, title: 'Branch from any answer', text: 'Each branch keeps its own context.' },
  { icon: Navigation, title: 'Navigate the map', text: 'Jump around by tree, board or outline.' },
] as const;

export function WelcomeCard() {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    const ws = await attempt(() => createWorkspace(name));
    if (ws) {
      await updateSettings({ onboardingDone: true });
      useUiStore.getState().selectNode(null);
    }
    setBusy(false);
  };
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-xl flex-col items-center justify-center gap-7 px-6 py-10 text-center">
        <MiniMap />
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Turn long AI chats into a map of questions you can explore</h1>
          <p className="mx-auto max-w-md text-sm text-muted">Everything stays in this browser. Your ChatGPT session does the answering.</p>
        </div>
        <form
          className="flex w-full max-w-md flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void start();
          }}
        >
          <TextInput data-autofocus aria-label="Workspace name" placeholder="Name your first workspace" value={name} onChange={(e) => setName(e.target.value)} className="!h-10" />
          <Button type="submit" variant="primary" size="lg" loading={busy} className="shrink-0">
            Start a workspace
          </Button>
        </form>
        <Button
          variant="ghost"
          onClick={() =>
            void attempt(async () => {
              const ws = await createSampleWorkspace();
              await updateSettings({ lastWorkspaceId: ws.id, onboardingDone: true });
            })
          }
        >
          Explore a sample map
        </Button>
        <ol className="mt-2 grid w-full grid-cols-1 gap-4 border-t border-line pt-6 text-left sm:grid-cols-3" aria-label="How it works">
          {STEPS.map((s) => (
            <li key={s.title} className="flex gap-3 sm:flex-col sm:gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <s.icon size={16} />
              </span>
              <div>
                <div className="text-ui font-semibold">{s.title}</div>
                <div className="text-xs text-muted">{s.text}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

export function EmptyWorkspace({ workspaceId }: { workspaceId: ID }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (!q.trim() || busy) return;
    setBusy(true);
    const n = await createNodeAndSelect({ workspaceId, question: q, type: 'topic' });
    setBusy(false);
    if (n) {
      setQ('');
      useUiStore.getState().requestComposerFocus();
    }
  };
  return (
    <div className="grid h-full place-items-center overflow-y-auto p-6">
      <div className="w-full max-w-2xl space-y-5">
        <div className="space-y-1.5 text-center">
          <h2 className="text-2xl font-semibold tracking-tight">What do you want to understand?</h2>
          <p className="text-sm text-muted">This becomes the root of your map. You can branch from any answer later.</p>
        </div>
        <div className="rounded-xl border border-line-strong bg-card p-3 shadow-md focus-within:border-accent focus-within:ring-2 focus-within:ring-[var(--ring)]">
          <TextArea
            data-autofocus
            rows={4}
            aria-label="Your first question"
            value={q}
            placeholder="e.g. How does backpropagation work?"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void create();
              }
            }}
            className="!border-0 !bg-transparent !px-1 !text-base !shadow-none !ring-0 resize-none"
          />
          <div className="flex items-center justify-between pt-1">
            <span className="px-1 text-xs text-faint">Enter to start · Shift+Enter for a new line</span>
            <Button variant="primary" disabled={!q.trim()} loading={busy} onClick={() => void create()}>
              Start exploring
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
