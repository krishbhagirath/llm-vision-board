import type { GraphNode, ID } from '@/types';

export type HintId = 'select-node' | 'branch-from-text';

export const HINT_TEXT: Record<HintId, string> = {
  'select-node': 'Select a node to open its conversation.',
  'branch-from-text': 'Tip: highlight any text in an answer to branch from it.',
};

/** Pure: which contextual hint (if any) to show right now. At most one at a time, in teaching order. */
export function pickHint(
  nodes: readonly (Pick<GraphNode, 'answeredAt'> & Partial<Pick<GraphNode, 'sourcePassage'>>)[],
  selectedId: ID | null,
  dismissed: ReadonlySet<string>,
): HintId | null {
  if (nodes.length === 0) return null;
  if (!dismissed.has('select-node') && selectedId === null) return 'select-node';
  // Once the user has branched from a passage, they know the feature: stop teaching it.
  const learnedBranching = nodes.some((n) => !!n.sourcePassage);
  if (!dismissed.has('branch-from-text') && !learnedBranching && selectedId !== null && nodes.some((n) => n.answeredAt !== null)) return 'branch-from-text';
  return null;
}

const KEY = (id: string) => `lvb.hint.${id}`;

export function readDismissed(): Set<string> {
  const out = new Set<string>();
  for (const id of Object.keys(HINT_TEXT)) {
    try {
      if (localStorage.getItem(KEY(id)) === '1') out.add(id);
    } catch {
      /* storage unavailable: hints just reappear */
    }
  }
  return out;
}

export function persistDismissed(id: HintId): void {
  try {
    localStorage.setItem(KEY(id), '1');
  } catch {
    /* ignore */
  }
}
