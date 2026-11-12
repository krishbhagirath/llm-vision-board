import { useEffect, useRef, useState } from 'react';
import {
  Download,
  FlaskConical,
  Keyboard,
  MoreHorizontal,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  Pencil,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Trash2,
  Upload,
} from 'lucide-react';
import { Button, IconButton, TextInput } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ContextMenu, Menu, type MenuItem } from '@/components/Menu';
import { Kbd } from '@/components/Kbd';
import { Tooltip } from '@/components/Tooltip';
import { EmptyState } from '@/components/EmptyState';
import { formatShortcut } from '@/components/floating';
import { attempt } from '@/components/toastStore';
import { bg } from '@/lib/bgClient';
import { relativeTime } from '@/hooks/relativeTime';
import { useEscape, useViewportWidth } from '@/hooks/useViewport';
import { useWorkspaceCounts } from '@/hooks/useWorkspaceCounts';
import { deleteWorkspace, renameWorkspace } from '@/features/workspaces/workspaceOps';
import { openWorkspace } from '@/features/graph/ui/nodeActions';
import { useUiStore } from '@/state/uiStore';
import type { Workspace } from '@/types';
import { addSample, addStressSample, downloadWorkspace, importFromFile } from './dataActions';

export const RAIL_BREAKPOINT = 1100;

function useMinuteTick(): number {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    const i = setInterval(() => setT(Date.now()), 60_000);
    return () => clearInterval(i);
  }, []);
  return t;
}

interface ItemProps {
  ws: Workspace;
  active: boolean;
  count: number;
  now: number;
  onDelete: () => void;
  onOpened: () => void;
}

function WorkspaceItem({ ws, active, count, now, onDelete, onOpened }: ItemProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(ws.name);
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null);
  const openDialog = useUiStore((s) => s.openDialog);
  const commit = () => {
    setEditing(false);
    if (name.trim() && name !== ws.name) void attempt(() => renameWorkspace(ws.id, name));
    else setName(ws.name);
  };
  const items: MenuItem[] = [
    { label: 'Rename', icon: <Pencil />, shortcut: 'F2', onSelect: () => setEditing(true) },
    {
      label: 'Settings and goal…',
      icon: <SlidersHorizontal />,
      onSelect: () => void openWorkspace(ws.id).then(() => openDialog({ kind: 'workspaceSettings' })),
    },
    { label: 'Export…', icon: <Download />, onSelect: () => void downloadWorkspace(ws) },
    { label: 'Delete…', icon: <Trash2 />, danger: true, separatorBefore: true, onSelect: onDelete },
  ];
  return (
    <li
      onContextMenu={(e) => {
        e.preventDefault();
        setCtx({ x: e.clientX, y: e.clientY });
      }}
      className={`group relative flex items-center rounded-md ${active ? 'bg-accent-soft' : 'hover:bg-hover'}`}
    >
      {active && <span aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 rounded-r bg-accent" />}
      {editing ? (
        <div className="min-w-0 flex-1 px-2 py-1.5">
          <TextInput
            autoFocus
            aria-label="Workspace name"
            className="!py-0.5"
            value={name}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setName(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                e.stopPropagation();
                setName(ws.name);
                setEditing(false);
              }
            }}
          />
        </div>
      ) : (
        <button
          type="button"
          aria-current={active ? 'true' : undefined}
          className="min-w-0 flex-1 rounded-md px-2.5 py-1.5 text-left"
          onClick={() => {
            void openWorkspace(ws.id);
            onOpened();
          }}
          onDoubleClick={() => setEditing(true)}
          onKeyDown={(e) => {
            if (e.key === 'F2') {
              e.preventDefault();
              e.stopPropagation();
              setEditing(true);
            }
          }}
          title={ws.description || ws.name}
        >
          <div className={`truncate text-ui ${active ? 'font-semibold' : 'font-medium'}`}>{ws.name}</div>
          <div className="truncate text-xs tabular-nums text-muted">
            {count} {count === 1 ? 'node' : 'nodes'} · {relativeTime(ws.updatedAt, now)}
          </div>
        </button>
      )}
      {!editing && (
        <span className={`pr-1 ${active ? '' : 'opacity-0 focus-within:opacity-100 group-hover:opacity-100'}`}>
          <Menu label={`Actions for ${ws.name}`} trigger={<MoreHorizontal size={16} />} items={items} />
        </span>
      )}
      {ctx && <ContextMenu point={ctx} label={`Actions for ${ws.name}`} items={items} onClose={() => setCtx(null)} />}
    </li>
  );
}

function FooterButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-ui text-muted transition-colors hover:bg-hover hover:text-fg [&>svg]:h-4 [&>svg]:w-4"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

interface FullProps {
  workspaces: Workspace[];
  activeId: string | null;
  onCollapse: () => void;
  onOpened: () => void;
}

function SidebarFull({ workspaces, activeId, onCollapse, onOpened }: FullProps) {
  const openDialog = useUiStore((s) => s.openDialog);
  const [toDelete, setToDelete] = useState<Workspace | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const counts = useWorkspaceCounts();
  const now = useMinuteTick();
  return (
    <nav aria-label="Workspaces" className="flex h-full w-[264px] shrink-0 flex-col border-r border-line bg-panel">
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-accent-fg">
            <Network size={16} />
          </span>
          <span className="text-sm font-semibold tracking-tight">Vision Board</span>
        </div>
        <IconButton aria-label="Collapse sidebar" size="sm" onClick={onCollapse}>
          <PanelLeftClose size={16} />
        </IconButton>
      </div>
      <div className="space-y-2 px-3 pb-2">
        <button
          type="button"
          onClick={() => openDialog({ kind: 'search' })}
          className="flex h-9 w-full items-center gap-2 rounded-lg border border-line-strong bg-card px-2.5 text-ui text-muted shadow-sm transition-colors hover:bg-hover hover:text-fg"
        >
          <Search size={15} />
          <span className="flex-1 text-left">Search</span>
          <Kbd>{formatShortcut('Mod+K')}</Kbd>
        </button>
        <Button size="md" variant="primary" className="w-full" onClick={() => openDialog({ kind: 'newWorkspace' })}>
          <Plus size={15} />
          New workspace
        </Button>
      </div>
      <div className="px-4 pb-1 pt-2 text-xs font-medium text-muted">Workspaces</div>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {workspaces.length === 0 && (
          <li>
            <EmptyState title="No workspaces yet" description="Create one to start mapping a conversation." className="!p-4" />
          </li>
        )}
        {workspaces.map((w) => (
          <WorkspaceItem key={w.id} ws={w} active={w.id === activeId} count={counts[w.id] ?? 0} now={now} onDelete={() => setToDelete(w)} onOpened={onOpened} />
        ))}
      </ul>
      <div className="space-y-0.5 border-t border-line p-2">
        <FooterButton icon={<Upload />} label="Import workspace…" onClick={() => fileRef.current?.click()} />
        <Menu
          label="Add sample"
          direction="up"
          align="left"
          triggerClassName="!h-8 !w-full !justify-start !gap-2.5 !px-2.5 !text-ui"
          trigger={
            <>
              <FlaskConical size={16} />
              <span>Add sample</span>
            </>
          }
          items={[
            { label: 'Sample map', onSelect: () => void addSample() },
            { label: '400-node stress sample', onSelect: () => void addStressSample() },
          ]}
        />
        <FooterButton icon={<Settings />} label="Settings" onClick={() => openDialog({ kind: 'settings' })} />
        <FooterButton icon={<PanelRight />} label="Open side panel" onClick={() => void attempt(() => bg.openSidePanel())} />
        <FooterButton icon={<Keyboard />} label="Shortcuts" onClick={() => openDialog({ kind: 'shortcuts' })} />
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void importFromFile(f);
        }}
      />
      {toDelete && (
        <ConfirmDialog
          title="Delete workspace?"
          danger
          confirmLabel="Delete workspace"
          onCancel={() => setToDelete(null)}
          onConfirm={async () => {
            const id = toDelete.id;
            setToDelete(null);
            await attempt(() => deleteWorkspace(id), 'Workspace deleted');
          }}
        >
          <p>
            "{toDelete.name}" and all of its nodes and messages will be permanently deleted from this browser. This cannot be undone. Consider exporting it first.
          </p>
        </ConfirmDialog>
      )}
    </nav>
  );
}

