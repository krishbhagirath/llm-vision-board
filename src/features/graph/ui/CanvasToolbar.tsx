import { Crosshair, Info, LayoutGrid, Map as MapIcon, Maximize, Minus, Plus } from 'lucide-react';
import { useReactFlow } from '@xyflow/react';
import { IconButton } from '@/components/Button';
import { Popover } from '@/components/Popover';
import { useReducedMotion } from '@/hooks/useViewport';
import { updateWorkspace } from '@/features/workspaces/workspaceOps';
import { attempt } from '@/components/toastStore';
import type { GraphNode, ID, Workspace } from '@/types';
import { autoLayoutBoard } from './nodeActions';
import { FIT_OPTIONS } from './canvasConstants';

function Divider() {
  return <span aria-hidden className="mx-0.5 h-5 w-px bg-line" />;
}

function LegendRow({ swatch, title, text }: { swatch: React.ReactNode; title: string; text: string }) {
  return (
    <div className="flex gap-3">
      <div className="flex w-10 shrink-0 items-center justify-center">{swatch}</div>
      <div className="min-w-0">
        <div className="text-ui font-medium text-fg">{title}</div>
        <div className="text-xs text-muted">{text}</div>
      </div>
    </div>
  );
}

export function Legend() {
  return (
    <div className="w-72 space-y-3">
      <h3 className="text-sm font-semibold">Reading the map</h3>
      <div className="space-y-2.5">
        <LegendRow
          swatch={<span className="block h-0 w-9 border-t-2 border-line-strong" />}
          title="Branch"
          text="Parent to child. A child sees only its ancestors' context."
        />
        <LegendRow
          swatch={<span className="block h-0 w-9 border-t-2 border-dashed border-accent/60" />}
          title="Related link"
          text="Connects two nodes without changing the hierarchy. Board view: drag between node handles. Select a link and press Delete to remove it."
        />
        <LegendRow
          swatch={<span className="block h-0 w-9 border-t-[3px] border-accent" />}
          title="Current path"
          text="From the root to the selected node."
        />
      </div>
      <div className="h-px bg-line" />
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-status-answered" />Answered</span>
        <span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-status-pending" />Waiting or generating</span>
        <span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-status-failed" />Failed</span>
        <span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full border-2 border-status-unexplored" />Not asked yet</span>
      </div>
    </div>
  );
}

interface Props {
  workspace: Workspace;
  nodes: GraphNode[];
  board: boolean;
  selectedId: ID | null;
  onFocusSelected: () => void;
}

/** Floating canvas controls (replaces React Flow's default Controls). Must render inside ReactFlowProvider. */
export function CanvasToolbar({ workspace, nodes, board, selectedId, onFocusSelected }: Props) {
  const rf = useReactFlow();
  const reduced = useReducedMotion();
  const duration = reduced ? 0 : 200;
  const minimap = workspace.settings.showMinimap;
  return (
    <div
      role="toolbar"
      aria-label="Canvas controls"
      className="absolute bottom-4 left-4 z-10 flex items-center gap-0.5 rounded-lg border border-line bg-elevated p-1 shadow-md"
    >
      <IconButton aria-label="Zoom out" size="md" onClick={() => void rf.zoomOut({ duration })}>
        <Minus size={16} />
      </IconButton>
      <IconButton aria-label="Zoom in" onClick={() => void rf.zoomIn({ duration })}>
        <Plus size={16} />
      </IconButton>
      <IconButton aria-label="Fit all nodes" onClick={() => void rf.fitView({ ...FIT_OPTIONS, duration })}>
        <Maximize size={16} />
      </IconButton>
      <IconButton aria-label="Focus selected node" disabled={!selectedId} onClick={onFocusSelected}>
        <Crosshair size={16} />
      </IconButton>
      <Divider />
      <IconButton
        aria-label={minimap ? 'Hide minimap' : 'Show minimap'}
        active={minimap}
        onClick={() => void attempt(() => updateWorkspace(workspace.id, { settings: { showMinimap: !minimap } }))}
      >
        <MapIcon size={16} />
      </IconButton>
      {board && (
        <IconButton
          aria-label="Auto-layout"
          tooltip="Auto-layout: arrange as a tree (undo with Ctrl+Z)"
          onClick={() => void autoLayoutBoard(workspace, nodes)}
        >
          <LayoutGrid size={16} />
        </IconButton>
      )}
      <Divider />
      <Popover label="Map legend" placement="top-start" trigger={<IconButton aria-label="Map legend" tooltip="Legend: edges and status colors"><Info size={16} /></IconButton>}>
        <Legend />
      </Popover>
    </div>
  );
}
