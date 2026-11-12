/**
 * APPROXIMATE token estimate. ChatGPT's real tokenizer is not available locally,
 * so this uses the widely-cited ~4 characters per token heuristic for English,
 * blended with a word count to behave better on code / short words.
 * Always display results with "≈" — this is NOT an exact count.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const chars = text.length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return Math.ceil(Math.max(chars / 4, words * 1.3));
}

export function formatTokenEstimate(n: number): string {
  if (n >= 1000) return `≈${(n / 1000).toFixed(1)}k tokens (est.)`;
  return `≈${n} tokens (est.)`;
}
