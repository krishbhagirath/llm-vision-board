import type { SearchHit } from '@/features/search/search';
import { matchKind } from '@/features/search/search';
import type { GraphNode, ID } from '@/types';

/** Pure model for the command palette: which rows show, in which groups, in navigation order. */

export interface PaletteCommand {
  id: string;
  label: string;
  /** Extra words that should also find this command. */
  keywords?: string;
  disabled?: boolean;
}

export type PaletteRow =
  | { type: 'recent'; key: string; nodeId: ID; title: string }
  | { type: 'hit'; key: string; hit: SearchHit }
  | { type: 'command'; key: string; command: PaletteCommand };

export interface PaletteGroup {
  id: 'recent' | 'questions' | 'answers' | 'workspaces' | 'commands';
  label: string;
  rows: PaletteRow[];
}

/** Most recently visited nodes first, no duplicates, skipping the current one and nodes that no longer exist. */
export function recentNodes(entries: readonly ID[], nodes: readonly GraphNode[], currentId: ID | null, limit = 6): Array<{ id: ID; title: string }> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<ID>();
  const out: Array<{ id: ID; title: string }> = [];
  for (let i = entries.length - 1; i >= 0 && out.length < limit; i--) {
    const id = entries[i]!;
    const n = byId.get(id);
    if (!n || id === currentId || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, title: n.title });
  }
  return out;
}

/** Commands whose label or keywords match the query (every word must match). */
export function filterCommands(commands: readonly PaletteCommand[], query: string): PaletteCommand[] {
  const q = query.trim();
  if (!q) return [...commands];
  return commands.filter((c) => matchKind(`${c.label} ${c.keywords ?? ''}`, q) !== null);
}

export function buildGroups(opts: {
  query: string;
  hits: readonly SearchHit[];
  commands: readonly PaletteCommand[];
  recents: ReadonlyArray<{ id: ID; title: string }>;
}): PaletteGroup[] {
  const { query, hits, commands, recents } = opts;
  const groups: PaletteGroup[] = [];
  const cmdRows = (list: readonly PaletteCommand[]): PaletteRow[] => list.map((command) => ({ type: 'command', key: `cmd-${command.id}`, command }));
  if (!query.trim()) {
    if (recents.length) groups.push({ id: 'recent', label: 'Recent', rows: recents.map((r) => ({ type: 'recent', key: `recent-${r.id}`, nodeId: r.id, title: r.title })) });
    groups.push({ id: 'commands', label: 'Commands', rows: cmdRows(commands) });
    return groups;
  }
  const rows = (kind: SearchHit['kind']): PaletteRow[] => hits.filter((h) => h.kind === kind).map((hit) => ({ type: 'hit', key: `${kind}-${hit.workspaceId}-${hit.nodeId}`, hit }));
  const add = (id: PaletteGroup['id'], label: string, r: PaletteRow[]) => r.length && groups.push({ id, label, rows: r });
  add('questions', 'Questions', rows('node'));
  add('answers', 'Answers', rows('message'));
  add('workspaces', 'Workspaces', rows('workspace'));
  add('commands', 'Commands', cmdRows(filterCommands(commands, query)));
  return groups;
}

export const flatten = (groups: readonly PaletteGroup[]): PaletteRow[] => groups.flatMap((g) => g.rows);
