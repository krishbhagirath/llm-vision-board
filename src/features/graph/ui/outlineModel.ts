import { childrenIndex } from '@/features/graph/graphOps';
import type { GraphNode, ID } from '@/types';

export interface OutlineRow {
  node: GraphNode;
  depth: number;
  hasChildren: boolean;
}

/**
 * Ids to show for a filter query: every node whose title/question matches, plus all of its ancestors
 * (so matches keep their context). Returns null for an empty query (= no filtering).
 */
export function filterKeepAncestors(nodes: readonly GraphNode[], query: string): { visible: Set<ID>; matches: Set<ID> } | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const matches = new Set<ID>();
  const visible = new Set<ID>();
  for (const n of nodes) {
    if (n.title.toLowerCase().includes(q) || n.question.toLowerCase().includes(q)) {
      matches.add(n.id);
      let cur: GraphNode | undefined = n;
      while (cur && !visible.has(cur.id)) {
        visible.add(cur.id);
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
    }
  }
  return { visible, matches };
}

/**
 * Flatten the tree into rows. Collapsed subtrees are skipped unless `filter` is given, in which case only
 * filter.visible nodes are listed and collapse state is ignored (so matches are never hidden).
 */
export function buildRows(nodes: readonly GraphNode[], filter?: { visible: Set<ID> } | null): OutlineRow[] {
  const idx = childrenIndex(nodes);
  const rows: OutlineRow[] = [];
  const walk = (n: GraphNode, depth: number, seen: Set<ID>) => {
    if (seen.has(n.id)) return;
    if (filter && !filter.visible.has(n.id)) return;
    seen.add(n.id);
    const kids = (idx.get(n.id) ?? []).filter((k) => !filter || filter.visible.has(k.id));
    rows.push({ node: n, depth, hasChildren: kids.length > 0 });
    if (filter || !n.collapsed) for (const k of kids) walk(k, depth + 1, seen);
  };
  const seen = new Set<ID>();
  for (const r of idx.get(null) ?? []) walk(r, 0, seen);
  return rows;
}
