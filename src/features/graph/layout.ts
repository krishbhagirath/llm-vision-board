import dagre from '@dagrejs/dagre';
import type { GraphNode, ID, Position } from '@/types';

export const NODE_WIDTH = 260;
export const NODE_HEIGHT = 84;

/**
 * Deterministic hierarchical layout (dagre). Pure function: takes domain nodes,
 * returns positions. Does not mutate stored positions, so switching layouts never
 * loses the freeform board arrangement.
 */
export function computeTreeLayout(nodes: readonly GraphNode[], direction: 'TB' | 'LR' = 'LR'): Map<ID, Position> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: direction, nodesep: direction === 'LR' ? 24 : 40, ranksep: direction === 'LR' ? 90 : 70, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  const ids = new Set(nodes.map((n) => n.id));
  const sorted = [...nodes].sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
  for (const n of sorted) g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const n of sorted) if (n.parentId && ids.has(n.parentId)) g.setEdge(n.parentId, n.id);
  dagre.layout(g);
  const out = new Map<ID, Position>();
  for (const n of sorted) {
    const p = g.node(n.id) as { x: number; y: number } | undefined;
    if (p) out.set(n.id, { x: p.x - NODE_WIDTH / 2, y: p.y - NODE_HEIGHT / 2 });
  }
  return out;
}
