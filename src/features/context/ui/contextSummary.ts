import type { ContextItem } from '@/features/context/contextBuilder';
import { formatTokenEstimate } from '@/features/context/tokens';

/** Pure text for the context indicator above the composer. Token numbers are always labelled as estimates. */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export interface ContextBreakdown {
  ancestors: ContextItem[];
  passage: ContextItem | null;
  linked: ContextItem[];
  handoff: ContextItem | null;
  workspace: ContextItem | null;
}

export function breakdown(items: readonly ContextItem[]): ContextBreakdown {
  return {
    ancestors: items.filter((i) => i.kind === 'ancestor'),
    passage: items.find((i) => i.kind === 'source-passage') ?? null,
    linked: items.filter((i) => i.kind === 'linked'),
    handoff: items.find((i) => i.kind === 'handoff') ?? null,
    workspace: items.find((i) => i.kind === 'workspace') ?? null,
  };
}

/** "Inherits context from 3 ancestors + selected passage" (first turn) or "Continues this ChatGPT conversation". */
export function describeContext(items: readonly ContextItem[] | null, firstTurn: boolean): string {
  if (!firstTurn) return 'Continues this ChatGPT conversation';
  const b = breakdown(items ?? []);
  const parts: string[] = [];
  if (b.ancestors.length) parts.push(`Inherits context from ${plural(b.ancestors.length, 'ancestor')}`);
  if (b.passage) parts.push('selected passage');
  if (b.linked.length) parts.push(plural(b.linked.length, 'linked concept'));
  if (b.handoff) parts.push('handoff summary');
  if (b.workspace) parts.push('workspace goal');
  if (!parts.length) return 'No earlier context to include';
  const [first, ...rest] = parts;
  const lead = first!.startsWith('Inherits') ? first! : `Inherits context from ${first}`;
  return [lead, ...rest].join(' + ');
}

export function contextLine(items: readonly ContextItem[] | null, firstTurn: boolean, promptTokens: number): string {
  const base = describeContext(items, firstTurn);
  return promptTokens > 0 ? `${base} · ${formatTokenEstimate(promptTokens)}` : base;
}
