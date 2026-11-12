import { describe, expect, it } from 'vitest';
import { suggestFollowUps, termKey } from '@/features/suggestions/heuristics';

describe('suggestFollowUps ranking and phrasing', () => {
  it('ranks headings above bold terms above list leads', () => {
    const md = '**Zeta term** early.\n\n- Lead item: x\n\n## Alpha topic\n\n### Beta topic\n';
    const terms = suggestFollowUps(md, [], 10).map((s) => s.term);
    expect(terms).toEqual(['Alpha topic', 'Beta topic', 'Zeta term', 'Lead item']);
  });

  it('prefers earlier headings at the same level', () => {
    const md = '## First one\n\nlots of text here to push things further down the answer.\n\n## Second one\n';
    expect(suggestFollowUps(md).map((s) => s.term)).toEqual(['First one', 'Second one']);
  });

  it('rewards repeated bold terms', () => {
    const md = '**Once only** and **Twice used** then **Twice used** again.';
    expect(suggestFollowUps(md)[0]!.term).toBe('Twice used');
  });

  it('drops generic labels, numbered steps, sentences and bare numbers', () => {
    const md = '## Key takeaways\n## Step 2\n## Pros and cons\n**Note:** hi\n**4242**\n**This is a whole sentence. It continues.**\n## Real topic';
    expect(suggestFollowUps(md).map((s) => s.term)).toEqual(['Real topic']);
  });

  it('drops terms longer than eight words', () => {
    expect(suggestFollowUps('## one two three four five six seven eight nine')).toEqual([]);
  });

  it('dedupes plurals and leading articles against existing titles and each other', () => {
    const out = suggestFollowUps('## The Optimizer\n**optimizers**\n## Loss function\n**Loss functions**', ['Optimizers']);
    expect(out.map((s) => s.term)).toEqual(['Loss function']);
    expect(termKey('The Optimizers')).toBe(termKey('optimizer'));
  });

  it('phrases how/why headings naturally', () => {
    const q = (h: string) => suggestFollowUps(`## ${h}`)[0]!.question;
    expect(q('How backpropagation works')).toBe('How does backpropagation work?');
    expect(q('How to choose a learning rate')).toBe('How do I choose a learning rate?');
    expect(q('Why momentum helps')).toBe('Why momentum helps?');
    expect(q('what is overfitting?')).toBe('What is overfitting?');
  });

  it('phrases noun phrases and gerunds', () => {
    const q = (h: string) => suggestFollowUps(`## ${h}`)[0]!.question;
    expect(q('Gradient Descent')).toBe('What is gradient descent, and how does it fit here?');
    expect(q('Choosing a learning rate')).toBe('Can you walk me through choosing a learning rate?');
    expect(q('Optimizers')).toBe('What are optimizers, and how do they fit here?');
  });

  it('caps at five by default', () => {
    const md = Array.from({ length: 12 }, (_, i) => `## Topic ${String.fromCharCode(97 + i)}x`).join('\n');
    expect(suggestFollowUps(md)).toHaveLength(5);
  });
});
