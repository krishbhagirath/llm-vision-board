import { describe, it, expect, beforeEach } from 'vitest';
import { assistantMessages, extractMarkdown, providerMessageId, turnState } from '@/providers/chatgpt/dom';

// Mirrors the chatgpt.com structure observed in Nov 2026 (attribute names only).
const turn = (state: string, id: string, body: string) => `
  <div data-turn-key="t-${id}"><div data-content-search-turn-key="fallback-turn-0">
    <div class="group flex flex-col" data-talvt-turn-state="${state}"><div class="block">
      <div data-chatgpt-search-unit-key="fallback-turn-0:2:assistant" data-chatgpt-search-message-ids="${id} ${id}">
        <div class="group" data-chatgpt-selection-message-id="${id}">
          <div data-markdown-text-style="assistant-message" class="MarkdownRoot-x">
            <div data-dil-source-message-id="${id}"><div data-dil-response="" data-dil-message-id="${id}">${body}</div></div>
          </div>
        </div>
      </div>
    </div></div>
  </div></div>`;

describe('ChatGPT 2026-11 markup', () => {
  beforeEach(() => {
    document.body.innerHTML = turn('complete', 'bfa42385', '<h2>Neural networks</h2><ol><li>Layers of neurons</li><li>Weights</li></ol>');
  });

  it('finds the assistant message, its id and turn state', () => {
    const msgs = assistantMessages();
    expect(msgs).toHaveLength(1);
    expect(providerMessageId(msgs[0]!)).toBe('bfa42385');
    expect(turnState(msgs[0]!)).toBe('complete');
  });

  it('extracts markdown from the assistant-message root', () => {
    const md = extractMarkdown(assistantMessages()[0]!);
    expect(md).toContain('## Neural networks');
    expect(md).toMatch(/1\.\s+Layers of neurons/);
  });

  it('reports non-complete turn state while streaming', () => {
    document.body.innerHTML = turn('streaming', 'abc', '<p>partial</p>');
    expect(turnState(assistantMessages()[0]!)).toBe('streaming');
  });
});
