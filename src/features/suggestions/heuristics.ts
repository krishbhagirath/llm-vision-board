import { truncate } from '@/lib/id';

/**
 * HEURISTIC follow-up suggestions. This is NOT semantic/AI analysis: it scans an
 * answer's Markdown for headings, bold terms, and list-item lead phrases, ranks them by
 * structure and position, and phrases each as a question. The UI must label these as heuristic.
 */
export interface Suggestion {
  question: string;
  term: string;
  origin: 'heading' | 'bold' | 'list-lead';
}

/** Section labels that say nothing about a topic. Compared lowercase, after cleaning. */
const GENERIC = new Set([
  'note',
  'notes',
  'summary',
  'tl;dr',
  'tldr',
  'example',
  'examples',
  'conclusion',
  'conclusions',
  'overview',
  'introduction',
  'intro',
  'background',
  'key takeaways',
  'takeaways',
  'key points',
  'in short',
  'in summary',
  'why it matters',
  'important',
  'tip',
  'tips',
  'warning',
  'caution',
  'recap',
  'final thoughts',
  'next steps',
  'bottom line',
  'the bottom line',
  'quick answer',
  'short answer',
  'pros',
  'cons',
  'pros and cons',
  'yes',
  'no',
  'step',
  'steps',
  'definition',
  'answer',
]);

const MAX_CHARS = 60;
const MAX_WORDS = 8;
const MIN_CHARS = 3;

function clean(term: string): string {
  return term
    .replace(/[*_`#]+/g, '')
    .replace(/\[([^\]]*)]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/^\d+(?:\.\d+)*[.)]?\s+/, '')
    .replace(/^[\p{Extended_Pictographic}\s]+/u, '')
    .replace(/[:.;,!\s]+$/, '')
    .trim();
}

/** Dedupe key: lowercase, no leading article, light plural folding on the last word. */
export function termKey(term: string): string {
  const words = term
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  while (words.length > 1 && /^(the|a|an)$/.test(words[0]!)) words.shift();
  const last = words.length - 1;
  if (last >= 0 && words[last]!.length > 3 && /[^s]s$/.test(words[last]!) && !/(ss|us|is)$/.test(words[last]!)) words[last] = words[last]!.slice(0, -1);
  return words.join(' ');
}

function isGeneric(term: string): boolean {
  const key = term.toLowerCase();
  if (GENERIC.has(key)) return true;
  if (/^(step|part|section|chapter|option|case)\s*\d+$/i.test(term)) return true;
  if (/^[\d\s.,%$-]+$/.test(term)) return true;
  return false;
}

const QUESTION_START = /^(how|why|what|when|where|which|who|can|could|should|does|do|is|are|will)\b/i;

function lowerFirstWords(term: string): string {
  // Lower-case Title-Case words ("Gradient Descent" -> "gradient descent") but keep acronyms/mixed case (ReLU, GPU).
  return term
    .split(' ')
    .map((w) => (/^[A-Z][a-z]+$/.test(w) ? w.toLowerCase() : w))
    .join(' ');
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Turn a heading / bold term into a natural-sounding question. */
export function toQuestion(term: string): string {
  if (/\?$/.test(term)) return cap(term);
  const how = /^how\s+(.+?)\s+works$/i.exec(term);
  if (how) return `How does ${lowerFirstWords(how[1]!)} work?`;
  const howTo = /^how to\s+(.+)$/i.exec(term);
  if (howTo) return `How do I ${lowerFirstWords(howTo[1]!)}?`;
  if (QUESTION_START.test(term)) return `${cap(term)}?`;
  const phrase = lowerFirstWords(term);
  const first = term.split(' ')[0]!;
  // "Choosing a learning rate" -> "Can you walk me through choosing a learning rate?"
  if (/^[A-Za-z]{4,}ing$/.test(first) && !/^(thing|string|ring|king|bring|spring|nothing|something|anything|everything|during|morning|evening)$/i.test(first)) {
    return `Can you walk me through ${phrase}?`;
  }
  const words = term.split(' ');
  const last = words[words.length - 1]!;
  const plural = last.length > 3 && /s$/i.test(last) && !/(ss|us|is)$/i.test(last) && !/^[A-Z0-9]+$/.test(last);
  return plural ? `What are ${phrase}, and how do they fit here?` : `What is ${phrase}, and how does it fit here?`;
}

interface Candidate {
  term: string;
  origin: Suggestion['origin'];
  /** Higher = better. */
  score: number;
  index: number;
}

const HEADING_BASE: Record<number, number> = { 2: 10, 3: 8, 4: 6 };

export function suggestFollowUps(markdown: string, existingTitles: readonly string[] = [], max = 5): Suggestion[] {
  const md = markdown.replace(/```[\s\S]*?```/g, '');
  const total = Math.max(1, md.length);
  const seen = new Set(existingTitles.map(termKey));
  const best = new Map<string, Candidate>();
  const boldCounts = new Map<string, number>();

  const consider = (raw: string, origin: Suggestion['origin'], base: number, at: number) => {
    const term = clean(raw);
    if (term.length < MIN_CHARS || term.length > MAX_CHARS) return;
    if (term.split(' ').length > MAX_WORDS) return;
    if (isGeneric(term)) return;
    // Whole sentences are not topics.
    if (/[.!]\s+\p{L}/u.test(term) || /[.!]$/.test(term)) return;
    const key = termKey(term);
    if (!key || seen.has(key)) return;
    // Earlier in the answer = more central. Bonus fades from +3 at the top to 0 at the end.
    const score = base + 3 * (1 - at / total);
    const prev = best.get(key);
    if (!prev || score > prev.score) best.set(key, { term, origin, score, index: at });
  };

  for (const m of md.matchAll(/^(#{2,4})\s+(.+)$/gm)) consider(m[2]!, 'heading', HEADING_BASE[m[1]!.length] ?? 6, m.index ?? 0);
  for (const m of md.matchAll(/\*\*([^*\n]{3,70})\*\*/g)) {
    const k = termKey(clean(m[1]!));
    boldCounts.set(k, (boldCounts.get(k) ?? 0) + 1);
  }
  for (const m of md.matchAll(/\*\*([^*\n]{3,70})\*\*/g)) {
    const repeat = (boldCounts.get(termKey(clean(m[1]!))) ?? 1) - 1;
    consider(m[1]!, 'bold', 4 + Math.min(2, repeat), m.index ?? 0);
  }
  for (const m of md.matchAll(/^\s*(?:[-*]|\d+\.)\s+(?:\*\*)?([^:\n*]{3,50}?)(?:\*\*)?:/gm)) consider(m[1]!, 'list-lead', 3, m.index ?? 0);

  return [...best.values()]
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, max)
    .map((c) => ({ term: truncate(c.term, MAX_CHARS), question: toQuestion(c.term), origin: c.origin }));
}
