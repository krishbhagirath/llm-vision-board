import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CornerDownLeft,
  Download,
  FileText,
  Folder,
  GitBranchPlus,
  History,
  Keyboard,
  LayoutDashboard,
  ListTree,
  MessageSquare,
  MessageSquareText,
  Plus,
  Search,
  Settings,
  SunMoon,
  Workflow,
} from 'lucide-react';
import { Kbd } from '@/components/Kbd';
import { SegmentedControl } from '@/components/SegmentedControl';
import { trapTab } from '@/components/floating';
import { attempt } from '@/components/toastStore';
import { highlightRanges, search, type SearchHit } from '@/features/search/search';
import { createNodeAndSelect, openNode, openWorkspace } from '@/features/graph/ui/nodeActions';
import { setLayout } from '@/features/workspaces/workspaceOps';
import { downloadWorkspace } from '@/features/workspaces/ui/dataActions';
import { useDebounced } from '@/features/context/ui/ContextIndicator';
import { useSettings } from '@/hooks/useSettings';
import { updateSettings } from '@/storage/db';
import { useUiStore } from '@/state/uiStore';
import type { GraphNode, LayoutMode, Workspace } from '@/types';
import { buildGroups, flatten, recentNodes, type PaletteCommand, type PaletteRow } from './paletteModel';

type Scope = 'current' | 'all';

