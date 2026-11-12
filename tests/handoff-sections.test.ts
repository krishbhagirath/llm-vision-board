import { describe, expect, it } from 'vitest';
import { HANDOFF_SECTIONS, extractHandoffContent, filterHandoffContent, renderHandoff, sectionCount, type HandoffSectionKey } from '@/features/context/handoff';
import { seedTree, addMessage } from './helpers';
import { db } from '@/storage/db';
import { listMessages } from '@/features/conversations/conversationService';

async function sample() {
  const { child, root } = await seedTree();
  await addMessage(child.id, 'user', 'I must keep this simple. Let us assume small data.');
  await addMessage(child.id, 'assistant', '## Gradient descent\n\nGradient descent is a method for minimising a function.\n\nUse **learning rate** carefully.');
  await addMessage(child.id, 'user', 'What about momentum?');
  const msgs = await listMessages((await db.nodes.get(child.id))!.conversationId!);
  return extractHandoffContent(child, [root], msgs);
}

const ALL = new Set<HandoffSectionKey>(HANDOFF_SECTIONS.map((s) => s.key));

describe('handoff sections', () => {
  it('lists every section the extractor can produce', () => {
    expect(HANDOFF_SECTIONS.map((s) => s.key)).toEqual(['objective', 'concepts', 'definitions', 'explanations', 'constraints', 'decisions', 'unresolved']);
  });

  it('includes everything by default and matches renderHandoff', async () => {
    const c = await sample();
    expect(renderHandoff(filterHandoffContent(c, ALL))).toBe(renderHandoff(c));
    expect(sectionCount(c, 'concepts')).toBeGreaterThan(0);
    expect(sectionCount(c, 'objective')).toBe(1);
  });

  it('leaves excluded sections out of the rendered text', async () => {
    const c = await sample();
    const without = new Set(ALL);
    without.delete('concepts');
    without.delete('objective');
    const text = renderHandoff(filterHandoffContent(c, without));
    expect(text).not.toContain('Key concepts covered');
    expect(text).not.toContain('Learning objective');
    expect(text).toContain('Still unresolved');
    expect(text).toContain('Position in study map');
    expect(renderHandoff(c)).toContain('Key concepts covered');
  });

  it('does not mutate the source content', async () => {
    const c = await sample();
    const before = JSON.stringify(c);
    filterHandoffContent(c, new Set());
    expect(JSON.stringify(c)).toBe(before);
  });
});
