import { describe, expect, it } from 'vitest';
import { suggestFollowUps } from '@/features/suggestions/heuristics';

describe('suggestFollowUps', () => {
  const md = `# Title ignored (h1)

Intro with **Gradient Descent** and **Learning Rate**.

## Optimizers
- Momentum: smooths updates
- Adam: adaptive rates

### Regularization
1. Dropout: randomly zero units

\`\`\`python
## not a heading
**not bold**
- fake: item
\`\`\`
`;

  it('extracts headings, bold terms and list leads with origins', () => {
    const out = suggestFollowUps(md, [], 50);
    const byTerm = new Map(out.map((s) => [s.term, s]));
    expect(byTerm.get('Optimizers')?.origin).toBe('heading');
    expect(byTerm.get('Regularization')?.origin).toBe('heading');
    expect(byTerm.get('Gradient Descent')?.origin).toBe('bold');
    expect(byTerm.get('Learning Rate')?.origin).toBe('bold');
    expect(byTerm.get('Momentum')?.origin).toBe('list-lead');
    expect(byTerm.get('Dropout')?.origin).toBe('list-lead');
    for (const s of out) expect(s.question.endsWith('?')).toBe(true);
    expect(byTerm.get('Optimizers')!.question).toBe('What are optimizers, and how do they fit here?');
  });

  it('does not treat h1 as a suggestion', () => {
    expect(suggestFollowUps(md).some((s) => s.term.startsWith('Title'))).toBe(false);
  });

  it('skips fenced code blocks entirely', () => {
    const out = suggestFollowUps(md, [], 50);
    expect(out.some((s) => /not a heading|not bold|fake/.test(s.term))).toBe(false);
  });

  it('dedupes against existing titles (case-insensitive) and repeated terms', () => {
    const out = suggestFollowUps('## Alpha\n**alpha** and **Beta** and **Beta**', ['ALPHA']);
    expect(out.map((s) => s.term)).toEqual(['Beta']);
  });

  it('caps the number of suggestions', () => {
    const many = Array.from({ length: 20 }, (_, i) => `## Topic number ${i}`).join('\n');
    expect(suggestFollowUps(many)).toHaveLength(5);
    expect(suggestFollowUps(many, [], 3)).toHaveLength(3);
    expect(suggestFollowUps(many, [], 100)).toHaveLength(20);
  });

  it('keeps question-shaped terms and drops stop words / too-short / too-long terms', () => {
    const out = suggestFollowUps('## Summary\n## Example\n## Why does it work\n**ab**\n## ' + 'x'.repeat(80));
    expect(out.map((s) => s.term)).toEqual(['Why does it work']);
    expect(out[0]!.question).toBe('Why does it work?');
  });

  it('returns nothing for plain prose', () => {
    expect(suggestFollowUps('Just a plain sentence without structure.')).toEqual([]);
  });
});
