import { memo } from 'react';
import { Handle, Position, useStore, type Node, type NodeProps, type ReactFlowState } from '@xyflow/react';
import { ChevronRight, CornerDownRight, Crosshair, FoldVertical } from 'lucide-react';
import { toggleCollapsed } from '@/features/graph/graphOps';
import { useUiStore } from '@/state/uiStore';
import type { ID } from '@/types';
import { createNodeAndSelect } from './nodeActions';
import { CARD_HEIGHT, CARD_WIDTH, cardPreview, type CardState } from './graphView';
import { StatusGlyph } from './StatusDot';

export interface VBNodeData extends Record<string, unknown> {
  workspaceId: ID;
  title: string;
  answerPreview: string;
  state: CardState;
  childCount: number;
  /** All hidden descendants when collapsed. */
  hiddenCount: number;
  collapsed: boolean;
  isRoot: boolean;
  onPath: boolean;
  horizontal: boolean;
  connectable: boolean;
}

export type VBFlowNode = Node<VBNodeData, 'vb'>;

const actionBtn =
  'nodrag nopan flex h-6 w-6 items-center justify-center rounded text-muted transition-colors hover:bg-hover hover:text-fg';

/** Below this zoom, cards render a minimal body (big maps stay smooth; text is unreadable that small anyway). */
const LOD_ZOOM = 0.45;
const selectLowDetail = (s: ReactFlowState) => s.transform[2] < LOD_ZOOM;

function VBNodeImpl({ id, data, selected }: NodeProps<VBFlowNode>) {
  const { title, answerPreview, state, childCount, hiddenCount, collapsed, isRoot, onPath, horizontal, connectable, workspaceId } = data;
  const lowDetail = useStore(selectLowDetail);
  const preview = cardPreview(state, answerPreview);
  const ring = selected
    ? 'border-accent ring-2 ring-accent shadow-md'
    : onPath
      ? 'border-accent/60 shadow-sm'
      : 'border-line hover:border-line-strong hover:shadow-md shadow-sm';
  const handleCls = `!h-2 !w-2 !border-line-strong !bg-card ${connectable ? 'opacity-0 group-hover:opacity-100' : '!opacity-0'}`;

  if (lowDetail) {
    return (
      <div
        style={{ width: CARD_WIDTH, height: CARD_HEIGHT }}
        className={`flex items-center overflow-hidden rounded-lg border bg-card px-4 ${selected ? 'border-accent ring-4 ring-accent' : onPath || isRoot ? 'border-accent/70' : 'border-line-strong'}`}
      >
        <Handle type="target" position={horizontal ? Position.Left : Position.Top} isConnectable={false} className="!opacity-0" />
        <span className="line-clamp-2 text-[22px] font-semibold leading-7 text-fg">{title}</span>
        <Handle type="source" position={horizontal ? Position.Right : Position.Bottom} isConnectable={false} className="!opacity-0" />
      </div>
    );
  }

  return (
    <div
      style={{ width: CARD_WIDTH, height: CARD_HEIGHT }}
      className={`group relative flex flex-col gap-1.5 overflow-visible rounded-lg border bg-card px-3 py-2.5 transition-[box-shadow,border-color] duration-[var(--dur)] ${ring}`}
    >
      {isRoot && <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-accent" />}
      <Handle type="target" position={horizontal ? Position.Left : Position.Top} isConnectable={connectable} className={handleCls} />

      <div className="flex items-start gap-2">
        <span className="mt-[3px]">
          <StatusGlyph state={state} />
        </span>
        <div
          title={title}
          className={`line-clamp-2 min-w-0 flex-1 font-semibold leading-[18px] text-fg ${isRoot ? 'text-[14px]' : 'text-[13px]'}`}
        >
          {title}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 items-end gap-2 pl-[22px]">
        <p
          className={`line-clamp-2 min-w-0 flex-1 text-xs leading-4 ${
            state === 'failed' ? 'font-medium text-status-failed' : preview.muted ? 'text-muted' : 'text-fg'
          } ${state === 'unexplored' ? 'italic' : ''}`}
        >
          {preview.text}
        </p>
        {childCount > 0 && (
          <button
            type="button"
            tabIndex={-1}
            className="nodrag nopan flex h-5 shrink-0 items-center gap-0.5 rounded-full border border-line bg-subtle px-1.5 text-[11px] font-medium tabular-nums text-muted transition-colors hover:border-line-strong hover:text-fg"
            aria-label={collapsed ? `Expand ${hiddenCount} hidden nodes` : `Collapse ${childCount} branches`}
            aria-expanded={!collapsed}
            title={collapsed ? 'Expand branches' : 'Collapse branches'}
            onClick={(e) => {
              e.stopPropagation();
              void toggleCollapsed(id);
            }}
          >
            {collapsed ? <span>+{hiddenCount} hidden</span> : <span>{childCount}</span>}
            <ChevronRight size={12} className={collapsed ? '' : 'rotate-90'} style={{ transition: 'transform 120ms' }} />
          </button>
        )}
      </div>

      <div className="nodrag nopan pointer-events-none absolute -top-3 right-2 flex gap-0.5 rounded-md border border-line bg-elevated p-0.5 opacity-0 shadow-md transition-opacity duration-[var(--dur-fast)] group-hover:pointer-events-auto group-hover:opacity-100">
        <button
          type="button"
          tabIndex={-1}
          className={actionBtn}
          aria-label="Add follow-up branch"
          title="Add follow-up branch"
          onClick={(e) => {
            e.stopPropagation();
            void createNodeAndSelect({ workspaceId, parentId: id, title: 'New question' }).then((n) => {
              if (n) useUiStore.getState().requestComposerFocus();
            });
          }}
        >
          <CornerDownRight size={14} />
        </button>
        <button
          type="button"
          tabIndex={-1}
          className={actionBtn}
          aria-label="Focus this node"
          title="Focus this node"
          onClick={(e) => {
            e.stopPropagation();
            const ui = useUiStore.getState();
            ui.selectNode(id);
            ui.requestFocusNode(id);
          }}
        >
          <Crosshair size={14} />
        </button>
        {childCount > 0 && (
          <button
            type="button"
            tabIndex={-1}
            className={actionBtn}
            aria-label={collapsed ? 'Expand branches' : 'Collapse branches'}
            title={collapsed ? 'Expand branches' : 'Collapse branches'}
            onClick={(e) => {
              e.stopPropagation();
              void toggleCollapsed(id);
            }}
          >
            <FoldVertical size={14} />
          </button>
        )}
      </div>

      <Handle type="source" position={horizontal ? Position.Right : Position.Bottom} isConnectable={connectable} className={handleCls} />
    </div>
  );
}

export const VBNode = memo(VBNodeImpl);
