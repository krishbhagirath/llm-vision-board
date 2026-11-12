import { useMemo } from 'react';
import { ChevronLeft, ChevronRight, LayoutDashboard, ListTree, MessageSquareText, MoreHorizontal, PanelRightOpen, Workflow } from 'lucide-react';
import { IconButton } from '@/components/Button';
import { Menu } from '@/components/Menu';
import { SegmentedControl, type SegmentOption } from '@/components/SegmentedControl';
import { attempt } from '@/components/toastStore';
import { ancestorChain } from '@/features/graph/graphOps';
import { ProviderStatusBar } from '@/features/provider/ui/ProviderStatusBar';
import { setLayout } from '@/features/workspaces/workspaceOps';
import { useElementWidth, useViewportWidth } from '@/hooks/useViewport';
import { useUiStore } from '@/state/uiStore';
import { stepHistory } from '@/state/navHistory';
import type { GraphNode, LayoutMode, Workspace } from '@/types';
import { buildBreadcrumb, type Crumb } from './breadcrumb';

const VIEWS: Array<SegmentOption<LayoutMode>> = [
  { value: 'tree', label: 'Tree', icon: <Workflow />, shortcut: 'Alt+1' },
  { value: 'board', label: 'Board', icon: <LayoutDashboard />, shortcut: 'Alt+2' },
  { value: 'outline', label: 'Outline', icon: <ListTree />, shortcut: 'Alt+3' },
  { value: 'chat', label: 'Chat', icon: <MessageSquareText />, shortcut: 'Alt+4' },
];

function Sep() {
  return <ChevronRight size={14} aria-hidden className="shrink-0 text-faint" />;
}

function CrumbButton({ crumb, current, onSelect }: { crumb: Crumb; current: boolean; onSelect: (c: Crumb) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(crumb)}
      aria-current={current ? 'location' : undefined}
      title={crumb.label}
      className={`min-w-0 max-w-44 shrink truncate rounded px-1.5 py-0.5 text-ui transition-colors hover:bg-hover ${
        current ? 'font-semibold text-fg' : crumb.id === null ? 'font-medium text-fg' : 'text-muted hover:text-fg'
      }`}
    >
      {crumb.label}
    </button>
  );
}

export function TopBar({ workspace, nodes }: { workspace: Workspace; nodes: GraphNode[] }) {
  const selectedId = useUiStore((s) => s.selectedNodeId);
  const selectNode = useUiStore((s) => s.selectNode);
  const navHistory = useUiStore((s) => s.navHistory);
  const navStep = useUiStore((s) => s.navStep);
  const panelCollapsed = useUiStore((s) => s.panelCollapsed);
  const drawerOpen = useUiStore((s) => s.drawerOpen);
  const setPanelCollapsed = useUiStore((s) => s.setPanelCollapsed);
  const [headerRef, hw] = useElementWidth<HTMLElement>();
  const vw = useViewportWidth();
  const node = nodes.find((n) => n.id === selectedId);
  const path = useMemo(() => (node ? [...ancestorChain(nodes, node.id), node] : []), [nodes, node]);
  const model = useMemo(() => buildBreadcrumb(workspace.name, path, hw && hw < 700 ? 3 : 5), [workspace.name, path, hw]);
  const exists = (id: string) => nodes.some((n) => n.id === id);
  const canBack = !!stepHistory(navHistory, -1, exists);
  const canForward = !!stepHistory(navHistory, 1, exists);
  const compactViews = hw > 0 && hw < 900;
  const pillDotOnly = hw > 0 && hw < 640;
  const panelHidden = vw < 900 ? !drawerOpen : panelCollapsed;
  const lastId = path[path.length - 1]?.id ?? null;

  const select = (c: Crumb) => {
    if (c.id) selectNode(c.id);
    else selectNode(null);
  };

  return (
    <header ref={headerRef} className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
      <div className="flex shrink-0 items-center">
        <IconButton aria-label="Back" shortcut="Alt+Left" disabled={!canBack} onClick={() => navStep(-1, exists)}>
          <ChevronLeft size={18} />
        </IconButton>
        <IconButton aria-label="Forward" shortcut="Alt+Right" disabled={!canForward} onClick={() => navStep(1, exists)}>
          <ChevronRight size={18} />
        </IconButton>
      </div>

      <nav aria-label="Selected node path" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
        {model.head.map((c, i) => (
          <span key={c.id ?? 'ws'} className="flex min-w-0 items-center gap-0.5">
            {i > 0 && <Sep />}
            <CrumbButton crumb={c} current={c.id === lastId && c.id !== null && model.tail.length === 0 && i === model.head.length - 1} onSelect={select} />
          </span>
        ))}
        {model.collapsed.length > 0 && (
          <>
            <Sep />
            <Menu
              label="Show hidden path segments"
              align="left"
              trigger={<MoreHorizontal size={16} />}
              items={model.collapsed.map((c) => ({ label: c.label, onSelect: () => select(c) }))}
            />
          </>
        )}
        {model.tail.map((c, i) => (
          <span key={c.id ?? `t${i}`} className="flex min-w-0 items-center gap-0.5">
            <Sep />
            <CrumbButton crumb={c} current={i === model.tail.length - 1} onSelect={select} />
          </span>
        ))}
      </nav>

      <SegmentedControl<LayoutMode>
        label="View"
        value={workspace.layout}
        options={VIEWS.map((v) => ({ ...v, hideLabel: compactViews }))}
        onChange={(m) => void attempt(() => setLayout(workspace.id, m))}
      />

      {panelHidden && nodes.length > 0 && (
        <IconButton aria-label="Show conversation" onClick={() => setPanelCollapsed(false)}>
          <PanelRightOpen size={18} />
        </IconButton>
      )}
      <ProviderStatusBar showSettingsLink dotOnly={pillDotOnly} />
    </header>
  );
}
