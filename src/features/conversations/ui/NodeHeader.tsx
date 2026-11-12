import { useEffect, useRef, useState } from 'react';
import { ChevronRight, ExternalLink, FolderInput, Link2, MoreHorizontal, PanelRightClose, Pencil, Trash2, UnfoldVertical, FoldVertical } from 'lucide-react';
import { IconButton, TextInput } from '@/components/Button';
import { Menu } from '@/components/Menu';
import { attempt } from '@/components/toastStore';
import { bg } from '@/lib/bgClient';
import { toggleCollapsed, updateNode } from '@/features/graph/graphOps';
import { renameNodeUndoable } from '@/features/graph/ui/nodeActions';
import { useUiStore } from '@/state/uiStore';
import type { Conversation, GraphNode, NodeType } from '@/types';

const TYPES: NodeType[] = ['topic', 'question', 'explanation', 'note'];
const MAX_VISIBLE_CRUMBS = 3;

/** Ancestor chips, root first. Long paths fold the oldest ancestors into a "…" menu. */
export function AncestorChips({ path, onSelect }: { path: GraphNode[]; onSelect: (id: string) => void }) {
  if (path.length === 0) return <span className="text-xs text-faint">Top-level question</span>;
  const hidden = path.length > MAX_VISIBLE_CRUMBS ? path.slice(0, path.length - MAX_VISIBLE_CRUMBS) : [];
  const shown = path.slice(hidden.length);
  return (
    <nav aria-label="Ancestors" className="flex min-w-0 items-center gap-0.5 overflow-hidden">
      {hidden.length > 0 && (
        <>
          <Menu
            label={`${hidden.length} earlier ancestors`}
            align="left"
            trigger={<MoreHorizontal size={14} />}
            triggerClassName="!h-6 !min-w-6"
            items={hidden.map((h) => ({ label: h.title, onSelect: () => onSelect(h.id) }))}
          />
          <ChevronRight size={12} aria-hidden className="shrink-0 text-faint" />
        </>
      )}
      {shown.map((p) => (
        <span key={p.id} className="flex min-w-0 items-center gap-0.5">
          <button
            type="button"
            title={p.title}
            onClick={() => onSelect(p.id)}
            className="max-w-[9.5rem] truncate rounded-md border border-line bg-subtle px-2 py-0.5 text-xs text-muted transition-colors hover:border-line-strong hover:text-fg"
          >
            {p.title}
          </button>
          <ChevronRight size={12} aria-hidden className="shrink-0 text-faint" />
        </span>
      ))}
    </nav>
  );
}

interface Props {
  node: GraphNode;
  path: GraphNode[];
  conversation: Conversation | null;
  compact?: boolean;
  /** Show the "collapse panel" button (board only). */
  onCollapse?: () => void;
}

export function NodeHeader({ node, path, conversation, compact = false, onCollapse }: Props) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(node.title);
  const renameNonce = useUiStore((s) => s.renameNonce);
  const selectNode = useUiStore((s) => s.selectNode);
  const requestFocusNode = useUiStore((s) => s.requestFocusNode);
  const openDialog = useUiStore((s) => s.openDialog);
  const firstRename = useRef(renameNonce);

  useEffect(() => {
    setEditing(false);
    setTitle(node.title);
  }, [node.id, node.title]);
  useEffect(() => {
    if (renameNonce !== firstRename.current) {
      firstRename.current = renameNonce;
      setEditing(true);
    }
  }, [renameNonce]);

  const commit = () => {
    setEditing(false);
    void renameNodeUndoable(node, title);
  };
  const goto = (id: string) => {
    selectNode(id);
    requestFocusNode(id);
  };

  return (
    <header className={`space-y-1.5 border-b border-line ${compact ? 'px-3 py-2.5' : 'px-4 pb-3 pt-3'}`}>
      <AncestorChips path={path} onSelect={goto} />
      <div className="flex items-center gap-1.5">
        <div className="min-w-0 flex-1">
          {editing ? (
            <TextInput
              data-autofocus
              autoFocus
              aria-label="Node title"
              value={title}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setTitle(node.title);
                  setEditing(false);
                }
              }}
            />
          ) : (
            <h2 className="min-w-0">
              <button
                type="button"
                title="Rename (F2)"
                onClick={() => setEditing(true)}
                className={`block w-full truncate rounded-md px-1 py-0.5 text-left font-semibold tracking-[-0.01em] hover:bg-hover ${compact ? 'text-sm' : 'text-base'}`}
                style={{ marginLeft: -4 }}
              >
                {node.title}
              </button>
            </h2>
          )}
        </div>
        <label className="sr-only" htmlFor={`type-${node.id}`}>
          Node type
        </label>
        <select
          id={`type-${node.id}`}
          value={node.type}
          onChange={(e) => void attempt(() => updateNode(node.id, { type: e.target.value as NodeType }))}
          className="h-7 shrink-0 rounded-md border border-line bg-card px-1.5 text-xs capitalize text-muted hover:text-fg"
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <Menu
          label="Node actions"
          trigger={<MoreHorizontal size={16} />}
          items={[
            { label: 'Rename', icon: <Pencil />, shortcut: 'F2', onSelect: () => setEditing(true) },
            { label: 'Move to…', icon: <FolderInput />, onSelect: () => openDialog({ kind: 'moveNode', nodeId: node.id }) },
            { label: 'Add cross-link to…', icon: <Link2 />, onSelect: () => openDialog({ kind: 'linkNode', nodeId: node.id }) },
            {
              label: node.collapsed ? 'Expand branches' : 'Collapse branches',
              icon: node.collapsed ? <UnfoldVertical /> : <FoldVertical />,
              onSelect: () => void attempt(() => toggleCollapsed(node.id)),
            },
            {
              label: 'Open in ChatGPT',
              icon: <ExternalLink />,
              hidden: !conversation?.providerUrl,
              onSelect: () => void attempt(() => bg.openChatGPT(conversation?.providerUrl ?? null)),
            },
            { label: 'Delete branch…', icon: <Trash2 />, danger: true, separatorBefore: true, onSelect: () => openDialog({ kind: 'deleteNode', nodeId: node.id }) },
          ]}
        />
        {onCollapse && (
          <IconButton aria-label="Collapse panel" onClick={onCollapse}>
            <PanelRightClose size={16} />
          </IconButton>
        )}
      </div>
    </header>
  );
}
