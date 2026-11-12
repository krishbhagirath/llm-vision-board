import { useRef, useState } from 'react';
import { AlertTriangle, FileJson, FileWarning } from 'lucide-react';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import type { ImportErrorCode, ImportPreview } from '@/storage/exportImport';
import { confirmImport, importFromFile, useImportStore } from './dataActions';

const ERROR_COPY: Record<ImportErrorCode, { title: string; body: string }> = {
  'invalid-json': { title: "This file isn't readable JSON", body: 'It may be damaged, cut off, or a different kind of file. Pick a file made with Export on a workspace.' },
  'wrong-format': { title: "This isn't a Vision Board export", body: 'The file is valid JSON but was not made by LLM Vision Board. Use Export on a workspace to create a file you can import.' },
  'newer-version': { title: 'Made by a newer version', body: 'This export uses a format this build does not understand yet. Update the extension, then try again.' },
  'invalid-schema': { title: 'This export is incomplete or damaged', body: 'Some required fields are missing or have the wrong type. The technical detail is below.' },
  integrity: { title: 'This export has broken links between its nodes', body: 'Nodes point at parents that are missing, or form a loop. Nothing was imported. The technical detail is below.' },
};

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-line bg-subtle/60 px-3 py-2">
      <div className="text-lg font-semibold tabular-nums leading-6">{value.toLocaleString()}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

function Preview({ preview, onClose }: { preview: ImportPreview; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const c = preview.counts;
  return (
    <Dialog
      title="Import workspace"
      description="Review this file before anything is added."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            data-autofocus
            loading={busy}
            onClick={async () => {
              setBusy(true);
              const ws = await confirmImport(preview.data);
              setBusy(false);
              if (ws) onClose();
            }}
          >
            Import as new workspace
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-3">
        <FileJson size={20} aria-hidden className="mt-0.5 shrink-0 text-accent" />
        <dl className="min-w-0 flex-1 space-y-0.5 text-ui">
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-muted">Workspace</dt>
            <dd className="min-w-0 truncate font-semibold" title={preview.workspaceName}>
              {preview.workspaceName}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-muted">File</dt>
            <dd className="min-w-0 truncate" title={preview.fileName}>
              {preview.fileName || 'Untitled file'}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-muted">Export version</dt>
            <dd>v{preview.version}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-muted">Exported</dt>
            <dd>{new Date(preview.exportedAt).toLocaleString()}</dd>
          </div>
        </dl>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        <Stat label="Nodes" value={c.nodes} />
        <Stat label="Links" value={c.edges} />
        <Stat label="Conversations" value={c.conversations} />
        <Stat label="Messages" value={c.messages} />
        <Stat label="Snapshots" value={c.snapshots} />
      </div>

      {preview.warnings.length > 0 && (
        <div role="note" className="space-y-1 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2.5 text-xs text-warn">
          <div className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle size={13} aria-hidden />
            {preview.warnings.length === 1 ? '1 thing to know' : `${preview.warnings.length} things to know`}
          </div>
          <ul className="list-disc space-y-0.5 pl-4">
            {preview.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-muted">It is added as a new workspace. Your existing workspaces and messages are not changed or overwritten.</p>
    </Dialog>
  );
}

function Problem({ code, message, fileName, onClose }: { code: ImportErrorCode; message: string; fileName: string; onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const copy = ERROR_COPY[code];
  return (
    <Dialog
      title="Can't import this file"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" data-autofocus onClick={() => input.current?.click()}>
            Choose another file
          </Button>
          <input
            ref={input}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void importFromFile(f);
            }}
          />
        </>
      }
    >
      <div className="flex items-start gap-3">
        <FileWarning size={20} aria-hidden className="mt-0.5 shrink-0 text-danger" />
        <div className="min-w-0 space-y-1">
          <div className="text-sm font-semibold">{copy.title}</div>
          <p className="text-ui text-muted">{copy.body}</p>
          {fileName && (
            <p className="truncate text-xs text-faint" title={fileName}>
              File: {fileName}
            </p>
          )}
        </div>
      </div>
      {(code === 'invalid-schema' || code === 'integrity' || code === 'newer-version') && (
        <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-subtle p-2 font-mono text-[11px] leading-4 text-muted">{message}</pre>
      )}
    </Dialog>
  );
}

/** Mounted once in the board. Shows the preview (or a friendly error) for a file chosen via Import. */
export function ImportPreviewHost() {
  const pending = useImportStore((s) => s.pending);
  const set = useImportStore((s) => s.set);
  if (!pending) return null;
  const close = () => set(null);
  const r = pending.result;
  return r.ok ? <Preview preview={r.preview} onClose={close} /> : <Problem code={r.code} message={r.message} fileName={pending.fileName} onClose={close} />;
}
