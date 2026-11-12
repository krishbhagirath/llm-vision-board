import { useMemo, useState } from 'react';
import { Button, TextInput } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { ancestorChain, collectSubtree, wouldCreateCycle } from '@/features/graph/graphOps';
import type { GraphNode, ID } from '@/types';

interface Props {
  title: string;
  nodes: GraphNode[];
  /** Node being moved/linked from; excluded from choices. */
  fromId: ID;
  mode: 'move' | 'link';
  onPick: (nodeId: ID | null) => void | Promise<void>;
  onClose: () => void;
}

/** Lists candidate nodes. For "move": excludes self + descendants (cycle check). For "link": excludes self. */
export function NodePickerDialog({ title, nodes, fromId, mode, onPick, onClose }: Props) {
  const [q, setQ] = useState('');
  const candidates = useMemo(() => {
    const blocked = mode === 'move' ? new Set(collectSubtree(nodes, fromId)) : new Set([fromId]);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return nodes
      .filter((n) => !blocked.has(n.id) && (mode === 'link' || !wouldCreateCycle(nodes, fromId, n.id)))
      .map((n) => ({ n, path: [...ancestorChain(byId, n.id), n].map((x) => x.title).join(' › ') }))
      .filter(({ path }) => path.toLowerCase().includes(q.trim().toLowerCase()))
      .sort((a, b) => a.path.localeCompare(b.path))
      .slice(0, 200);
  }, [nodes, fromId, mode, q]);

  return (
    <Dialog title={title} onClose={onClose}>
      <TextInput data-autofocus placeholder="Filter nodes…" value={q} onChange={(e) => setQ(e.target.value)} />
      {mode === 'move' && (
        <Button size="sm" onClick={() => void onPick(null)}>
          Make root (no parent)
        </Button>
      )}
      <ul className="max-h-72 overflow-y-auto rounded-md border border-line">
        {candidates.length === 0 && <li className="p-3 text-sm text-muted">No matching nodes.</li>}
        {candidates.map(({ n, path }) => (
          <li key={n.id}>
            <button className="block w-full truncate px-3 py-2 text-left text-sm hover:bg-subtle" title={path} onClick={() => void onPick(n.id)}>
              {path}
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
