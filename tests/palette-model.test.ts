import { describe, expect, it } from 'vitest';
import { buildGroups, filterCommands, flatten, recentNodes, type PaletteCommand } from '@/features/search/ui/paletteModel';
import type { SearchHit } from '@/features/search/search';
import type { GraphNode } from '@/types';

const node = (id: string, title: string): GraphNode => ({ id, title }) as GraphNode;
const hit = (kind: SearchHit['kind'], nodeId: string): SearchHit => ({
  workspaceId: 'w',
  workspaceName: 'W',
  nodeId,
  nodeTitle: nodeId,
  kind,
  field: kind === 'message' ? 'answer' : kind === 'workspace' ? 'workspace' : 'title',
  snippet: '',
  score: 1,
  updatedAt: 1,
});
const commands: PaletteCommand[] = [
  { id: 'settings', label: 'Open settings', keywords: 'preferences' },
  { id: 'theme', label: 'Toggle theme', keywords: 'dark light' },
  { id: 'export', label: 'Export workspace' },
];

describe('recentNodes', () => {
  it('returns newest first, de-duplicated, without the current or deleted nodes', () => {
    const nodes = [node('a', 'A'), node('b', 'B'), node('c', 'C')];
    const r = recentNodes(['a', 'b', 'gone', 'a', 'c'], nodes, 'c');
    expect(r.map((x) => x.id)).toEqual(['a', 'b']);
  });
  it('respects the limit', () => {
    const nodes = ['a', 'b', 'c', 'd'].map((i) => node(i, i));
    expect(recentNodes(['a', 'b', 'c', 'd'], nodes, null, 2).map((x) => x.id)).toEqual(['d', 'c']);
  });
});

describe('filterCommands', () => {
  it('matches labels and keywords, case-insensitively', () => {
    expect(filterCommands(commands, 'theme').map((c) => c.id)).toEqual(['theme']);
    expect(filterCommands(commands, 'DARK').map((c) => c.id)).toEqual(['theme']);
    expect(filterCommands(commands, 'prefs')).toEqual([]);
    expect(filterCommands(commands, 'preferences').map((c) => c.id)).toEqual(['settings']);
    expect(filterCommands(commands, '')).toHaveLength(3);
  });
});

describe('buildGroups', () => {
  it('empty query shows Recent then all Commands', () => {
    const g = buildGroups({ query: '', hits: [], commands, recents: [{ id: 'a', title: 'A' }] });
    expect(g.map((x) => x.id)).toEqual(['recent', 'commands']);
    expect(flatten(g)).toHaveLength(4);
  });
  it('omits Recent when there is no history', () => {
    expect(buildGroups({ query: '', hits: [], commands, recents: [] }).map((x) => x.id)).toEqual(['commands']);
  });
  it('groups hits as Questions, Answers, Workspaces, then matching Commands, skipping empty groups', () => {
    const hits = [hit('message', 'm'), hit('node', 'n'), hit('workspace', 'w')];
    const g = buildGroups({ query: 'theme', hits, commands, recents: [] });
    expect(g.map((x) => x.id)).toEqual(['questions', 'answers', 'workspaces', 'commands']);
    expect(g[3]!.rows).toHaveLength(1);
    const none = buildGroups({ query: 'zzz', hits: [], commands, recents: [] });
    expect(none).toEqual([]);
  });
});
