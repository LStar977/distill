import type { Depth } from "../lib/types";

/** Model IDs. No date suffixes — these are the current aliases. */
export const MODEL_IDS = {
  opus: "claude-opus-5",
  sonnet: "claude-sonnet-5",
  haiku: "claude-haiku-4-5",
} as const;

export type ModelId = (typeof MODEL_IDS)[keyof typeof MODEL_IDS];

/** $ per million tokens. */
export interface Pricing {
  input: number;
  output: number;
}

export const PRICING: Record<ModelId, Pricing> = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

/** Cache reads bill at 10% of the input price; cache writes (5-minute TTL) at 125%. */
export const CACHE_READ_MULTIPLIER = 0.1;
export const CACHE_WRITE_MULTIPLIER = 1.25;

/** Normalized usage for one call (or a running total). */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export const EMPTY_USAGE: Readonly<TokenUsage> = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

function isModelId(model: string): model is ModelId {
  return Object.prototype.hasOwnProperty.call(PRICING, model);
}

/**
 * Pricing for a model id. Unknown ids (an env override pointing at a newer
 * snapshot, say) fall back to their family — opus / sonnet / haiku — and then
 * to sonnet pricing, so a run never fails on cost accounting.
 */
export function pricingFor(model: string): Pricing {
  if (isModelId(model)) return PRICING[model];
  const m = model.toLowerCase();
  if (m.includes("opus")) return PRICING["claude-opus-5"];
  if (m.includes("haiku")) return PRICING["claude-haiku-4-5"];
  return PRICING["claude-sonnet-5"];
}

/** Cost in USD for one call's usage on a given model. */
export function costOf(model: string, usage: TokenUsage): number {
  const p = pricingFor(model);
  const perTok = 1 / 1_000_000;
  return (
    usage.inputTokens * p.input * perTok +
    usage.cacheReadTokens * p.input * CACHE_READ_MULTIPLIER * perTok +
    usage.cacheWriteTokens * p.input * CACHE_WRITE_MULTIPLIER * perTok +
    usage.outputTokens * p.output * perTok
  );
}

/** Share of prompt tokens that were served from cache, 0–1. */
export function cacheHitRate(usage: TokenUsage): number {
  const prompt = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  return prompt === 0 ? 0 : usage.cacheReadTokens / prompt;
}

export interface ModelChoice {
  /** Bulk per-item extraction. */
  extract: string;
  /** Taxonomy, consolidation, opportunity writing, the brief. */
  synth: string;
}

/**
 * Resolve the models for a run. Env overrides win; `fast` depth drops
 * extraction to Haiku when no override is set.
 */
export function resolveModels(depth: Depth, env: Record<string, string | undefined> = process.env): ModelChoice {
  const extractOverride = env.DISTILL_EXTRACT_MODEL?.trim();
  const synthOverride = env.DISTILL_SYNTH_MODEL?.trim();
  return {
    extract: extractOverride || (depth === "fast" ? MODEL_IDS.haiku : MODEL_IDS.sonnet),
    synth: synthOverride || MODEL_IDS.opus,
  };
}
