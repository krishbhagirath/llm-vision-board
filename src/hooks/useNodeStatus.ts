import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/storage/db';
import type { ID } from '@/types';

export type NodeStatus = 'pending' | 'streaming' | 'failed';
type Row = [ID, NodeStatus];
const EMPTY: Row[] = [];

/** Cheap per-node status map from active/failed provider requests (no message content loaded). */
export function useNodeStatusMap(workspaceId: ID | null | undefined): ReadonlyMap<ID, NodeStatus> {
  const rows = useLiveQuery(
    async (): Promise<Row[]> => {
      if (!workspaceId) return EMPTY;
      const out = new Map<ID, NodeStatus>();
      const active = await db.requests
        .where('status')
        .anyOf('queued', 'dispatching', 'submitted', 'streaming')
        .filter((r) => r.workspaceId === workspaceId)
        .toArray();
      for (const r of active) out.set(r.nodeId, r.status === 'streaming' ? 'streaming' : 'pending');
      const failed = await db.requests
        .where('status')
        .anyOf('failed', 'interrupted')
        .filter((r) => r.workspaceId === workspaceId)
        .toArray();
      if (failed.length) {
        const msgs = await db.messages.bulkGet(failed.map((r) => r.assistantMessageId));
        failed.forEach((r, i) => {
          const m = msgs[i];
          if (m && (m.status === 'failed' || m.status === 'interrupted') && !out.has(r.nodeId)) out.set(r.nodeId, 'failed');
        });
      }
      return [...out.entries()];
    },
    [workspaceId],
    EMPTY,
  );
  return useMemo(() => new Map(rows), [rows]);
}
