import { describe, expect, it } from 'vitest';
import { breakdown, contextLine, describeContext } from '@/features/context/ui/contextSummary';
import type { ContextItem } from '@/features/context/contextBuilder';

const item = (kind: ContextItem['kind'], title = 't'): ContextItem => ({ kind, nodeId: null, title, text: 'x', approxTokens: 5 });

describe('describeContext', () => {
  it('describes ancestors plus passage', () => {
    const items = [item('ancestor'), item('ancestor'), item('ancestor'), item('source-passage')];
    expect(describeContext(items, true)).toBe('Inherits context from 3 ancestors + selected passage');
  });
  it('singular and extras', () => {
    expect(describeContext([item('ancestor'), item('linked'), item('linked'), item('handoff')], true)).toBe(
      'Inherits context from 1 ancestor + 2 linked concepts + handoff summary',
    );
  });
  it('works without ancestors (e.g. only a workspace goal or passage)', () => {
    expect(describeContext([item('workspace')], true)).toBe('Inherits context from workspace goal');
    expect(describeContext([item('source-passage')], true)).toBe('Inherits context from selected passage');
    expect(describeContext([], true)).toBe('No earlier context to include');
    expect(describeContext(null, true)).toBe('No earlier context to include');
  });
  it('later turns continue the ChatGPT conversation', () => {
    expect(describeContext(null, false)).toBe('Continues this ChatGPT conversation');
  });
  it('always labels tokens as estimates', () => {
    expect(contextLine([item('ancestor')], true, 420)).toBe('Inherits context from 1 ancestor · ≈420 tokens (est.)');
    expect(contextLine(null, false, 2400)).toContain('(est.)');
    expect(contextLine(null, false, 0)).toBe('Continues this ChatGPT conversation');
  });
  it('breaks items down by kind', () => {
    const b = breakdown([item('ancestor'), item('workspace'), item('source-passage')]);
    expect(b.ancestors).toHaveLength(1);
    expect(b.passage).not.toBeNull();
    expect(b.workspace).not.toBeNull();
    expect(b.handoff).toBeNull();
  });
});
