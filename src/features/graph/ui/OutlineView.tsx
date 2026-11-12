import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Search, X } from 'lucide-react';
import { toggleCollapsed } from '@/features/graph/graphOps';
import { useNodeStatusMap, type NodeStatus } from '@/hooks/useNodeStatus';
import { useUiStore } from '@/state/uiStore';
import { EmptyState } from '@/components/EmptyState';
import type { GraphNode, ID } from '@/types';
import { StatusGlyph } from './StatusDot';
import { cardState } from './graphView';
import { buildRows, filterKeepAncestors, type OutlineRow } from './outlineModel';

export { buildRows, filterKeepAncestors, type OutlineRow };
export const ROW_H = 32;
const INDENT = 18;

const Row = memo(function Row({
  row,
  selected,
  matched,
  status,
  onSelect,
  compact,
  filtering,
}: {
  row: OutlineRow;
  selected: boolean;
  matched: boolean;
  status: NodeStatus | undefined;
  onSelect: (id: ID) => void;
  compact: boolean;
  filtering: boolean;
}) {
  const { node, depth, hasChildren } = row;
  const indent = compact ? 12 : INDENT;
  return (
    <div
      role="treeitem"
      aria-selected={selected}
      aria-level={depth + 1}
      aria-expanded={hasChildren ? !node.collapsed : undefined}
      style={{ height: ROW_H, paddingLeft: 8 + depth * indent }}
      onClick={() => onSelect(node.id)}
      className={`relative flex cursor-pointer items-center gap-1.5 pr-3 text-ui ${
        selected ? 'bg-accent-soft text-fg' : 'text-fg hover:bg-hover'
      }`}
    >
      {selected && <span aria-hidden className="absolute inset-y-1 left-0 w-0.5 rounded-r bg-accent" />}
      {Array.from({ length: depth }, (_, i) => (
        <span key={i} aria-hidden className="absolute inset-y-0 w-px bg-line" style={{ left: 8 + i * indent + 9 }} />
      ))}
      <button
        aria-label={node.collapsed ? 'Expand' : 'Collapse'}
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
          if (hasChildren) void toggleCollapsed(node.id);
        }}
        className={`relative flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted hover:bg-line ${hasChildren && !filtering ? '' : 'invisible'}`}
      >
        <ChevronRight size={13} className={node.collapsed ? '' : 'rotate-90'} style={{ transition: 'transform 120ms' }} />
      </button>
      <StatusGlyph state={cardState(node, status)} size={13} />
      <span className={`truncate ${selected || matched ? 'font-semibold' : 'font-medium'}`} title={node.title}>
        {node.title}
      </span>
      {!compact && node.answerPreview && <span className="min-w-0 flex-1 truncate text-xs text-muted">{node.answerPreview}</span>}
    </div>
  );
});

interface Props {
  nodes: GraphNode[];
  workspaceId: ID;
  compact?: boolean;
  /** Heights: container fills parent. */
  className?: string;
}

/** Virtualized, keyboard-navigable outline with a filter box. Selection lives in the UI store (persisted by the board). */
export function OutlineView({ nodes, workspaceId, compact = false, className = '' }: Props) {
  const selectedId = useUiStore((s) => s.selectedNodeId);
  const selectNode = useUiStore((s) => s.selectNode);
  const requestComposerFocus = useUiStore((s) => s.requestComposerFocus);
  const status = useNodeStatusMap(workspaceId);
  const [query, setQuery] = useState('');
  const filter = useMemo(() => filterKeepAncestors(nodes, query), [nodes, query]);
  const rows = useMemo(() => buildRows(nodes, filter), [nodes, filter]);
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, [rows.length === 0]);

  const selIndex = useMemo(() => rows.findIndex((r) => r.node.id === selectedId), [rows, selectedId]);
  useEffect(() => {
    const el = ref.current;
    if (!el || selIndex < 0) return;
    const top = selIndex * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight;
  }, [selIndex]);

  const overscan = 8;
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - overscan);
  const end = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_H) + overscan);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!rows.length) return;
    const i = selIndex < 0 ? 0 : selIndex;
    const cur = rows[i];
    if (!cur) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = rows[Math.min(rows.length - 1, selIndex < 0 ? 0 : i + 1)];
      if (next) selectNode(next.node.id);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = rows[Math.max(0, i - 1)];
      if (prev) selectNode(prev.node.id);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (cur.hasChildren && cur.node.collapsed && !filter) void toggleCollapsed(cur.node.id);
      else if (cur.hasChildren) {
        const child = rows[i + 1];
        if (child) selectNode(child.node.id);
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (cur.hasChildren && !cur.node.collapsed && !filter) void toggleCollapsed(cur.node.id);
      else if (cur.node.parentId) selectNode(cur.node.parentId);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      requestComposerFocus();
    }
  };

  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      {!compact && (
        <div className="relative shrink-0 border-b border-line bg-surface px-3 py-2">
          <Search size={14} aria-hidden className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-faint" />
          <input
            type="search"
            aria-label="Filter questions"
            placeholder="Filter questions…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.stopPropagation();
                setQuery('');
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                ref.current?.focus();
              }
            }}
            className="h-8 w-full rounded-md border border-line-strong bg-card pl-8 pr-8 text-ui placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-[var(--ring)] [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button aria-label="Clear filter" onClick={() => setQuery('')} className="absolute right-5 top-1/2 -translate-y-1/2 rounded text-muted hover:text-fg">
              <X size={14} />
            </button>
          )}
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyState title={filter ? 'No matching questions' : 'No nodes yet'} description={filter ? 'Try a different word, or clear the filter.' : undefined} />
      ) : (
        <div
          ref={ref}
          role="tree"
          tabIndex={0}
          aria-label="Outline"
          onKeyDown={onKeyDown}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          className="min-h-0 flex-1 overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
        >
          <div style={{ height: rows.length * ROW_H, position: 'relative' }}>
            <div style={{ position: 'absolute', top: start * ROW_H, left: 0, right: 0 }}>
              {rows.slice(start, end).map((r) => (
                <Row
                  key={r.node.id}
                  row={r}
                  selected={r.node.id === selectedId}
                  matched={!!filter?.matches.has(r.node.id)}
                  status={status.get(r.node.id)}
                  onSelect={selectNode}
                  compact={compact}
                  filtering={!!filter}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
