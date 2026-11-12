import { useState } from 'react';
import { Button, Field, TextArea, TextInput, Toggle } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { Kbd } from '@/components/Kbd';
import { SegmentedControl } from '@/components/SegmentedControl';
import { formatShortcut } from '@/components/floating';
import { Monitor, Moon, Sun } from 'lucide-react';
import { attempt } from '@/components/toastStore';
import { updateSettings } from '@/storage/db';
import { createWorkspace, updateWorkspace } from '@/features/workspaces/workspaceOps';
import { useSettings } from '@/hooks/useSettings';
import { useUiStore } from '@/state/uiStore';
import type { AppSettings, Workspace } from '@/types';

export const AUTOMATION_DISCLOSURE =
  "When on, pressing Send types your prompt into your open ChatGPT tab and clicks Send for you, then reads the visible reply. Nothing is sent without you pressing Send. Relies on ChatGPT's page layout and may break.";

export function AutomationToggle({ settings }: { settings: AppSettings }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-line bg-subtle/50 p-3">
      <div className="space-y-1">
        <div className="text-sm font-medium">ChatGPT automation (experimental)</div>
        <p className="text-xs text-muted">{AUTOMATION_DISCLOSURE}</p>
      </div>
      <Toggle
        label="ChatGPT automation (experimental)"
        checked={settings.chatgptAutomation}
        onChange={(v) => void attempt(() => updateSettings({ chatgptAutomation: v }))}
      />
    </div>
  );
}

export const SOFT_NAV_DISCLOSURE =
  "Clicks ChatGPT's own New chat / sidebar link instead of reloading the tab. Falls back to a reload whenever it can't confirm the switch safely. Experimental.";

export function SoftNavigationToggle({ settings }: { settings: AppSettings }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-line bg-subtle/50 p-3">
      <div className="space-y-1">
        <div className="text-sm font-medium">Switch ChatGPT conversations without reloading</div>
        <p className="text-xs text-muted">{SOFT_NAV_DISCLOSURE}</p>
      </div>
      <Toggle
        label="Switch ChatGPT conversations without reloading"
        checked={settings.softNavigation}
        onChange={(v) => void attempt(() => updateSettings({ softNavigation: v }))}
      />
    </div>
  );
}

function NumberField({ label, hint, value, min, onCommit }: { label: string; hint: string; value: number; min: number; onCommit: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  return (
    <Field label={label} hint={hint}>
      <TextInput
        type="number"
        min={min}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const n = Number(text);
          if (Number.isFinite(n) && n >= min) onCommit(Math.round(n));
          else setText(String(value));
        }}
      />
    </Field>
  );
}

export function AppSettingsDialog() {
  const close = useUiStore((s) => s.closeDialog);
  const settings = useSettings();
  if (!settings) return null;
  return (
    <Dialog title="Settings" onClose={close} footer={<Button onClick={close}>Done</Button>}>
      <div className="space-y-1.5">
        <div className="text-xs font-medium text-muted">Theme</div>
        <SegmentedControl<AppSettings['theme']>
          label="Theme"
          value={settings.theme}
          onChange={(v) => void attempt(() => updateSettings({ theme: v }))}
          options={[
            { value: 'system', label: 'System', icon: <Monitor /> },
            { value: 'light', label: 'Light', icon: <Sun /> },
            { value: 'dark', label: 'Dark', icon: <Moon /> },
          ]}
        />
      </div>
      <AutomationToggle settings={settings} />
      <SoftNavigationToggle settings={settings} />
      <NumberField
        label="Request timeout (seconds)"
        hint="How long to wait without any progress from ChatGPT before a request is marked failed."
        value={settings.requestTimeoutSec}
        min={10}
        onCommit={(n) => void attempt(() => updateSettings({ requestTimeoutSec: n }))}
      />
      <NumberField
        label="Handoff suggestion threshold (approx. tokens)"
        hint="A handoff is suggested when a conversation has sent roughly this many tokens (an estimate, ~4 characters per token)."
        value={settings.handoffSuggestTokens}
        min={1000}
        onCommit={(n) => void attempt(() => updateSettings({ handoffSuggestTokens: n }))}
      />
    </Dialog>
  );
}

