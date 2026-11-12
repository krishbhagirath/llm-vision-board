import type { GraphNode, ID } from '@/types';

export interface Crumb {
  /** Node id; null for the workspace crumb. */
  id: ID | null;
  label: string;
}

export interface BreadcrumbModel {
  head: Crumb[];
  /** Middle segments folded into an ellipsis menu (empty when the path is short). */
  collapsed: Crumb[];
  tail: Crumb[];
}

/**
 * Workspace > root > ... > current. When there are more than `maxSegments` segments the middle ones
 * are folded: workspace, root, "…", parent, current.
 */
export function buildBreadcrumb(workspaceName: string, path: readonly GraphNode[], maxSegments = 5): BreadcrumbModel {
  const all: Crumb[] = [{ id: null, label: workspaceName }, ...path.map((n) => ({ id: n.id, label: n.title }))];
  if (all.length <= maxSegments) return { head: all, collapsed: [], tail: [] };
  return { head: all.slice(0, 2), collapsed: all.slice(2, all.length - 2), tail: all.slice(-2) };
}
