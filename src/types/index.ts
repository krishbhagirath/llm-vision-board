/**
 * Core domain model. Deliberately independent of React Flow / any visual library.
 * All timestamps are epoch milliseconds.
 */

export type ID = string;

export type LayoutMode = 'tree' | 'board' | 'outline' | 'chat';

export interface WorkspaceSettings {
  /** Direction used by the auto tree layout. */
  treeDirection: 'TB' | 'LR';
  /** Show the minimap on graph canvases. */
  showMinimap: boolean;
}

export interface Workspace {
  id: ID;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  layout: LayoutMode;
  settings: WorkspaceSettings;
  /** Last selected node, restored when reopening the workspace. */
  selectedNodeId: ID | null;
}

export type NodeType = 'topic' | 'question' | 'explanation' | 'note';

export interface Position {
  x: number;
  y: number;
}

export interface GraphNode {
  id: ID;
  workspaceId: ID;
  parentId: ID | null;
  type: NodeType;
  title: string;
  question: string;
  /** Short summary used for context packages (user-editable; auto-filled deterministically). */
  summary: string;
  /** Passage of the parent's answer this branch was created from, if any. */
  sourcePassage: string | null;
  /** Message the passage came from (for reference/back-navigation). */
  sourceMessageId: ID | null;
  createdAt: number;
  updatedAt: number;
  /** Manual position for freeform board mode. */
  position: Position;
  collapsed: boolean;
  /** Currently active logical conversation for this node. Older ones stay linked via Conversation.nodeId. */
  conversationId: ID | null;
  /** Sibling ordering (lower first). */
  order: number;
  /** Plain-text excerpt of the latest complete answer (denormalized for cheap graph previews). */
  answerPreview: string;
  /** When the latest complete answer arrived; null = not answered yet. */
  answeredAt: number | null;
}

export type EdgeType = 'child' | 'link';

export interface GraphEdge {
  id: ID;
  workspaceId: ID;
  source: ID;
  target: ID;
  type: EdgeType;
  label?: string;
}

export type ProviderId = 'chatgpt-web' | 'manual';

export type ConversationStatus = 'active' | 'archived';

export interface ConversationContextMeta {
  /** Context package that was sent as the first prompt of this logical conversation. */
  initialPackageId: ID | null;
  /** If this conversation was started from a handoff snapshot. */
  handoffSnapshotId: ID | null;
  /** Approximate tokens of everything sent so far (estimate, not exact). */
  approxTokensSent: number;
  warnings: string[];
}

export interface Conversation {
  id: ID;
  nodeId: ID;
  workspaceId: ID;
  provider: ProviderId;
  /** e.g. https://chatgpt.com/c/<id> – null until the provider assigns one. */
  providerUrl: string | null;
  status: ConversationStatus;
  context: ConversationContextMeta;
  createdAt: number;
  updatedAt: number;
}

export type MessageRole = 'user' | 'assistant' | 'system';

/**
 * pending   – waiting for the provider to start answering
 * streaming – partial content arriving
 * complete  – final content
 * failed    – provider/automation error
 * interrupted – tab closed / reloaded / service worker lost the stream
 * cancelled – user cancelled
 */
export type MessageStatus = 'pending' | 'streaming' | 'complete' | 'failed' | 'interrupted' | 'cancelled';

export interface Message {
  id: ID;
  conversationId: ID;
  workspaceId: ID;
  role: MessageRole;
  content: string;
  createdAt: number;
  updatedAt: number;
  status: MessageStatus;
  /** Provider-side message id (ChatGPT data-message-id) if observed. */
  providerMessageRef: string | null;
  /** For user messages: the full prompt actually sent (may include a context package). */
  sentPrompt: string | null;
  /** How the content arrived. */
  source: 'automation' | 'manual-paste' | 'tab-capture' | 'user';
  error: string | null;
}

export type HandoffStatus = 'draft' | 'confirmed' | 'applied' | 'discarded';

export interface ContextSnapshotContent {
  objective: string;
  concepts: string[];
  explanations: string[];
  definitions: string[];
  constraints: string[];
  decisions: string[];
  unresolved: string[];
  messageRefs: ID[];
  graphPosition: string[];
}

export interface ContextSnapshot {
  id: ID;
  nodeId: ID;
  workspaceId: ID;
  /** Conversation that was summarized. */
  conversationId: ID | null;
  sourceNodeIds: ID[];
  kind: 'context-package' | 'handoff';
  /** Rendered text actually used as prompt content. */
  summary: string;
  content: ContextSnapshotContent | null;
  approxTokens: number;
  createdAt: number;
  version: number;
  handoffStatus: HandoffStatus | null;
}

export type RequestStatus =
  | 'queued'
  | 'dispatching'
  | 'submitted'
  | 'streaming'
  | 'complete'
  | 'failed'
  | 'interrupted'
  | 'cancelled';

export const ACTIVE_REQUEST_STATUSES: readonly RequestStatus[] = ['dispatching', 'submitted', 'streaming'];
export const TERMINAL_REQUEST_STATUSES: readonly RequestStatus[] = ['complete', 'failed', 'interrupted', 'cancelled'];

/** Persisted provider request. Survives service-worker restarts. */
export interface ProviderRequest {
  id: ID;
  workspaceId: ID;
  nodeId: ID;
  conversationId: ID;
  userMessageId: ID;
  assistantMessageId: ID;
  provider: ProviderId;
  prompt: string;
  /** Provider conversation to continue; null = start a new provider conversation. */
  targetUrl: string | null;
  status: RequestStatus;
  error: string | null;
  /** Human-readable step within the status (e.g. "Switching ChatGPT conversation…"). */
  detail?: string | null;
  tabId: number | null;
  attempt: number;
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
}

export interface AppSettings {
  /** Experimental: drive the ChatGPT page DOM to submit prompts and read responses. */
  chatgptAutomation: boolean;
  theme: 'system' | 'light' | 'dark';
  /** Seconds with no observable progress before a request is considered failed. */
  requestTimeoutSec: number;
  /** Approximate token budget above which a handoff is suggested. */
  handoffSuggestTokens: number;
  /** Experimental: automatically start a handoff conversation when the budget is exceeded (after confirmation dialog). */
  autoHandoff: boolean;
  onboardingDone: boolean;
  lastWorkspaceId: ID | null;
  /**
   * Switch ChatGPT conversations by clicking ChatGPT's own links (no page reload) when the
   * page structure allows it safely; falls back to a full reload otherwise.
   */
  softNavigation: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  chatgptAutomation: false,
  theme: 'system',
  requestTimeoutSec: 180,
  handoffSuggestTokens: 24000,
  autoHandoff: false,
  onboardingDone: false,
  lastWorkspaceId: null,
  softNavigation: true,
};

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  treeDirection: 'LR',
  showMinimap: true,
};
