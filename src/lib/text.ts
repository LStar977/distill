/** Text helpers shared by the pipeline and the dataset generator. */

/** URL/id-safe slug: lower-case, ascii, dashes. */
export function slugify(input: string, max = 48): string {
  const s = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (s || "x").slice(0, max).replace(/-+$/g, "");
}

/** Lower-case, collapse whitespace, strip surrounding punctuation. Used for label matching. */
export function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .replace(/^[\s"'.,;:!?-]+|[\s"'.,;:!?-]+$/g, "")
    .trim();
}

/** Collapse whitespace and trim; used for dedupe keys. */
export function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Split into sentences, keeping terminal punctuation. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+(?=[^\s])/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** The longest sentence of a text, or the whole text when it has one sentence. */
export function longestSentence(text: string): string {
  const parts = splitSentences(text);
  if (parts.length === 0) return text.trim();
  return parts.reduce((best, s) => (s.length > best.length ? s : best), "");
}

/**
 * Locate `quote` inside `text`. Tries an exact match, then a whitespace/quote
 * normalized match, then a case-insensitive one. Returns the span in the
 * original text or null when the quote is not a real substring.
 */
export function findSpan(text: string, quote: string): { start: number; end: number; text: string } | null {
  const candidates = [quote, quote.trim(), quote.trim().replace(/^["'“”‘’]+|["'“”‘’.]+$/g, "")];
  for (const c of candidates) {
    if (c.length === 0) continue;
    const idx = text.indexOf(c);
    if (idx >= 0) return { start: idx, end: idx + c.length, text: text.slice(idx, idx + c.length) };
  }
  const lower = text.toLowerCase();
  for (const c of candidates) {
    if (c.length === 0) continue;
    const idx = lower.indexOf(c.toLowerCase());
    if (idx >= 0) return { start: idx, end: idx + c.length, text: text.slice(idx, idx + c.length) };
  }
  return null;
}

/** Word count for prose; strips markdown punctuation first. */
export function countWords(markdown: string): number {
  const stripped = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[item:[^\]]+\]/g, " ")
    .replace(/[#*_>`|~\-]+/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  return stripped.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** "3,214" */
export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** "$1.87" */
export function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** "78%" */
export function fmtPct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
