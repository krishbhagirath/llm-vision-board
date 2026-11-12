import { useSettings } from './useSettings';
import { useWorkspaces } from './useWorkspaceGraph';
import type { ID, Workspace } from '@/types';

/** Active workspace id = settings.lastWorkspaceId if it still exists, else the most recent workspace. */
export function useActiveWorkspaceId(): { loading: boolean; workspaces: Workspace[]; activeId: ID | null } {
  const settings = useSettings();
  const workspaces = useWorkspaces();
  if (!settings || !workspaces) return { loading: true, workspaces: [], activeId: null };
  const found = workspaces.find((w) => w.id === settings.lastWorkspaceId);
  return { loading: false, workspaces, activeId: found?.id ?? workspaces[0]?.id ?? null };
}
