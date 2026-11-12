import { describe, it, expect, beforeEach } from 'vitest';
import { assistantMessages, userMessages, extractMarkdown, describePage } from '@/providers/chatgpt/dom';

describe('ChatGPT DOM fallbacks (markup without data-message-author-role)', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <article data-testid="conversation-turn-1" data-turn="user"><h5 class="sr-only">You said:</h5><div>Explain X</div></article>
      <article data-testid="conversation-turn-2" data-turn="assistant"><h6 class="sr-only">ChatGPT said:</h6>
        <div class="markdown prose"><p>thinking summary</p></div>
        <div class="markdown prose"><h2>Answer</h2><p>Final <strong>text</strong></p></div>
      </article>`;
  });

  it('finds turns via data-turn', () => {
    expect(assistantMessages()).toHaveLength(1);
    expect(userMessages()).toHaveLength(1);
  });

  it('classifies unlabeled turns by screen-reader heading', () => {
    document.querySelectorAll('article').forEach((a) => a.removeAttribute('data-turn'));
    expect(assistantMessages()).toHaveLength(1);
    expect(userMessages()).toHaveLength(1);
  });

  it('extracts the last markdown block of the turn', () => {
    const md = extractMarkdown(assistantMessages()[0]!);
    expect(md).toContain('## Answer');
    expect(md).toContain('**text**');
    expect(md).not.toContain('thinking summary');
  });

  it('describePage reports selector counts', () => {
    expect(describePage()).toContain('[data-turn="assistant"]=1');
  });
});
