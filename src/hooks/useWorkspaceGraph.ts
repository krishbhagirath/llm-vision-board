import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/storage/db';
import type { GraphEdge, GraphNode, ID, Workspace } from '@/types';

export interface WorkspaceGraph {
  workspace: Workspace | undefined;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Live workspace + nodes + edges. Returns undefined while loading. */
export function useWorkspaceGraph(workspaceId: ID | null | undefined): WorkspaceGraph | undefined {
  return useLiveQuery(
    async () => {
      if (!workspaceId) return { workspace: undefined, nodes: [], edges: [] };
      const [workspace, nodes, edges] = await Promise.all([
        db.workspaces.get(workspaceId),
        db.nodes.where('workspaceId').equals(workspaceId).toArray(),
        db.edges.where('workspaceId').equals(workspaceId).toArray(),
      ]);
      return { workspace, nodes, edges };
    },
    [workspaceId],
  );
}

/** Live list of workspaces, most recently updated first. */
export function useWorkspaces(): Workspace[] | undefined {
  return useLiveQuery(() => db.workspaces.orderBy('updatedAt').reverse().toArray(), []);
}
