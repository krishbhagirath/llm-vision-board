import { useEffect, useState } from 'react';
import { Lightbulb, X } from 'lucide-react';
import { useUiStore } from '@/state/uiStore';
import type { GraphNode } from '@/types';
import { HINT_TEXT, persistDismissed, pickHint, readDismissed, type HintId } from './hints';

/** One dismissible contextual hint at a time. Dismissals persist in localStorage. */
export function HintChip({ nodes }: { nodes: GraphNode[] }) {
  const selectedId = useUiStore((s) => s.selectedNodeId);
  const [dismissed, setDismissed] = useState<Set<string>>(readDismissed);
  const dismiss = (id: HintId) => {
    persistDismissed(id);
    setDismissed((d) => new Set(d).add(id));
  };
  // The "select a node" hint teaches by doing: it goes away on the first selection.
  useEffect(() => {
    if (selectedId && !dismissed.has('select-node')) dismiss('select-node');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const hint = pickHint(nodes, selectedId, dismissed);
  if (!hint) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center px-4">
      <div role="note" className="anim-pop pointer-events-auto flex items-center gap-2 rounded-full border border-line bg-elevated py-1 pl-3 pr-1.5 text-ui shadow-md">
        <Lightbulb size={14} className="shrink-0 text-accent" aria-hidden />
        <span>{HINT_TEXT[hint]}</span>
        <button aria-label="Dismiss hint" onClick={() => dismiss(hint)} className="flex h-6 w-6 items-center justify-center rounded-full text-muted hover:bg-hover hover:text-fg">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
