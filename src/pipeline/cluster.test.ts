import { describe, expect, it } from "vitest";
import type { Extraction, Item } from "../lib/types";
import { aggregateThemes, applyDecision, applyMergeMap, bucketIndex, minSupport, resolveMergeMap, sentimentSplit } from "./cluster";
import { LabelLedger } from "./extract";
import { finalizeTaxonomy, OTHER_LABEL } from "./taxonomy";

const taxonomy = finalizeTaxonomy({
  themes: [
    { name: "Rest timer unreliable in background", short: "Rest timer", description: "d1" },
    { name: "Subscription price vs. value", short: "Subscription", description: "d2" },
    { name: "Never mentioned", short: "Never", description: "d3" },
  ],
});

function ex(itemId: string, themes: string[], sentiment: Extraction["sentiment"], severity: Extraction["severity"], quote = "q"): Extraction {
  return { itemId, sentiment, severity, themes, painPoints: [], featureRequests: [], quotes: [{ start: 0, end: quote.length, text: quote }], segments: [] };
}

describe("merge map", () => {
  it("resolves chains and breaks cycles at Other", () => {
    expect(resolveMergeMap({ a: "b", b: "c" })).toEqual({ a: "c", b: "c" });
    expect(resolveMergeMap({ a: "b", b: "a" })).toEqual({ a: OTHER_LABEL, b: OTHER_LABEL });
  });
  it("applies to extractions and dedupes", () => {
    const e = applyMergeMap(ex("1", ["timer bugs", "Rest timer unreliable in background", OTHER_LABEL], "negative", 4), { "timer bugs": "Rest timer unreliable in background" });
    expect(e.themes).toEqual(["Rest timer unreliable in background"]);
  });
  it("minSupport scales with dataset size", () => {
    expect(minSupport(100)).toBe(2);
    expect(minSupport(3214)).toBe(5);
  });
});

describe("applyDecision", () => {
  const ledger = new LabelLedger(taxonomy);
  ledger.add(ex("1", ["Rest timer unreliable in background"], "negative", 4), []);
  ledger.add(ex("2", ["timer bugs"], "negative", 4), ["timer bugs"]);
  ledger.add(ex("3", ["Battery drain"], "negative", 3), ["Battery drain"]);
  ledger.add(ex("4", ["Vague stuff"], "neutral", 1), ["Vague stuff"]);
  ledger.add(ex("5", ["Subscription price vs. value"], "mixed", 3), []);
  ledger.add(ex("6", ["Weak match"], "neutral", 1), ["Weak match"]);
  const stats = Array.from(ledger.stats.values());

  it("merges (≥ 0.6), promotes named raw labels, folds the rest into Other, drops empty taxonomy themes", () => {
    const out = applyDecision(
      { taxonomy, stats, folded: [] },
      {
        merges: [
          { label: "timer bugs", into: "rest timer unreliable in background", similarity: 0.91 },
          { label: "Weak match", into: "Subscription price vs. value", similarity: 0.3 },
        ],
        themes: [
          { label: "Rest timer unreliable in background", name: "Rest timer unreliable in background", short: "Rest timer", description: "Timer dies in background." },
          { label: "Battery drain", name: "Battery drain during workouts", short: "Battery", description: "Drains battery." },
          { label: "Subscription price vs. value", name: "Subscription price vs. value", short: "Subscription", description: "Price." },
        ],
      },
    );
    expect(out.merges).toEqual([{ fromLabel: "timer bugs", fromId: "raw-timer-bugs", intoLabel: "Rest timer unreliable in background", intoId: "rest-timer-unreliable-in-background", similarity: 0.91 }]);
    expect(out.mergeMap["timer bugs"]).toBe("Rest timer unreliable in background");
    expect(out.mergeMap["Vague stuff"]).toBe(OTHER_LABEL);
    expect(out.mergeMap["Weak match"]).toBe(OTHER_LABEL);
    expect(out.unplaced.sort()).toEqual(["Vague stuff", "Weak match"]);
    expect(out.droppedEmpty).toEqual(["Never mentioned"]);
    const ids = out.defs.map((d) => d.id);
    expect(ids).toEqual(["rest-timer-unreliable-in-background", "subscription-price-vs-value", "battery-drain-during-workouts", "other"]);
    expect(out.defs[0]?.sourceLabels).toEqual(["Rest timer unreliable in background", "timer bugs"]);
    expect(out.defs.at(-1)?.sourceLabels).toEqual(expect.arrayContaining([OTHER_LABEL, "Vague stuff", "Weak match"]));
  });
});

