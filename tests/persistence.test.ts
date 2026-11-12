import { describe, it, expect } from 'vitest';
import { db, getSettings, updateSettings } from '@/storage/db';
import { DEFAULT_SETTINGS } from '@/types';
import {
  createWorkspace,
  deleteWorkspace,
  listWorkspaces,
  renameWorkspace,
  updateWorkspace,
} from '@/features/workspaces/workspaceOps';
import { addLink, createNode } from '@/features/graph/graphOps';
import { getOrCreateConversation, listMessages, setConversationUrl } from '@/features/conversations/conversationService';
import { ImportError, exportWorkspace, importWorkspace, parseExport, type WorkspaceExport } from '@/storage/exportImport';
import { addMessage, seedTree } from './helpers';

describe('workspaces', () => {
  it('creates, renames, lists and sets lastWorkspaceId', async () => {
    const ws = await createWorkspace('  My WS  ', 'desc');
    expect(ws.name).toBe('My WS');
    expect(ws.layout).toBe('tree');
    expect((await getSettings()).lastWorkspaceId).toBe(ws.id);
    await renameWorkspace(ws.id, ' Renamed ');
    expect((await db.workspaces.get(ws.id))!.name).toBe('Renamed');
    await renameWorkspace(ws.id, '   ');
    expect((await db.workspaces.get(ws.id))!.name).toBe('Renamed');
    expect((await createWorkspace('')).name).toBe('Untitled workspace');
    expect(await listWorkspaces()).toHaveLength(2);
  });

  it('updateWorkspace merges nested settings', async () => {
    const ws = await createWorkspace('x');
    await updateWorkspace(ws.id, { settings: { treeDirection: 'TB' } });
    const got = (await db.workspaces.get(ws.id))!;
    expect(got.settings).toEqual({ treeDirection: 'TB', showMinimap: true });
  });

  it('deleteWorkspace cascades to every table and leaves other workspaces alone', async () => {
    const { ws, child } = await seedTree();
    await addMessage(child.id, 'user', 'hi');
    await db.snapshots.add({
      id: 's1', nodeId: child.id, workspaceId: ws.id, conversationId: null, sourceNodeIds: [], kind: 'handoff',
      summary: 's', content: null, approxTokens: 1, createdAt: 1, version: 1, handoffStatus: 'draft',
    });
    const other = await createWorkspace('keep');
    const keepNode = await createNode({ workspaceId: other.id, title: 'k' });
    await deleteWorkspace(ws.id);
    expect(await db.workspaces.get(ws.id)).toBeUndefined();
    expect(await db.nodes.where('workspaceId').equals(ws.id).count()).toBe(0);
    expect(await db.edges.where('workspaceId').equals(ws.id).count()).toBe(0);
    expect(await db.conversations.where('workspaceId').equals(ws.id).count()).toBe(0);
    expect(await db.messages.where('workspaceId').equals(ws.id).count()).toBe(0);
    expect(await db.snapshots.where('workspaceId').equals(ws.id).count()).toBe(0);
    expect(await db.nodes.get(keepNode.id)).toBeDefined();
  });
});

describe('settings', () => {
  it('returns defaults, then merges updates', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.chatgptAutomation).toBe(false);
    const next = await updateSettings({ chatgptAutomation: true, theme: 'dark' });
    expect(next.chatgptAutomation).toBe(true);
    await updateSettings({ requestTimeoutSec: 30 });
    expect(await getSettings()).toEqual({ ...DEFAULT_SETTINGS, chatgptAutomation: true, theme: 'dark', requestTimeoutSec: 30 });
  });
});

describe('conversations and messages', () => {
  it('saves and reloads messages in createdAt order', async () => {
    const { child } = await seedTree();
    await addMessage(child.id, 'user', 'first');
    await addMessage(child.id, 'assistant', 'second');
    await addMessage(child.id, 'user', 'third');
    const conv = await getOrCreateConversation(child.id);
    expect((await listMessages(conv.id)).map((m) => m.content)).toEqual(['first', 'second', 'third']);
    // idempotent
    expect((await getOrCreateConversation(child.id)).id).toBe(conv.id);
    expect((await db.nodes.get(child.id))!.conversationId).toBe(conv.id);
  });
});

async function buildRichWorkspace() {
  const { ws, root, child, grand } = await seedTree();
  const sib = await createNode({ workspaceId: ws.id, parentId: root.id, title: 'Sibling' });
  await addLink(ws.id, grand.id, sib.id, 'related');
  await addMessage(child.id, 'user', 'Q child');
  await addMessage(child.id, 'assistant', '# Answer\n**bold**');
  await addMessage(grand.id, 'user', 'Q grand');
  await addMessage(grand.id, 'assistant', 'partial...', 'streaming');
  await addMessage(sib.id, 'assistant', 'pending one', 'pending');
  const conv = await getOrCreateConversation(child.id);
  await setConversationUrl(conv.id, 'https://chatgpt.com/c/abc-123');
  await db.nodes.update(root.id, { summary: 'root summary' });
  return { ws, root, child, grand, sib };
}

async function roundTrip(wsId: string) {
  const json = JSON.stringify(await exportWorkspace(wsId));
  return { json, data: parseExport(json) };
}

