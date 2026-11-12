import TurndownService from 'turndown';
import { normalizeWs } from '@/lib/id';
import { SEL, queryFirst } from './selectors';

/**
 * Pure DOM helpers for the ChatGPT page. They only read the visible page and
 * interact with the visible composer, exactly as the user would. No network
 * interception, no cookies/tokens, no private endpoints.
 */

export function findComposer(doc: Document = document): HTMLElement | null {
  return queryFirst<HTMLElement>(doc, SEL.composer);
}
export function findSendButton(doc: Document = document): HTMLButtonElement | null {
  return queryFirst<HTMLButtonElement>(doc, SEL.sendButton);
}
export function findStopButton(doc: Document = document): HTMLButtonElement | null {
  return queryFirst<HTMLButtonElement>(doc, SEL.stopButton);
}
export function isGenerating(doc: Document = document): boolean {
  return !!findStopButton(doc);
}
export function loggedOutHint(doc: Document = document): boolean {
  return !!queryFirst(doc, SEL.loggedOutHints);
}
function firstNonEmpty(doc: Document, selectors: readonly string[]): HTMLElement[] | null {
  for (const s of selectors) {
    const found = [...doc.querySelectorAll<HTMLElement>(s)];
    if (found.length) return found;
  }
  return null;
}

/** Last resort: classify unlabeled conversation turns by their screen-reader heading ("You said" / "ChatGPT said"). */
function turnsByRole(doc: Document, role: 'user' | 'assistant'): HTMLElement[] {
  return [...doc.querySelectorAll<HTMLElement>(SEL.turn)].filter((t) => {
    const attr = t.getAttribute('data-turn');
    if (attr) return attr === role;
    const heading = (t.querySelector('h1,h2,h3,h4,h5,h6,.sr-only')?.textContent ?? '').toLowerCase();
    if (/you said/.test(heading)) return role === 'user';
    if (/chatgpt said|assistant/.test(heading)) return role === 'assistant';
    return false;
  });
}

export function assistantMessages(doc: Document = document): HTMLElement[] {
  return firstNonEmpty(doc, SEL.assistantMessage) ?? turnsByRole(doc, 'assistant');
}
export function userMessages(doc: Document = document): HTMLElement[] {
  return firstNonEmpty(doc, SEL.userMessage) ?? turnsByRole(doc, 'user');
}

/** Read-only snapshot of what the selectors see — shown in the board when capture fails. */
export function describePage(doc: Document = document): string {
  const count = (s: string) => doc.querySelectorAll(s).length;
  const parts = [
    ...SEL.assistantMessage.map((s) => `${s}=${count(s)}`),
    ...SEL.userMessage.map((s) => `${s}=${count(s)}`),
    `turns=${count(SEL.turn)}`,
    `turnStates=${[...doc.querySelectorAll(`[${SEL.turnState}]`)].map((e) => e.getAttribute(SEL.turnState)).slice(-3).join('|')}`,
    ...SEL.markdown.map((s) => `${s}=${count(s)}`),
    `stop=${isGenerating(doc)}`,
  ];
  return parts.join(', ');
}
/** Stable provider message id for a message element (own attribute or a descendant's), if any. */
export function providerMessageId(el: Element): string | null {
  for (const attr of SEL.messageIdAttrs) {
    const v = el.getAttribute(attr) ?? el.querySelector(`[${attr}]`)?.getAttribute(attr);
    if (v) return v;
  }
  return null;
}
export function messageKey(el: Element, index: number): string {
  return providerMessageId(el) ?? `idx:${index}`;
}

/**
 * Lifecycle state of the turn containing `el` ('complete' when finished), or null
 * when the page doesn't expose one (older markup).
 */
export function turnState(el: Element): string | null {
  return el.closest(`[${SEL.turnState}]`)?.getAttribute(SEL.turnState) ?? null;
}

export function composerText(el: HTMLElement): string {
  return el instanceof HTMLTextAreaElement ? el.value : (el.innerText ?? el.textContent ?? '');
}

/**
 * Put text into the composer the same way a user paste would.
 * ProseMirror (ChatGPT's editor) handles paste events with text/plain reliably,
 * including newlines. Falls back to execCommand('insertText').
 */
export function setComposerText(el: HTMLElement, text: string): void {
  el.focus();
  if (el instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  try {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  } catch {
    /* DataTransfer unavailable – fall through */
  }
  if (!normalizeWs(composerText(el))) {
    document.execCommand('insertText', false, text);
  }
}

let turndown: TurndownService | null = null;
function getTurndown(): TurndownService {
  if (turndown) return turndown;
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
  // KaTeX → TeX source
  td.addRule('katex-display', {
    filter: (node) => node instanceof HTMLElement && node.classList.contains('katex-display'),
    replacement: (_c, node) => {
      const tex = (node as HTMLElement).querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? '';
      return tex ? `\n\n$$\n${tex.trim()}\n$$\n\n` : '';
    },
  });
  td.addRule('katex-inline', {
    filter: (node) => node instanceof HTMLElement && node.classList.contains('katex'),
    replacement: (_c, node) => {
      const tex = (node as HTMLElement).querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? '';
      return tex ? `$${tex.trim()}$` : '';
    },
  });
  // ChatGPT code blocks: <pre> with a header (language + copy button) and a <code class="language-x">
  td.addRule('chatgpt-pre', {
    filter: 'pre',
    replacement: (_c, node) => {
      const code = (node as HTMLElement).querySelector('code');
      const lang = [...(code?.classList ?? [])].find((c) => c.startsWith('language-'))?.slice(9) ?? '';
      const text = (code ?? node).textContent ?? '';
      return `\n\n\`\`\`${lang}\n${text.replace(/\n$/, '')}\n\`\`\`\n\n`;
    },
  });
  td.remove(['button', 'style', 'script']);
  td.remove((node) => node.nodeName.toLowerCase() === 'svg');
  turndown = td;
  return td;
}

/** Convert an assistant message element to Markdown (best effort). */
export function extractMarkdown(messageEl: HTMLElement): string {
  // The last markdown block in the turn is the answer (earlier ones can be "thinking" summaries).
  let md: HTMLElement | null = null;
  for (const s of SEL.markdown) {
    const all = messageEl.matches(s) ? [messageEl] : [...messageEl.querySelectorAll<HTMLElement>(s)];
    if (all.length) {
      md = all.at(-1)!;
      break;
    }
  }
  if (!md) return (messageEl.innerText ?? messageEl.textContent ?? '').trim();
  return getTurndown().turndown(md.cloneNode(true) as HTMLElement).trim();
}

/** Wait (via MutationObserver, not polling) until `probe` returns a value or timeout. */
export function waitFor<T>(probe: () => T | null | undefined | false, timeoutMs: number, root: Node = document.documentElement): Promise<T | null> {
  return new Promise((resolve) => {
    const first = probe();
    if (first) return resolve(first);
    const obs = new MutationObserver(() => {
      const v = probe();
      if (v) {
        cleanup();
        resolve(v);
      }
    });
    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);
    const cleanup = () => {
      obs.disconnect();
      clearTimeout(timer);
    };
    obs.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
  });
}

/** True if a user-message element contains the start of the prompt we submitted. */
export function promptMatches(userEl: Element | undefined, prompt: string): boolean {
  if (!userEl) return false;
  const shown = normalizeWs(userEl.textContent ?? '');
  const head = normalizeWs(prompt).slice(0, 60);
  return !!head && shown.includes(head);
}
