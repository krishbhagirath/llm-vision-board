import { describe, expect, it } from 'vitest';
import { db } from '@/storage/db';
import { EXPORT_VERSION, exportWorkspace, ImportError, parseExport, previewImport } from '@/storage/exportImport';
import { addMessage, seedTree } from './helpers';

async function validJson() {
  const { ws, child } = await seedTree();
  await addMessage(child.id, 'user', 'hello');
  await addMessage(child.id, 'assistant', 'answer');
  const data = await exportWorkspace(ws.id);
  return { ws, data, json: JSON.stringify(data) };
}

describe('previewImport', () => {
  it('describes a valid file with counts and writes nothing', async () => {
    const { json, data } = await validJson();
    const before = { ws: await db.workspaces.count(), nodes: await db.nodes.count(), msgs: await db.messages.count() };
    const r = previewImport(json, 'mine.vision-board.json');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.preview.fileName).toBe('mine.vision-board.json');
    expect(r.preview.workspaceName).toBe('WS');
    expect(r.preview.version).toBe(EXPORT_VERSION);
    expect(r.preview.counts).toEqual({
      nodes: 3,
      edges: data.edges.length,
      conversations: data.conversations.length,
      messages: 2,
      snapshots: 0,
    });
    expect(r.preview.warnings).toEqual([]);
    expect({ ws: await db.workspaces.count(), nodes: await db.nodes.count(), msgs: await db.messages.count() }).toEqual(before);
  });

  it('reports invalid JSON', () => {
    const r = previewImport('{nope', 'x.json');
    expect(r).toMatchObject({ ok: false, code: 'invalid-json' });
  });

  it('reports a wrong format (valid JSON, other app)', () => {
    expect(previewImport(JSON.stringify({ hello: 1 }))).toMatchObject({ ok: false, code: 'wrong-format' });
    expect(previewImport(JSON.stringify([1, 2]))).toMatchObject({ ok: false, code: 'wrong-format' });
    expect(previewImport('null')).toMatchObject({ ok: false, code: 'wrong-format' });
  });

  it('reports a newer export version distinctly', async () => {
    const { data } = await validJson();
    const r = previewImport(JSON.stringify({ ...data, version: EXPORT_VERSION + 1 }));
    expect(r).toMatchObject({ ok: false, code: 'newer-version' });
    if (!r.ok) expect(r.message).toMatch(/newer version/);
  });

  it('reports schema problems', async () => {
    const { data } = await validJson();
    const r = previewImport(JSON.stringify({ ...data, nodes: 'oops' }));
    expect(r).toMatchObject({ ok: false, code: 'invalid-schema' });
  });

  it('reports integrity errors (missing parent, duplicate ids, cycles)', async () => {
    const { data } = await validJson();
    const d1 = structuredClone(data);
    d1.nodes[1]!.parentId = 'ghost';
    expect(previewImport(JSON.stringify(d1))).toMatchObject({ ok: false, code: 'integrity' });
    const d2 = structuredClone(data);
    d2.nodes[1]!.id = d2.nodes[0]!.id;
    expect(previewImport(JSON.stringify(d2))).toMatchObject({ ok: false, code: 'integrity' });
    const d3 = structuredClone(data);
    const root = d3.nodes.find((n) => n.parentId === null)!;
    root.parentId = d3.nodes.find((n) => n.title === 'Grand')!.id;
    expect(previewImport(JSON.stringify(d3))).toMatchObject({ ok: false, code: 'integrity' });
  });

  it('keeps the legacy throwing API and exposes the error code', async () => {
    let err: unknown;
    try {
      parseExport('{bad');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ImportError);
    expect((err as ImportError).code).toBe('invalid-json');
  });

  it('warns about dropped links, unfinished answers, ChatGPT links and name clashes', async () => {
    const { data } = await validJson();
    const d = structuredClone(data);
    d.edges.push({ id: 'bad', workspaceId: d.workspace.id, source: 'ghost', target: d.nodes[0]!.id, type: 'link' });
    d.messages[1]!.status = 'streaming';
    d.conversations[0]!.providerUrl = 'https://chatgpt.com/c/abc';
    const r = previewImport(JSON.stringify(d), 'f.json', ['WS']);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const w = r.preview.warnings.join('\n');
    expect(w).toMatch(/1 link point to missing nodes/);
    expect(w).toMatch(/1 unfinished answer will be marked as interrupted/);
    expect(w).toMatch(/linked to ChatGPT/);
    expect(w).toMatch(/already exists/);
  });
});
