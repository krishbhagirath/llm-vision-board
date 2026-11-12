import { isValidElement, memo, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import { Check, Copy } from 'lucide-react';

/** Concatenate the text of a React node tree (used to copy a code block's source). */
export function nodeText(n: ReactNode): string {
  if (n == null || typeof n === 'boolean') return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(nodeText).join('');
  if (isValidElement<{ children?: ReactNode }>(n)) return nodeText(n.props.children);
  return '';
}

/** "language-python" -> "python". */
export function languageOf(className: string | undefined): string | null {
  const m = /(?:^|\s)language-([\w+#-]+)/.exec(className ?? '');
  return m ? m[1]! : null;
}

function CopyCodeButton({ getText }: { getText: () => string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      aria-label={done ? 'Copied' : 'Copy code'}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(getText());
          setDone(true);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard unavailable: nothing to confirm */
        }
      }}
      className="md-code-copy"
    >
      {done ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
      <span>{done ? 'Copied' : 'Copy'}</span>
    </button>
  );
}

function CodeBlock({ children }: ComponentProps<'pre'>) {
  const code = isValidElement<{ className?: string; children?: ReactNode }>(children) ? children : null;
  const lang = languageOf(code?.props.className);
  return (
    <div className="md-code">
      <div className="md-code-bar select-none" data-no-branch>
        <span className="md-code-lang">{lang ?? 'text'}</span>
        <CopyCodeButton getText={() => nodeText(children).replace(/\n$/, '')} />
      </div>
      <pre tabIndex={0} aria-label={lang ? `${lang} code` : 'Code'}>
        {children}
      </pre>
    </div>
  );
}

/**
 * Renders untrusted LLM Markdown. No rehype-raw: raw HTML is never rendered.
 * Links open in a new tab; images are replaced by a link (no remote loading).
 * Tables scroll horizontally; code blocks get a language label and a Copy button.
 */
const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  img: ({ src, alt }) => (
    <a href={typeof src === 'string' ? src : undefined} target="_blank" rel="noopener noreferrer">
      [image{alt ? `: ${alt}` : ''}]
    </a>
  ),
  pre: CodeBlock,
  table: ({ children }) => (
    <div className="md-table" tabIndex={0} role="region" aria-label="Table">
      <table>{children}</table>
    </div>
  ),
};

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins: React.ComponentProps<typeof ReactMarkdown>['rehypePlugins'] = [
  [rehypeKatex, { throwOnError: false }],
  [rehypeHighlight, { detect: false, ignoreMissing: true }],
];

/** Memoized per `content`: re-renders only when the text (or class) changes, so long threads stay cheap while a different message streams. */
export const Markdown = memo(function Markdown({ content, className = '' }: { content: string; className?: string }) {
  return (
    <div className={`md ${className}`}>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components} skipHtml>
        {content}
      </ReactMarkdown>
    </div>
  );
});
