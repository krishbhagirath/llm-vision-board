/** Plain-text excerpt of an answer for graph cards (dependency-free; safe in any context). */
export function makeAnswerPreview(markdown: string, max = 180): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    // Inline math is unreadable as raw TeX in a one-line preview.
    .replace(/\$[^$\n]+\$/g, '(formula)')
    // A heading followed by text: keep the boundary readable ("Heading: text").
    .replace(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm, (_m, h: string) => (/[:.?!]$/.test(h) ? h : `${h}:`))
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
    .replace(/(^|\W)_{1,3}([^_]+?)_{1,3}(?=\W|$)/g, '$1$2')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
