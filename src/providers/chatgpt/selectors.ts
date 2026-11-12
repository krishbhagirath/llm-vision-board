/**
 * ChatGPT DOM selectors — the ONLY place that knows about chatgpt.com's markup.
 * ChatGPT changes its UI frequently; when automation breaks, update these lists first.
 * Each list is tried in order; the first match wins.
 * Last reviewed: 2026-11.
 */
export const SEL = {
  composer: ['#prompt-textarea', 'div[contenteditable="true"].ProseMirror', 'form textarea'],
  sendButton: ['button[data-testid="send-button"]', '#composer-submit-button', 'button[aria-label="Send prompt"]', 'button[aria-label*="Send" i]'],
  stopButton: ['button[data-testid="stop-button"]', 'button[aria-label*="Stop" i]'],
  /** Tried in order; the first selector that matches anything on the page is used. */
  // 2026-11 markup: role is encoded at the end of data-chatgpt-search-unit-key ("fallback-turn-0:2:assistant").
  assistantMessage: [
    '[data-chatgpt-search-unit-key$=":assistant"]',
    '[data-content-search-unit-key$=":assistant"]',
    '[data-message-author-role="assistant"]',
    '[data-turn="assistant"]',
    'article[data-testid^="conversation-turn"][data-turn="assistant"]',
  ],
  userMessage: [
    '[data-chatgpt-search-unit-key$=":user"]',
    '[data-content-search-unit-key$=":user"]',
    '[data-message-author-role="user"]',
    '[data-turn="user"]',
    'article[data-testid^="conversation-turn"][data-turn="user"]',
  ],
  /** Per-turn lifecycle attribute ("complete" when finished) — 2026-11 markup. */
  turnState: 'data-talvt-turn-state',
  /** Attributes whose changes the response tracker must observe. */
  observedAttributes: ['data-testid', 'aria-label', 'disabled', 'data-talvt-turn-state', 'data-message-id'],
  /** Attributes carrying a stable provider message id, in preference order. */
  messageIdAttrs: ['data-message-id', 'data-chatgpt-selection-message-id', 'data-dil-message-id', 'data-dil-source-message-id'],
  /** Whole conversation turns, used as a last resort when roles aren't marked. */
  turn: 'article[data-testid^="conversation-turn"], [data-testid^="conversation-turn"]',
  markdown: ['[data-markdown-text-style="assistant-message"]', '.markdown', '[data-dil-response]', '[class*="markdown"]', '.prose'],
  /** ChatGPT's own "New chat" control (clicked for no-reload switching). */
  newChat: [
    'a[data-testid="create-new-chat-button"]',
    'button[data-testid="create-new-chat-button"]',
    'a[aria-label="New chat" i]',
    'button[aria-label="New chat" i]',
  ],
  loggedOutHints: ['button[data-testid="login-button"]', 'a[href*="/auth/login"]', 'button[data-testid="signup-button"]'],
  errorHints: ['[data-testid*="error" i]', '.text-token-text-error', '.text-red-500'],
} as const;

export function queryFirst<T extends Element = HTMLElement>(root: ParentNode, selectors: readonly string[]): T | null {
  for (const s of selectors) {
    const el = root.querySelector<T & Element>(s);
    if (el) return el;
  }
  return null;
}
