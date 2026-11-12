import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/storage/db';

const EMPTY: Record<string, number> = {};

/** Live node counts per workspace id (count queries only, no rows loaded). */
export function useWorkspaceCounts(): Record<string, number> {
  return (
    useLiveQuery(async () => {
      const ws = await db.workspaces.toArray();
      const counts = await Promise.all(ws.map((w) => db.nodes.where('workspaceId').equals(w.id).count()));
      return Object.fromEntries(ws.map((w, i) => [w.id, counts[i] ?? 0]));
    }, []) ?? EMPTY
  );
}
