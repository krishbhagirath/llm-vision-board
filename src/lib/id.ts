export function newId(): string {
  return crypto.randomUUID();
}

export function now(): number {
  return Date.now();
}

export function truncate(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Collapse whitespace for robust text comparisons. */
export function normalizeWs(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
