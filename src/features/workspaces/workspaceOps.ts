import { db, updateSettings } from '@/storage/db';
import { newId, now } from '@/lib/id';
import { DEFAULT_WORKSPACE_SETTINGS, type ID, type LayoutMode, type Workspace, type WorkspaceSettings } from '@/types';

export async function createWorkspace(name: string, description = ''): Promise<Workspace> {
  const t = now();
  const ws: Workspace = {
    id: newId(),
    name: name.trim() || 'Untitled workspace',
    description,
    createdAt: t,
    updatedAt: t,
    layout: 'tree',
    settings: { ...DEFAULT_WORKSPACE_SETTINGS },
    selectedNodeId: null,
  };
  await db.workspaces.add(ws);
  await updateSettings({ lastWorkspaceId: ws.id });
  return ws;
}

export async function renameWorkspace(id: ID, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  await db.workspaces.update(id, { name: trimmed, updatedAt: now() });
}

export async function updateWorkspace(
  id: ID,
  patch: Partial<Pick<Workspace, 'description' | 'layout' | 'selectedNodeId'>> & { settings?: Partial<WorkspaceSettings> },
): Promise<void> {
  await db.transaction('rw', db.workspaces, async () => {
    const ws = await db.workspaces.get(id);
    if (!ws) return;
    const { settings, ...rest } = patch;
    await db.workspaces.put({ ...ws, ...rest, settings: { ...ws.settings, ...(settings ?? {}) } });
  });
}

export async function setLayout(id: ID, layout: LayoutMode): Promise<void> {
  await updateWorkspace(id, { layout });
}

/** Removes the workspace and every row that belongs to it. */
export async function deleteWorkspace(id: ID): Promise<void> {
  await db.transaction(
    'rw',
    [db.workspaces, db.nodes, db.edges, db.conversations, db.messages, db.snapshots, db.requests],
    async () => {
      await db.nodes.where('workspaceId').equals(id).delete();
      await db.edges.where('workspaceId').equals(id).delete();
      await db.conversations.where('workspaceId').equals(id).delete();
      await db.messages.where('workspaceId').equals(id).delete();
      await db.snapshots.where('workspaceId').equals(id).delete();
      const reqs = await db.requests.filter((r) => r.workspaceId === id).toArray();
      for (const r of reqs) {
        if (r.status === 'queued' || r.status === 'dispatching' || r.status === 'submitted' || r.status === 'streaming') {
          await db.requests.update(r.id, { status: 'cancelled', error: 'Workspace deleted', updatedAt: now() });
        }
      }
      await db.workspaces.delete(id);
    },
  );
}

export async function listWorkspaces(): Promise<Workspace[]> {
  return db.workspaces.orderBy('updatedAt').reverse().toArray();
}