describe('export / import', () => {
  it('round-trips the same shape with NEW ids', async () => {
    const { ws, root, child, grand, sib } = await buildRichWorkspace();
    const { data } = await roundTrip(ws.id);
    const imported = await importWorkspace(data);
    expect(imported.id).not.toBe(ws.id);
    expect(imported.name).toBe('WS (imported)');

    const nodes = await db.nodes.where('workspaceId').equals(imported.id).toArray();
    expect(nodes).toHaveLength(4);
    const oldIds = new Set([root.id, child.id, grand.id, sib.id]);
    expect(nodes.every((n) => !oldIds.has(n.id))).toBe(true);
    const byTitle = new Map(nodes.map((n) => [n.title, n]));
    expect(byTitle.get('Root')!.parentId).toBeNull();
    expect(byTitle.get('Root')!.summary).toBe('root summary');
    expect(byTitle.get('Child')!.parentId).toBe(byTitle.get('Root')!.id);
    expect(byTitle.get('Grand')!.parentId).toBe(byTitle.get('Child')!.id);
    expect(byTitle.get('Sibling')!.parentId).toBe(byTitle.get('Root')!.id);

    const edges = await db.edges.where('workspaceId').equals(imported.id).toArray();
    expect(edges.filter((e) => e.type === 'child')).toHaveLength(3);
    const link = edges.find((e) => e.type === 'link')!;
    expect(link.source).toBe(byTitle.get('Grand')!.id);
    expect(link.target).toBe(byTitle.get('Sibling')!.id);
    expect(link.label).toBe('related');

    const childNode = byTitle.get('Child')!;
    expect(childNode.conversationId).toBeTruthy();
    const conv = (await db.conversations.get(childNode.conversationId!))!;
    expect(conv.workspaceId).toBe(imported.id);
    expect(conv.nodeId).toBe(childNode.id);
    expect(conv.providerUrl).toBe('https://chatgpt.com/c/abc-123');
    const msgs = await listMessages(conv.id);
    expect(msgs.map((m) => m.content)).toEqual(['Q child', '# Answer\n**bold**']);
    expect(msgs.every((m) => m.workspaceId === imported.id)).toBe(true);

    // original untouched
    expect(await db.nodes.where('workspaceId').equals(ws.id).count()).toBe(4);
  });

  it('importing twice does not collide', async () => {
    const { ws } = await buildRichWorkspace();
    const { data } = await roundTrip(ws.id);
    const a = await importWorkspace(data);
    const b = await importWorkspace(data);
    expect(a.id).not.toBe(b.id);
    expect(await db.workspaces.count()).toBe(3);
    expect(await db.nodes.count()).toBe(12);
    expect(await db.conversations.count()).toBe(3 * 3);
  });

  it('turns pending/streaming messages into interrupted on import', async () => {
    const { ws } = await buildRichWorkspace();
    const { data } = await roundTrip(ws.id);
    const imported = await importWorkspace(data);
    const msgs = await db.messages.where('workspaceId').equals(imported.id).toArray();
    expect(msgs.find((m) => m.content === 'partial...')!.status).toBe('interrupted');
    expect(msgs.find((m) => m.content === 'pending one')!.status).toBe('interrupted');
    expect(msgs.find((m) => m.content === 'Q child')!.status).toBe('complete');
    expect(msgs.some((m) => m.status === 'pending' || m.status === 'streaming')).toBe(false);
  });

  it('repairs a missing child edge for a parent relation', async () => {
    const { ws } = await buildRichWorkspace();
    const { data } = await roundTrip(ws.id);
    data.edges = data.edges.filter((e) => e.type !== 'child');
    const imported = await importWorkspace(data);
    const edges = await db.edges.where('workspaceId').equals(imported.id).toArray();
    expect(edges.filter((e) => e.type === 'child')).toHaveLength(3);
  });

  it('exportWorkspace throws for an unknown workspace', async () => {
    await expect(exportWorkspace('nope')).rejects.toThrow();
  });
});

describe('corrupted imports', () => {
  async function validExport(): Promise<WorkspaceExport> {
    const { ws } = await buildRichWorkspace();
    return JSON.parse(JSON.stringify(await exportWorkspace(ws.id)));
  }
  const expectImportError = (json: string, match: RegExp) => {
    let err: unknown;
    try {
      parseExport(json);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ImportError);
    expect((err as Error).message).toMatch(match);
  };

  it('rejects invalid JSON', () => {
    expectImportError('{not json', /not valid JSON/i);
  });

  it('rejects wrong format', async () => {
    const d = await validExport();
    expectImportError(JSON.stringify({ ...d, format: 'something-else' }), /Not a valid LLM Vision Board export/);
    expectImportError(JSON.stringify([1, 2, 3]), /Not a valid/);
  });

  it('rejects a node with a missing parent', async () => {
    const d = await validExport();
    d.nodes[1]!.parentId = 'ghost';
    expectImportError(JSON.stringify(d), /missing parent/);
  });

  it('rejects a parent/child cycle', async () => {
    const d = await validExport();
    const root = d.nodes.find((n) => n.parentId === null)!;
    const leaf = d.nodes.find((n) => n.title === 'Grand')!;
    root.parentId = leaf.id; // root -> child -> grand -> root
    expectImportError(JSON.stringify(d), /cycle/i);
  });

  it('rejects duplicate node ids', async () => {
    const d = await validExport();
    d.nodes[1]!.id = d.nodes[0]!.id;
    expectImportError(JSON.stringify(d), /Duplicate node ids/);
  });

  it('rejects non-chatgpt providerUrl', async () => {
    const d = await validExport();
    d.conversations[0]!.providerUrl = 'https://evil.example.com/c/1';
    expectImportError(JSON.stringify(d), /chatgpt\.com/);
  });
});