function RailButton({ label, onClick, children, active, shortcut }: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean; shortcut?: string }) {
  return (
    <IconButton aria-label={label} tooltipSide="right" shortcut={shortcut} active={active} onClick={onClick} className="!h-9 !w-9">
      {children}
    </IconButton>
  );
}

function SidebarRail({ workspaces, activeId, onExpand }: { workspaces: Workspace[]; activeId: string | null; onExpand: () => void }) {
  const openDialog = useUiStore((s) => s.openDialog);
  return (
    <nav aria-label="Workspaces" className="flex h-full w-[52px] shrink-0 flex-col items-center gap-1 border-r border-line bg-panel py-3">
      <RailButton label="Expand sidebar" onClick={onExpand}>
        <PanelLeftOpen size={18} />
      </RailButton>
      <RailButton label="Search" shortcut="Mod+K" onClick={() => openDialog({ kind: 'search' })}>
        <Search size={18} />
      </RailButton>
      <RailButton label="New workspace" onClick={() => openDialog({ kind: 'newWorkspace' })}>
        <Plus size={18} />
      </RailButton>
      <div className="my-1 h-px w-6 bg-line" />
      <ul className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto">
        {workspaces.map((w) => (
          <li key={w.id}>
            <Tooltip content={w.name} side="right">
              <button
                type="button"
                aria-label={w.name}
                aria-current={w.id === activeId ? 'true' : undefined}
                onClick={() => void openWorkspace(w.id)}
                className={`flex h-9 w-9 items-center justify-center rounded-lg text-ui font-semibold uppercase transition-colors ${
                  w.id === activeId ? 'bg-accent-soft text-accent ring-1 ring-accent/40' : 'bg-subtle text-muted hover:bg-hover hover:text-fg'
                }`}
              >
                {w.name.trim().charAt(0) || '?'}
              </button>
            </Tooltip>
          </li>
        ))}
      </ul>
      <RailButton label="Settings" onClick={() => openDialog({ kind: 'settings' })}>
        <Settings size={18} />
      </RailButton>
    </nav>
  );
}

export function Sidebar({ workspaces, activeId }: { workspaces: Workspace[]; activeId: string | null }) {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const setCollapsed = useUiStore((s) => s.setSidebarCollapsed);
  const vw = useViewportWidth();
  const forcedRail = vw < RAIL_BREAKPOINT;
  const [overlay, setOverlay] = useState(false);
  useEscape(overlay, () => setOverlay(false));

  if (forcedRail) {
    return (
      <>
        <SidebarRail workspaces={workspaces} activeId={activeId} onExpand={() => setOverlay(true)} />
        {overlay && (
          <div
            className="fixed inset-0 z-40 bg-black/35"
            onMouseDown={(e) => e.target === e.currentTarget && setOverlay(false)}
          >
            <div className="anim-slide-l h-full w-fit shadow-lg">
              <SidebarFull workspaces={workspaces} activeId={activeId} onCollapse={() => setOverlay(false)} onOpened={() => setOverlay(false)} />
            </div>
          </div>
        )}
      </>
    );
  }
  if (collapsed) return <SidebarRail workspaces={workspaces} activeId={activeId} onExpand={() => setCollapsed(false)} />;
  return <SidebarFull workspaces={workspaces} activeId={activeId} onCollapse={() => setCollapsed(true)} onOpened={() => undefined} />;
}
