import { bg } from '@/lib/bgClient';
import { queueAutomatedMessage } from '@/features/conversations/conversationService';
import { createNodeAndSelect } from '@/features/graph/ui/nodeActions';
import { toast, errMsg } from '@/components/toastStore';
import type { GraphNode, ID } from '@/types';

/** Queue a message for ChatGPT automation then wake the background worker. Returns true if queued. */
export async function sendAutomated(nodeId: ID, text: string): Promise<boolean> {
  try {
    await queueAutomatedMessage(nodeId, text);
  } catch (e) {
    toast.error(errMsg(e));
    return false;
  }
  try {
    await bg.kick();
  } catch {
    toast.error('Message queued, but the background worker could not be reached. Reload the extension page and try again.');
  }
  return true;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export interface BranchRequest {
  parent: GraphNode;
  question: string;
  /** Selected text from the parent's answer, if branching from a passage. */
  passage: string | null;
  /** Assistant message the branch comes from. */
  messageId: ID | null;
  /** Send immediately (only honoured in automation mode). */
  send: boolean;
  title?: string;
}

/** Create a child node (ancestor-only context is built later from the tree), select it, optionally send. */
export async function createBranch(req: BranchRequest): Promise<GraphNode | undefined> {
  const question = req.question.trim();
  if (!question) return undefined;
  const child = await createNodeAndSelect({
    workspaceId: req.parent.workspaceId,
    parentId: req.parent.id,
    question,
    title: req.title,
    sourcePassage: req.passage,
    sourceMessageId: req.messageId,
  });
  if (child && req.send) await sendAutomated(child.id, question);
  return child;
}

const AUTO_SEND_KEY = 'lvb.branchAutoSend';

/** "Send right away" preference for new branches; remembered per browser profile. Defaults to on. */
export function readBranchAutoSend(): boolean {
  try {
    return localStorage.getItem(AUTO_SEND_KEY) !== '0';
  } catch {
    return true;
  }
}
export function writeBranchAutoSend(v: boolean): void {
  try {
    localStorage.setItem(AUTO_SEND_KEY, v ? '1' : '0');
  } catch {
    /* storage unavailable: preference just won't persist */
  }
}
