import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type NodeChange,
} from '@xyflow/react';
import { addLink, childrenIndex, removeEdge, toggleCollapsed, visibleNodes } from '@/features/graph/graphOps';
import { useNodeStatusMap } from '@/hooks/useNodeStatus';
import { useReducedMotion } from '@/hooks/useViewport';
import { useUiStore } from '@/state/uiStore';
import { attempt } from '@/components/toastStore';
import type { GraphEdge, GraphNode, ID, Position, Workspace } from '@/types';
import { VBNode, type VBFlowNode, type VBNodeData } from './VBNode';
import { persistPositions } from './nodeActions';
import { CanvasToolbar } from './CanvasToolbar';
import { FIT_OPTIONS } from './canvasConstants';
import { CARD_HEIGHT, CARD_WIDTH, cardState, computeCardLayout, descendantCounts, neighborFor, pathIds, type NavKey } from './graphView';

const nodeTypes = { vb: VBNode };
const NAV_KEYS = new Set<string>(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

interface Props {
  workspace: Workspace;
  nodes: GraphNode[];
  edges: GraphEdge[];
  mode: 'tree' | 'board';
  theme: 'light' | 'dark';
}

interface Pending {
  id: ID;
  /** Only pan if the node is outside the viewport (keyboard navigation). */
  soft: boolean;
}

function CanvasInner({ workspace, nodes, edges, mode, theme }: Props) {
  const selectedId = useUiStore((s) => s.selectedNodeId);
  const selectedEdgeId = useUiStore((s) => s.selectedEdgeId);
  const selectNode = useUiStore((s) => s.selectNode);
  const selectEdge = useUiStore((s) => s.selectEdge);
  const fitNonce = useUiStore((s) => s.fitNonce);
  const focusRequest = useUiStore((s) => s.focusRequest);
  const statusMap = useNodeStatusMap(workspace.id);
  const rf = useReactFlow();
  const reduced = useReducedMotion();
  const wrapRef = useRef<HTMLDivElement>(null);
  const horizontal = mode === 'board' || workspace.settings.treeDirection === 'LR';
  const board = mode === 'board';

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const visible = useMemo(() => visibleNodes(nodes), [nodes]);
  const childCounts = useMemo(() => {
    const idx = childrenIndex(nodes);
    const m = new Map<ID, number>();
    for (const n of nodes) m.set(n.id, idx.get(n.id)?.length ?? 0);
    return m;
  }, [nodes]);
  const descendants = useMemo(() => descendantCounts(nodes), [nodes]);
  const path = useMemo(() => pathIds(byId, selectedId), [byId, selectedId]);

  const treePositions = useMemo(
    () => (board ? null : computeCardLayout(visible, workspace.settings.treeDirection)),
    [board, visible, workspace.settings.treeDirection],
  );

  // Board-mode drag overrides: kept until the persisted positions arrive via useLiveQuery.
  const [overrides, setOverrides] = useState<ReadonlyMap<ID, Position>>(new Map());
  useEffect(() => setOverrides(new Map()), [nodes]);
  const dragStart = useRef<Map<ID, Position>>(new Map());

  // Identity-stable node objects: only nodes whose inputs changed get a new object.
  const dataCache = useRef(new Map<ID, { key: string; data: VBNodeData }>());
  const nodeCache = useRef(new Map<ID, { sig: string; data: VBNodeData; node: VBFlowNode }>());
  const rfNodes = useMemo<VBFlowNode[]>(() => {
    const out = visible.map((n) => {
      const position = (board ? overrides.get(n.id) ?? n.position : treePositions?.get(n.id)) ?? n.position;
      const state = cardState(n, statusMap.get(n.id));
      const childCount = childCounts.get(n.id) ?? 0;
      const hiddenCount = n.collapsed ? descendants.get(n.id) ?? 0 : 0;
      const isRoot = n.parentId === null;
      const onPath = path.has(n.id);
      const key = `${n.title}|${n.answerPreview}|${state}|${childCount}|${hiddenCount}|${n.collapsed}|${isRoot}|${onPath}|${horizontal}|${board}`;
      let d = dataCache.current.get(n.id);
      if (!d || d.key !== key) {
        d = {
          key,
          data: {
            workspaceId: n.workspaceId,
            title: n.title,
            answerPreview: n.answerPreview,
            state,
            childCount,
            hiddenCount,
            collapsed: n.collapsed,
            isRoot,
            onPath,
            horizontal,
            connectable: board,
          },
        };
        dataCache.current.set(n.id, d);
      }
      const selected = n.id === selectedId;
      const sig = `${position.x},${position.y},${selected},${board}`;
      const c = nodeCache.current.get(n.id);
      if (c && c.sig === sig && c.data === d.data) return c.node;
      const node: VBFlowNode = {
        id: n.id,
        type: 'vb',
        position,
        data: d.data,
        selected,
        draggable: board,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
      };
      nodeCache.current.set(n.id, { sig, data: d.data, node });
      return node;
    });
    if (nodeCache.current.size > visible.length * 2 + 50) {
      const live = new Set(visible.map((n) => n.id));
      for (const k of nodeCache.current.keys()) if (!live.has(k)) nodeCache.current.delete(k);
      for (const k of dataCache.current.keys()) if (!live.has(k)) dataCache.current.delete(k);
    }
    return out;
  }, [visible, board, overrides, treePositions, statusMap, childCounts, descendants, horizontal, selectedId, path]);

  const edgeCache = useRef(new Map<string, { sig: string; edge: Edge }>());
  const rfEdges = useMemo<Edge[]>(() => {
    const vis = new Set(visible.map((n) => n.id));
    const out: Edge[] = [];
    const reuse = (edge: Edge, sig: string): Edge => {
      const c = edgeCache.current.get(edge.id);
      if (c && c.sig === sig) return c.edge;
      edgeCache.current.set(edge.id, { sig, edge });
      return edge;
    };
    for (const n of visible) {
      if (n.parentId && vis.has(n.parentId)) {
        const onPath = path.has(n.id) && path.has(n.parentId);
        const id = `c-${n.id}`;
        out.push(
          reuse(
            { id, source: n.parentId, target: n.id, type: 'smoothstep', selectable: false, focusable: false, className: onPath ? 'vb-path' : undefined, zIndex: onPath ? 1 : 0 },
            `${n.parentId}|${onPath}`,
          ),
        );
      }
    }
    for (const e of edges) {
      if (e.type !== 'link' || !vis.has(e.source) || !vis.has(e.target)) continue;
      const selected = e.id === selectedEdgeId;
      out.push(
        reuse(
          {
            id: e.id,
            source: e.source,
            target: e.target,
            type: 'smoothstep',
            label: e.label,
            selected,
            className: 'vb-link',
            ariaLabel: 'Related link between two nodes',
            interactionWidth: 18,
          },
          `${e.source}|${e.target}|${e.label ?? ''}|${selected}`,
        ),
      );
    }
    return out;
  }, [visible, edges, selectedEdgeId, path]);

  const onNodesChange = useCallback(
    (changes: NodeChange<VBFlowNode>[]) => {
      if (!board) return;
      const posChanges = changes.filter((c) => c.type === 'position' && c.position);
      if (!posChanges.length) return;
      setOverrides((prev) => {
        const next = new Map(prev);
        for (const c of posChanges) if (c.type === 'position' && c.position) next.set(c.id, c.position);
        return next;
      });
    },
    [board],
  );

  const onNodeDragStart = useCallback(
    (_: unknown, node: VBFlowNode, dragged: VBFlowNode[]) => {
      dragStart.current = new Map(
        [node, ...dragged].map((n) => {
          const orig = byId.get(n.id);
          return [n.id, orig?.position ?? n.position] as const;
        }),
      );
    },
    [byId],
  );

  const onNodeDragStop = useCallback((_: unknown, node: VBFlowNode, dragged: VBFlowNode[]) => {
    const moved = new Map<ID, Position>();
    for (const n of [node, ...dragged]) moved.set(n.id, n.position);
    const updates = [...moved.entries()]
      .filter(([id, p]) => {
        const o = dragStart.current.get(id);
        return !o || o.x !== p.x || o.y !== p.y;
      })
      .map(([id, position]) => ({ id, position }));
    if (!updates.length) {
      setOverrides(new Map());
      return;
    }
    void persistPositions(updates, dragStart.current);
  }, []);

  const onConnect = useCallback(
    (c: Connection) => {
      if (!board || !c.source || !c.target) return;
      void attempt(() => addLink(workspace.id, c.source, c.target), 'Related link added');
    },
    [board, workspace.id],
  );

  const onEdgeClick = useCallback(
    (_: unknown, edge: Edge) => {
      selectEdge(edge.id);
      wrapRef.current?.focus();
    },
    [selectEdge],
  );
  const onEdgesDelete = useCallback((deleted: Edge[]) => {
    for (const e of deleted) void attempt(() => removeEdge(e.id));
  }, []);

  // ---- viewport control ----
  const duration = reduced ? 0 : 300;
  const selectedAtMount = useRef(selectedId);
  const [pending, setPending] = useState<Pending | null>(null);
  const origin = useRef<{ id: ID; soft: boolean } | null>(null);

  // Fit all (toolbar, auto-layout, workspace switch). The first run only fits when nothing is selected.
  const firstFit = useRef(true);
  useEffect(() => {
    if (firstFit.current) {
      firstFit.current = false;
      return;
    }
    const t = setTimeout(() => void rf.fitView({ ...FIT_OPTIONS, duration: reduced ? 0 : 250 }), 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitNonce, rf]);

  // Selection changed from outside the canvas (search, breadcrumb, outline, history), or the view was just
  // mounted with a selection (view switch): bring it into view.
  useEffect(() => {
    if (!selectedId) return;
    if (origin.current?.id === selectedId) {
      const soft = origin.current.soft;
      origin.current = null;
      if (!soft) return; // clicked on the canvas: already visible
      setPending({ id: selectedId, soft: true });
      return;
    }
    setPending({ id: selectedId, soft: false });
  }, [selectedId]);

  // Explicit focus requests (Focus action, new node).
  useEffect(() => {
    if (focusRequest && Date.now() - focusRequest.ts < 4000) setPending({ id: focusRequest.nodeId, soft: false });
  }, [focusRequest]);

  useEffect(() => {
    if (!pending) return;
    const n = rfNodes.find((x) => x.id === pending.id);
    if (!n) {
      const t = setTimeout(() => setPending(null), 3000);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      setPending(null);
      const cx = n.position.x + CARD_WIDTH / 2;
      const cy = n.position.y + CARD_HEIGHT / 2;
      if (pending.soft) {
        const el = wrapRef.current;
        const vp = rf.getViewport();
        if (el) {
          const m = 48;
          const left = n.position.x * vp.zoom + vp.x;
          const top = n.position.y * vp.zoom + vp.y;
          const right = left + CARD_WIDTH * vp.zoom;
          const bottom = top + CARD_HEIGHT * vp.zoom;
          if (left >= m && top >= m && right <= el.clientWidth - m && bottom <= el.clientHeight - m) return;
        }
      }
      void rf.setCenter(cx, cy, { zoom: Math.min(1, Math.max(rf.getZoom(), 0.6)), duration });
    }, 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, rfNodes]);

  const focusSelected = useCallback(() => {
    const id = useUiStore.getState().selectedNodeId;
    if (id) setPending({ id, soft: false });
  }, []);

  // ---- keyboard navigation ----
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target as HTMLElement;
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
    if (NAV_KEYS.has(e.key)) {
      e.preventDefault();
      const next = neighborFor(e.key as NavKey, visible, selectedId, horizontal);
      if (next && next !== selectedId) {
        origin.current = { id: next, soft: true };
        selectNode(next);
      }
    } else if (e.key === 'Enter' && selectedId) {
      e.preventDefault();
      useUiStore.getState().requestComposerFocus();
    } else if (e.key === ' ' && selectedId && (childCounts.get(selectedId) ?? 0) > 0) {
      e.preventDefault();
      void toggleCollapsed(selectedId);
    }
  };

  const showMinimap = workspace.settings.showMinimap;

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      role="application"
      aria-label={`${board ? 'Board' : 'Tree'} canvas. Arrow keys move between nodes, Enter opens the composer, Space collapses or expands.`}
      onKeyDown={onKeyDown}
      className="vb-canvas relative h-full w-full outline-none"
    >
      <ReactFlow<VBFlowNode>
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        colorMode={theme}
        onNodesChange={onNodesChange}
        onNodeClick={(_, n) => {
          origin.current = { id: n.id, soft: false };
          selectNode(n.id);
          wrapRef.current?.focus();
        }}
        onPaneClick={() => {
          selectEdge(null);
          wrapRef.current?.focus();
        }}
        onEdgeClick={onEdgeClick}
        onEdgesDelete={onEdgesDelete}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        nodesDraggable={board}
        nodesConnectable={board}
        nodesFocusable={false}
        edgesFocusable={false}
        disableKeyboardA11y
        elementsSelectable
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        onlyRenderVisibleElements
        fitView={!selectedAtMount.current}
        fitViewOptions={FIT_OPTIONS}
        minZoom={0.02}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} />
        {showMinimap && (
          <MiniMap
            pannable
            zoomable
            ariaLabel="Minimap"
            nodeStrokeWidth={2}
            nodeColor={(n) => (n.selected ? 'var(--accent)' : 'var(--line-strong)')}
            maskColor="rgba(120,120,140,0.14)"
            style={{ width: 160, height: 100 }}
          />
        )}
      </ReactFlow>
      <CanvasToolbar workspace={workspace} nodes={nodes} board={board} selectedId={selectedId} onFocusSelected={focusSelected} />
    </div>
  );
}

export function GraphCanvas(props: Props) {
  return (
    <ReactFlowProvider key={`${props.workspace.id}:${props.mode}`}>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