describe("aggregation", () => {
  it("sentimentSplit sums to 100 with largest remainder", () => {
    expect(sentimentSplit({ positive: 1, neutral: 1, negative: 1, mixed: 0 })).toEqual([34, 33, 33]);
    expect(sentimentSplit({ positive: 0, neutral: 0, negative: 0, mixed: 0 })).toEqual([0, 100, 0]);
    expect(sentimentSplit({ positive: 6, neutral: 6, negative: 82, mixed: 6 })).toEqual([6, 12, 82]);
  });

  it("buckets dates oldest first", () => {
    const range = { fromMs: Date.parse("2025-08-01"), toMs: Date.parse("2026-09-09") };
    expect(bucketIndex("2025-08-01", range)).toBe(0);
    expect(bucketIndex("2026-09-09", range)).toBe(7);
    expect(bucketIndex(undefined, range)).toBeNull();
  });

  it("computes counts, share, split, severity, trend, examples and ranks with Other last", () => {
    const items: Item[] = [
      { id: "1", source: "A", text: "a", date: "2026-01-01" },
      { id: "2", source: "A", text: "b", date: "2026-01-02" },
      { id: "3", source: "A", text: "c", date: "2026-08-01" },
      { id: "4", source: "A", text: "d", date: "2026-08-02" },
      { id: "5", source: "A", text: "e" },
      { id: "6", source: "B", text: "f", date: "2026-08-03" },
      { id: "7", source: "B", text: "g", date: "2026-08-04" },
      { id: "8", source: "B", text: "h", date: "2026-08-05" },
    ];
    const extractions = new Map<string, Extraction>([
      ["1", ex("1", ["T"], "negative", 4, "quote one")],
      ["2", ex("2", ["T", "P"], "mixed", 2, "q")],
      ["3", ex("3", ["T"], "negative", 5, "the longest quote")],
      ["4", ex("4", ["T"], "positive", 1)],
      ["5", ex("5", ["T"], "negative", 3)],
      ["6", ex("6", ["P"], "positive", 1)],
      ["7", ex("7", ["P"], "positive", 1)],
      ["8", ex("8", [OTHER_LABEL], "neutral", 1)],
    ]);
    const defs = [
      { id: "p", name: "P", short: "P", description: "", sourceLabels: ["P"] },
      { id: "t", name: "T", short: "T", description: "", sourceLabels: ["T"] },
      { id: "other", name: OTHER_LABEL, short: "Other", description: "", other: true, sourceLabels: [OTHER_LABEL] },
    ];
    const themes = aggregateThemes({ items, extractions, defs, buckets: 4 });
    expect(themes.map((t) => [t.id, t.rank])).toEqual([["t", 1], ["p", 2], ["other", 3]]);
    const t = themes[0]!;
    expect(t.count).toBe(5);
    expect(t.share).toBeCloseTo(0.625);
    expect(t.sentimentSplit).toEqual([20, 20, 60]);
    expect(t.sentiment).toBe("negative");
    expect(t.severityAvg).toBe(3);
    expect(t.trend).toEqual([2, 0, 0, 2]); // undated item 5 excluded from the trend
    expect(t.exampleItemIds).toEqual(["3", "1", "5", "2", "4"]);
    const p = themes[1]!;
    expect(p.count).toBe(3);
    expect(p.sentiment).toBe("positive");
    expect(themes[2]?.other).toBe(true);
  });
});