export function NewWorkspaceDialog() {
  const close = useUiStore((s) => s.closeDialog);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const create = async () => {
    const ws = await attempt(() => createWorkspace(name, desc));
    if (ws) {
      void updateSettings({ onboardingDone: true });
      useUiStore.getState().selectNode(null);
      useUiStore.getState().requestFit();
      close();
    }
  };
  return (
    <Dialog
      title="New workspace"
      onClose={close}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" onClick={() => void create()}>
            Create
          </Button>
        </>
      }
    >
      <Field label="Name">
        <TextInput
          value={name}
          placeholder="e.g. Linear algebra"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void create()}
        />
      </Field>
      <Field label="Description / goal (optional)" hint="Included as context in the first prompt of each branch.">
        <TextArea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What are you trying to learn or figure out?" />
      </Field>
    </Dialog>
  );
}

export function WorkspaceSettingsDialog({ workspace }: { workspace: Workspace | undefined }) {
  const close = useUiStore((s) => s.closeDialog);
  const [desc, setDesc] = useState(workspace?.description ?? '');
  if (!workspace) return null;
  const save = async () => {
    if (desc !== workspace.description) await attempt(() => updateWorkspace(workspace.id, { description: desc }));
    close();
  };
  return (
    <Dialog
      title={`Workspace settings - ${workspace.name}`}
      onClose={close}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <Field label="Description / goal">
        <TextArea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} />
      </Field>
      <div className="space-y-1.5">
        <div className="text-xs font-medium text-muted">Tree direction</div>
        <SegmentedControl<'LR' | 'TB'>
          label="Tree direction"
          value={workspace.settings.treeDirection}
          onChange={(v) => void attempt(() => updateWorkspace(workspace.id, { settings: { treeDirection: v } }))}
          options={[
            { value: 'LR', label: 'Left to right' },
            { value: 'TB', label: 'Top to bottom' },
          ]}
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm">Show minimap</span>
        <Toggle label="Show minimap" checked={workspace.settings.showMinimap} onChange={(v) => void attempt(() => updateWorkspace(workspace.id, { settings: { showMinimap: v } }))} />
      </div>
    </Dialog>
  );
}

const SHORTCUTS: Array<{ group: string; items: Array<[string, string]> }> = [
  {
    group: 'Anywhere',
    items: [
      ['Mod+K', 'Open the command palette: search, jump, run commands'],
      ['Alt+B', 'Branch from the text selected in an answer'],
      ['Alt+1 / 2 / 3 / 4', 'Switch view: Tree, Board, Outline, Chat'],
      ['Alt+Left / Alt+Right', 'Go back / forward through selected nodes'],
      ['Alt+N', 'New child of the selected node (or a new root)'],
      ['F2', 'Rename the selected node'],
      ['Delete', 'Delete the selected node and its branch (asks first)'],
      ['Mod+Z', 'Undo the last rename, move, layout change or branch delete (until the page is reloaded)'],
      ['Escape', 'Close dialogs, then deselect'],
      ['?', 'Show this help'],
    ],
  },
  {
    group: 'Tree and Board canvas',
    items: [
      ['Arrow keys', 'Move to parent, first child or neighbouring sibling'],
      ['Enter', 'Focus the message composer'],
      ['Space', 'Collapse or expand the selected branch'],
    ],
  },
  {
    group: 'Outline',
    items: [
      ['Up / Down', 'Move between rows'],
      ['Right / Left', 'Expand or enter / collapse or go to parent'],
      ['Enter', 'Focus the message composer'],
    ],
  },
];

export function ShortcutsDialog() {
  const close = useUiStore((s) => s.closeDialog);
  return (
    <Dialog title="Keyboard shortcuts" onClose={close} footer={<Button onClick={close}>Close</Button>}>
      <div className="space-y-5">
        {SHORTCUTS.map((g) => (
          <section key={g.group} aria-label={g.group}>
            <h3 className="mb-2 text-xs font-semibold text-muted">{g.group}</h3>
            <dl className="grid grid-cols-[minmax(0,auto)_1fr] items-center gap-x-4 gap-y-2 text-ui">
              {g.items.map(([k, d]) => (
                <div key={k} className="contents">
                  <dt className="flex flex-wrap gap-1">
                    {k.split(' / ').map((part) => (
                      <Kbd key={part}>{formatShortcut(part)}</Kbd>
                    ))}
                  </dt>
                  <dd className="text-muted">{d}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <p className="text-xs text-faint">Ctrl+N is not used because the browser reserves it for a new window.</p>
      </div>
    </Dialog>
  );
}
