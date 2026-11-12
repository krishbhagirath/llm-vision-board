import { create } from 'zustand';
import { db, updateSettings } from '@/storage/db';
import { exportWorkspace, importWorkspace, ImportError, previewImport, type ImportPreviewResult, type WorkspaceExport } from '@/storage/exportImport';
import { createLargeSampleWorkspace, createSampleWorkspace } from '@/samples/sampleWorkspace';
import { toast, errMsg } from '@/components/toastStore';
import { useUiStore } from '@/state/uiStore';
import type { Workspace } from '@/types';

function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'workspace';
}

export async function downloadWorkspace(ws: Workspace): Promise<void> {
  try {
    const data = await exportWorkspace(ws.id);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeFileName(ws.name)}.vision-board.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast.success('Workspace exported');
  } catch (e) {
    toast.error(`Export failed: ${errMsg(e)}`);
  }
}

/** Result of reading a chosen file: shown in the import preview dialog before anything is written. */
export type PendingImport = { fileName: string; result: ImportPreviewResult };

interface ImportState {
  pending: PendingImport | null;
  set: (p: PendingImport | null) => void;
}
export const useImportStore = create<ImportState>((set) => ({ pending: null, set: (pending) => set({ pending }) }));

/** Read + validate a file and open the preview dialog. Nothing is written until the user confirms. */
export async function importFromFile(file: File): Promise<void> {
  let text: string;
  try {
    text = await file.text();
  } catch (e) {
    toast.error(`Could not read this file: ${errMsg(e)}`);
    return;
  }
  const existing = (await db.workspaces.toArray()).map((w) => w.name);
  useImportStore.getState().set({ fileName: file.name, result: previewImport(text, file.name, existing) });
}

/** Confirmed import: always a NEW workspace (ids are remapped; nothing existing is touched). */
export async function confirmImport(data: WorkspaceExport): Promise<Workspace | undefined> {
  try {
    const ws = await importWorkspace(data);
    await updateSettings({ lastWorkspaceId: ws.id });
    useUiStore.getState().selectNode(null);
    useUiStore.getState().requestFit();
    toast.success(`Imported "${ws.name}"`);
    return ws;
  } catch (e) {
    toast.error(e instanceof ImportError ? `Import failed: ${e.message}` : `Could not import this file: ${errMsg(e)}`);
    return undefined;
  }
}

async function useNew(make: () => Promise<Workspace>, label: string): Promise<void> {
  try {
    const ws = await make();
    await updateSettings({ lastWorkspaceId: ws.id, onboardingDone: true });
    useUiStore.getState().selectNode(null);
    useUiStore.getState().requestFit();
    toast.success(label);
  } catch (e) {
    toast.error(errMsg(e));
  }
}

export const addSample = () => useNew(createSampleWorkspace, 'Sample workspace added');
export const addStressSample = () => useNew(() => createLargeSampleWorkspace(400), '400-node stress sample added');
