import { createWorkspace } from '@/features/workspaces/workspaceOps';
import { createNode } from '@/features/graph/graphOps';
import type { ID, Workspace } from '@/types';

/**
 * Sample data for exercising the graph layouts. Nodes only — NO fake ChatGPT
 * answers are created; the sample is clearly named as a sample.
 */
interface Spec {
  title: string;
  question: string;
  children?: Spec[];
}

const NEURAL_NETWORKS: Spec = {
  title: 'Neural Networks',
  question: 'Explain neural networks.',
  children: [
    { title: 'Forward Propagation', question: 'How does forward propagation compute an output?' },
    { title: 'Activation Functions', question: 'Why do neural networks need non-linear activation functions?', children: [{ title: 'ReLU vs Sigmoid', question: 'When is ReLU preferred over sigmoid?' }] },
    {
      title: 'Backpropagation',
      question: 'How does backpropagation work?',
      children: [
        {
          title: 'Chain Rule',
          question: 'Why does backpropagation use the chain rule?',
          children: [
            { title: 'Partial Derivatives', question: 'What is a partial derivative in this context?' },
            { title: 'Gradient Computation', question: 'How are gradients computed layer by layer?' },
          ],
        },
      ],
    },
    { title: 'Gradient Descent', question: 'What is gradient descent?', children: [{ title: 'Learning Rate', question: 'How do I choose a learning rate?' }] },
  ],
};

async function build(workspaceId: ID, spec: Spec, parentId: ID | null): Promise<number> {
  const node = await createNode({ workspaceId, parentId, title: spec.title, question: spec.question });
  let count = 1;
  for (const c of spec.children ?? []) count += await build(workspaceId, c, node.id);
  return count;
}

export async function createSampleWorkspace(): Promise<Workspace> {
  const ws = await createWorkspace('Sample: Neural Networks', 'Sample graph (no answers) for trying out layouts.');
  await build(ws.id, NEURAL_NETWORKS, null);
  return ws;
}

/** Synthetic large workspace for performance checks (titles only). */
export async function createLargeSampleWorkspace(nodeCount = 400): Promise<Workspace> {
  const ws = await createWorkspace(`Sample: ${nodeCount}-node stress test`, 'Generated for performance testing. No answers.');
  const ids: ID[] = [];
  for (let i = 0; i < nodeCount; i++) {
    const parentId = i === 0 ? null : ids[Math.floor((i - 1) / 4)]!;
    const n = await createNode({ workspaceId: ws.id, parentId, title: `Concept ${i + 1}`, question: `Sample question ${i + 1}` });
    ids.push(n.id);
  }
  return ws;
}