function Highlighted({ text, query }: { text: string; query: string }) {
  const ranges = highlightRanges(text, query);
  if (!ranges.length) return <>{text}</>;
  const parts: ReactNode[] = [];
  let at = 0;
  ranges.forEach(([s, e], i) => {
    if (s > at) parts.push(text.slice(at, s));
    parts.push(
      <mark key={i} className="rounded-[3px] bg-[color-mix(in_srgb,var(--accent)_24%,transparent)] px-px font-semibold text-fg">
        {text.slice(s, e)}
      </mark>,
    );
    at = e;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts.map((p, i) => (typeof p === 'string' ? <Fragment key={`t${i}`}>{p}</Fragment> : p))}</>;
}

const ICON_CLS = 'h-4 w-4 shrink-0 text-muted';

interface Props {
  workspace: Workspace | undefined;
  nodes: GraphNode[];
}

export function SearchDialog({ workspace, nodes }: Props) {
  const close = useUiStore((s) => s.closeDialog);
  const openDialog = useUiStore((s) => s.openDialog);
  const navEntries = useUiStore((s) => s.navHistory.entries);
  const selectedId = useUiStore((s) => s.selectedNodeId);
  const settings = useSettings();
  const workspaceId = workspace?.id ?? null;

  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>(workspaceId ? 'current' : 'all');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const debounced = useDebounced(query, 150);
  const panel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);

  useEffect(() => {
    const prev = opener.current;
    return () => prev?.focus?.();
  }, []);

  useEffect(() => {
    const q = debounced.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    search(q, { workspaceId: scope === 'current' ? workspaceId : null }).then(
      (r) => {
        if (!cancelled) {
          setHits(r);
          setActive(0);
        }
      },
      () => !cancelled && setHits([]),
    );
    return () => {
      cancelled = true;
    };
  }, [debounced, scope, workspaceId]);

  const hasSelection = !!selectedId && nodes.some((n) => n.id === selectedId);
  const effectiveDark = settings ? (settings.theme === 'dark' || (settings.theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)) : false;

  // Command definitions: label/keywords for filtering, `run` + icon for execution.
  const commandDefs = useMemo(() => {
    const view = (layout: LayoutMode, label: string, icon: ReactNode, kw: string) => ({
      cmd: { id: `view-${layout}`, label: `Switch to ${label} view`, keywords: kw, disabled: !workspace } as PaletteCommand,
      icon,
      run: () => workspace && void attempt(() => setLayout(workspace.id, layout)),
    });
    return [
      { cmd: { id: 'new-workspace', label: 'New workspace', keywords: 'create' } as PaletteCommand, icon: <Plus className={ICON_CLS} />, run: () => openDialog({ kind: 'newWorkspace' }) },
      {
        cmd: { id: 'new-branch', label: 'New branch from selected', keywords: 'child question add', disabled: !workspace || !hasSelection } as PaletteCommand,
        icon: <GitBranchPlus className={ICON_CLS} />,
        run: () => {
          if (!workspace) return;
          void createNodeAndSelect({ workspaceId: workspace.id, parentId: selectedId, title: 'New question' }).then((n) => n && useUiStore.getState().requestComposerFocus());
        },
      },
      view('tree', 'Tree', <Workflow className={ICON_CLS} />, 'layout graph'),
      view('board', 'Board', <LayoutDashboard className={ICON_CLS} />, 'layout freeform'),
      view('outline', 'Outline', <ListTree className={ICON_CLS} />, 'layout list'),
      view('chat', 'Chat', <MessageSquareText className={ICON_CLS} />, 'layout thread'),
      {
        cmd: { id: 'theme', label: 'Toggle theme', keywords: 'dark light mode appearance' } as PaletteCommand,
        icon: <SunMoon className={ICON_CLS} />,
        run: () => void attempt(() => updateSettings({ theme: effectiveDark ? 'light' : 'dark' })),
      },
      { cmd: { id: 'settings', label: 'Open settings', keywords: 'preferences automation' } as PaletteCommand, icon: <Settings className={ICON_CLS} />, run: () => openDialog({ kind: 'settings' }) },
      {
        cmd: { id: 'export', label: 'Export workspace', keywords: 'download backup json', disabled: !workspace } as PaletteCommand,
        icon: <Download className={ICON_CLS} />,
        run: () => workspace && void downloadWorkspace(workspace),
      },
      { cmd: { id: 'shortcuts', label: 'Keyboard shortcuts', keywords: 'help keys' } as PaletteCommand, icon: <Keyboard className={ICON_CLS} />, run: () => openDialog({ kind: 'shortcuts' }) },
    ];
  }, [workspace, hasSelection, selectedId, effectiveDark, openDialog]);

  const commands = useMemo(() => commandDefs.map((d) => d.cmd).filter((c) => !c.disabled), [commandDefs]);
  const recents = useMemo(() => recentNodes(navEntries, nodes, selectedId), [navEntries, nodes, selectedId]);
  const groups = useMemo(() => buildGroups({ query, hits, commands, recents }), [query, hits, commands, recents]);
  const flat = useMemo(() => flatten(groups), [groups]);
  const activeIndex = Math.min(active, Math.max(0, flat.length - 1));

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, flat]);

  const choose = (row: PaletteRow | undefined) => {
    if (!row) return;
    close();
    if (row.type === 'recent') void openNode(row.nodeId);
    else if (row.type === 'command') commandDefs.find((d) => d.cmd.id === row.command.id)?.run();
    else if (row.hit.kind === 'workspace') {
      void openWorkspace(row.hit.workspaceId);
    } else void openNode(row.hit.nodeId);
  };

  const optionId = (key: string) => `pal-${key}`;
  const idx = (row: PaletteRow) => flat.indexOf(row);
  const trimmed = query.trim();
  const noResults = trimmed.length >= 2 && flat.length === 0 && debounced === query;

  const rowIcon = (row: PaletteRow): ReactNode => {
    if (row.type === 'recent') return <History className={ICON_CLS} />;
    if (row.type === 'command') return commandDefs.find((d) => d.cmd.id === row.command.id)?.icon;
    return row.hit.kind === 'workspace' ? <Folder className={ICON_CLS} /> : row.hit.kind === 'message' ? <FileText className={ICON_CLS} /> : <MessageSquare className={ICON_CLS} />;
  };

  return (
    <div
      className="anim-fade fixed inset-0 z-50 flex items-start justify-center bg-black/45 p-4 pt-[11vh]"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close();
        }
        trapTab(e, panel.current);
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        tabIndex={-1}
        className="anim-pop flex max-h-[min(560px,78vh)] w-full max-w-[600px] flex-col overflow-hidden rounded-xl border border-line bg-elevated shadow-lg"
      >
        <div className="flex items-center gap-2 border-b border-line px-3.5 transition-colors focus-within:border-accent">
          <Search size={16} aria-hidden className="shrink-0 text-faint" />
          <input
            data-autofocus
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="pal-list"
            aria-autocomplete="list"
            aria-activedescendant={flat[activeIndex] ? optionId(flat[activeIndex]!.key) : undefined}
            aria-label="Search or run a command"
            placeholder="Search questions, answers, workspaces, or run a command…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive(Math.min(flat.length - 1, activeIndex + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive(Math.max(0, activeIndex - 1));
              } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                choose(flat[activeIndex]);
              }
            }}
            className="h-12 min-w-0 flex-1 bg-transparent text-sm text-fg placeholder:text-faint focus:outline-none focus-visible:!outline-none"
          />
          <SegmentedControl<Scope>
            label="Search scope"
            size="sm"
            value={scope}
            onChange={setScope}
            options={[
              ...(workspaceId ? [{ value: 'current' as const, label: 'This workspace' }] : []),
              { value: 'all' as const, label: 'All' },
            ]}
          />
        </div>

        <div ref={list} id="pal-list" role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {noResults && <p className="px-3 py-8 text-center text-sm text-muted">Nothing matches “{trimmed}”{scope === 'current' && workspaceId ? '. Try All workspaces.' : '.'}</p>}
          {trimmed.length === 1 && <p className="px-3 py-2 text-xs text-muted">Keep typing: search starts at 2 characters.</p>}
          {groups.map((g) => (
            <div key={g.id} role="group" aria-label={g.label} className="pb-1">
              <div className="px-2.5 pb-1 pt-2 text-xs font-medium text-faint">{g.label}</div>
              {g.rows.map((row) => {
                const i = idx(row);
                const on = i === activeIndex;
                return (
                  <div
                    key={row.key}
                    id={optionId(row.key)}
                    role="option"
                    aria-selected={on}
                    onMouseMove={() => i !== active && setActive(i)}
                    onClick={() => choose(row)}
                    className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 ${on ? 'bg-accent-soft' : ''}`}
                  >
                    {rowIcon(row)}
                    <div className="min-w-0 flex-1">
                      {row.type === 'recent' && <div className="truncate text-ui font-medium">{row.title}</div>}
                      {row.type === 'command' && <div className="truncate text-ui font-medium">{row.command.label}</div>}
                      {row.type === 'hit' && (
                        <>
                          <div className="flex items-center gap-2">
                            <span className="truncate text-ui font-medium">
                              <Highlighted text={row.hit.nodeTitle} query={trimmed} />
                            </span>
                            {scope === 'all' && row.hit.kind !== 'workspace' && (
                              <span className="shrink-0 rounded-full bg-subtle px-1.5 text-[11px] leading-4 text-muted">{row.hit.workspaceName}</span>
                            )}
                          </div>
                          {row.hit.snippet && (
                            <div className="truncate text-xs text-muted">
                              <Highlighted text={row.hit.snippet} query={trimmed} />
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    {on && <CornerDownLeft size={13} aria-hidden className="shrink-0 text-faint" />}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 border-t border-line bg-subtle/50 px-3.5 py-2 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> move
          </span>
          <span className="inline-flex items-center gap-1">
            <Kbd>↵</Kbd> open
          </span>
          <span className="inline-flex items-center gap-1">
            <Kbd>Esc</Kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}

