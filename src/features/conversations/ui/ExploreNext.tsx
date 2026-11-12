import { useMemo } from 'react';
import { Plus } from 'lucide-react';
import { suggestFollowUps } from '@/features/suggestions/heuristics';
import { createNodeAndSelect } from '@/features/graph/ui/nodeActions';
import type { GraphNode, Message } from '@/types';

/**
 * "Explore next": rule-based chips built from the latest answer's headings and bold terms (no AI involved).
 * Clicking creates a child branch with that question and opens it. Nothing is sent automatically.
 */
export function ExploreNext({ node, answer, childTitles }: { node: GraphNode; answer: Message; childTitles: string[] }) {
  const key = childTitles.join('|');
  const suggestions = useMemo(
    () => suggestFollowUps(answer.content, [...childTitles, node.title]),
    [answer.content, key, node.title], // eslint-disable-line react-hooks/exhaustive-deps
  );
  if (!suggestions.length) return null;
  return (
    <section aria-label="Explore next" className="space-y-2 border-t border-line pt-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h3 className="text-xs font-semibold text-fg">Explore next</h3>
        <span className="text-[11px] text-faint">suggested from headings &amp; bold terms</span>
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {suggestions.map((s) => (
          <li key={s.question} className="max-w-full">
            <button
              type="button"
              title={s.question}
              aria-label={`New branch: ${s.question}`}
              onClick={() => void createNodeAndSelect({ workspaceId: node.workspaceId, parentId: node.id, question: s.question, title: s.term })}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-card px-2.5 py-1 text-xs text-fg transition-colors hover:border-accent hover:bg-accent-soft"
            >
              <Plus size={12} aria-hidden className="shrink-0 text-accent" />
              <span className="truncate">{s.term}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
