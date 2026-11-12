import { CornerLeftUp } from 'lucide-react';
import { useUiStore } from '@/state/uiStore';
import type { GraphNode } from '@/types';

/** The passage (or answer) this branch grew from, with a link back to the parent node. */
export function SourceQuote({ node, parent, compact = false }: { node: GraphNode; parent: GraphNode | undefined; compact?: boolean }) {
  const selectNode = useUiStore((s) => s.selectNode);
  const requestFocusNode = useUiStore((s) => s.requestFocusNode);
  if (!node.sourcePassage && !node.sourceMessageId) return null;
  const link = parent ? (
    <button
      type="button"
      onClick={() => {
        selectNode(parent.id);
        requestFocusNode(parent.id);
      }}
      className="inline-flex max-w-full items-center gap-1 rounded text-xs font-medium text-accent hover:underline"
    >
      <CornerLeftUp size={12} aria-hidden className="shrink-0" />
      <span className="truncate">from {parent.title}</span>
    </button>
  ) : null;

  if (!node.sourcePassage) {
    return <div className="flex">{link ?? <span className="text-xs text-muted">Branched from an answer</span>}</div>;
  }
  return (
    <figure className="space-y-1.5">
      <blockquote
        className={`rounded-md border-l-[3px] border-accent bg-accent-soft/60 px-3 py-2 text-sm leading-6 text-fg ${compact ? 'max-h-24' : 'max-h-40'} overflow-y-auto whitespace-pre-wrap break-words`}
      >
        {node.sourcePassage}
      </blockquote>
      {link && <figcaption>{link}</figcaption>}
    </figure>
  );
}
