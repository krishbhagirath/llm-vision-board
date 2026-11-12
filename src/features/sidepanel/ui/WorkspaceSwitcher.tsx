import { Check, ChevronsUpDown } from 'lucide-react';
import { Menu } from '@/components/Menu';
import { attempt } from '@/components/toastStore';
import { updateSettings } from '@/storage/db';
import type { ID, Workspace } from '@/types';

/** Compact workspace picker for the side panel header. */
export function WorkspaceSwitcher({ workspaces, activeId }: { workspaces: Workspace[]; activeId: ID | null }) {
  const active = workspaces.find((w) => w.id === activeId);
  return (
    <Menu
      label="Switch workspace"
      align="left"
      triggerClassName="!h-8 min-w-0 max-w-full gap-1.5 px-2 text-fg"
      trigger={
        <>
          <span className="min-w-0 truncate text-sm font-semibold">{active?.name ?? 'No workspace'}</span>
          <ChevronsUpDown size={13} aria-hidden className="shrink-0 text-faint" />
        </>
      }
      items={workspaces.map((w) => ({
        label: w.name,
        icon: w.id === activeId ? <Check /> : undefined,
        onSelect: () => void attempt(() => updateSettings({ lastWorkspaceId: w.id })),
      }))}
    />
  );
}
