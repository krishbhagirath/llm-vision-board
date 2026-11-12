import Dexie, { type EntityTable } from 'dexie';
import type {
  AppSettings,
  Conversation,
  ContextSnapshot,
  GraphEdge,
  GraphNode,
  Message,
  ProviderRequest,
  Workspace,
} from '@/types';
import { DEFAULT_SETTINGS } from '@/types';
import { makeAnswerPreview } from '@/lib/preview';

interface SettingsRow {
  key: 'app';
  value: AppSettings;
}

/**
 * Single IndexedDB database shared by every extension context (board tab, side panel,
 * background service worker). They all run on the chrome-extension:// origin, so they
 * see the same data; Dexie's liveQuery propagates changes between contexts.
 */
export class VisionBoardDB extends Dexie {
  workspaces!: EntityTable<Workspace, 'id'>;
  nodes!: EntityTable<GraphNode, 'id'>;
  edges!: EntityTable<GraphEdge, 'id'>;
  conversations!: EntityTable<Conversation, 'id'>;
  messages!: EntityTable<Message, 'id'>;
  snapshots!: EntityTable<ContextSnapshot, 'id'>;
  requests!: EntityTable<ProviderRequest, 'id'>;
  settings!: EntityTable<SettingsRow, 'key'>;

  constructor(name = 'llm-vision-board') {
    super(name);
    this.version(1).stores({
      workspaces: 'id, updatedAt',
      nodes: 'id, workspaceId, parentId, updatedAt',
      edges: 'id, workspaceId, source, target',
      conversations: 'id, nodeId, workspaceId',
      messages: 'id, conversationId, workspaceId, [conversationId+createdAt]',
      snapshots: 'id, nodeId, workspaceId',
      requests: 'id, status, createdAt, nodeId, conversationId',
      settings: 'key',
    });
    // v2: denormalized answer previews on nodes (no index change; backfill existing data).
    this.version(2)
      .stores({})
      .upgrade(async (tx) => {
        const messages = (await tx.table('messages').toArray()) as Message[];
        const latest = new Map<string, Message>();
        for (const m of messages) {
          if (m.role !== 'assistant' || m.status !== 'complete' || !m.content.trim()) continue;
          const prev = latest.get(m.conversationId);
          if (!prev || m.createdAt > prev.createdAt) latest.set(m.conversationId, m);
        }
        await tx
          .table('nodes')
          .toCollection()
          .modify((n: GraphNode) => {
            const m = n.conversationId ? latest.get(n.conversationId) : undefined;
            n.answerPreview = m ? makeAnswerPreview(m.content) : (n.answerPreview ?? '');
            n.answeredAt = m ? m.updatedAt : (n.answeredAt ?? null);
          });
      });
  }
}

export let db = new VisionBoardDB();

/** Test helper: swap in an isolated database. */
export function useDatabase(instance: VisionBoardDB): void {
  db = instance;
}

export async function getSettings(): Promise<AppSettings> {
  const row = await db.settings.get('app');
  return { ...DEFAULT_SETTINGS, ...(row?.value ?? {}) };
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  return db.transaction('rw', db.settings, async () => {
    const next = { ...(await getSettings()), ...patch };
    await db.settings.put({ key: 'app', value: next });
    return next;
  });
}
