import { describe, expect, it } from "vitest";
import { cacheHitRate, costOf, pricingFor, resolveModels } from "./models";

describe("pricing", () => {
  it("bills input, output, cache reads at 10% and cache writes at 125%", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 };
    // sonnet: 2 + 1 (output) + 0.2 (read) + 2.5 (write) = 5.7
    expect(costOf("claude-sonnet-5", usage)).toBeCloseTo(5.7, 6);
    // opus: 5 + 2.5 + 0.5 + 6.25 = 14.25
    expect(costOf("claude-opus-5", usage)).toBeCloseTo(14.25, 6);
    // haiku: 1 + 0.5 + 0.1 + 1.25 = 2.85
    expect(costOf("claude-haiku-4-5", usage)).toBeCloseTo(2.85, 6);
  });

  it("falls back by family for unknown ids", () => {
    expect(pricingFor("claude-opus-4-8")).toEqual(pricingFor("claude-opus-5"));
    expect(pricingFor("claude-haiku-9")).toEqual(pricingFor("claude-haiku-4-5"));
    expect(pricingFor("something-else")).toEqual(pricingFor("claude-sonnet-5"));
  });

  it("computes cache hit rate over all prompt tokens", () => {
    expect(cacheHitRate({ inputTokens: 200, outputTokens: 50, cacheReadTokens: 800, cacheWriteTokens: 0 })).toBeCloseTo(0.8);
    expect(cacheHitRate({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(0);
  });
});

describe("resolveModels", () => {
  it("uses sonnet/opus by default and haiku for fast depth", () => {
    expect(resolveModels("thorough", {})).toEqual({ extract: "claude-sonnet-5", synth: "claude-opus-5" });
    expect(resolveModels("fast", {})).toEqual({ extract: "claude-haiku-4-5", synth: "claude-opus-5" });
  });
  it("honours env overrides", () => {
    expect(resolveModels("fast", { DISTILL_EXTRACT_MODEL: "claude-sonnet-5", DISTILL_SYNTH_MODEL: "claude-sonnet-5" })).toEqual({
      extract: "claude-sonnet-5",
      synth: "claude-sonnet-5",
    });
  });
});
