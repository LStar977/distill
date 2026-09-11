import { describe, expect, it } from "vitest";
import type { Theme } from "../lib/types";
import { DEFAULT_FIT_NOTE, MAX_OPPORTUNITIES, rankOpportunities, recencyNote, recencyOf, SCORE_THRESHOLD, scoreTheme } from "./rank";

function theme(over: Partial<Theme> & { id: string; count: number }): Theme {
  return {
    rank: 0,
    name: over.id,
    short: over.id,
    description: "",
    share: 0,
    sentiment: "negative",
    sentimentSplit: [0, 0, 100],
    severityAvg: 3,
    trend: [1, 1, 1, 1, 1, 1, 1, 1],
    exampleItemIds: [],
    ...over,
  };
}

describe("recency", () => {
  it("is 0.5 for a flat trend and higher for a rising one", () => {
    expect(recencyOf([5, 5, 5, 5, 5, 5, 5, 5])).toBe(0.5);
    expect(recencyOf([3, 3, 4, 4, 5, 6, 7, 8])).toBeGreaterThan(0.7);
    expect(recencyOf([0, 0, 0, 0, 1, 2, 6, 9])).toBe(1);
    expect(recencyOf([8, 7, 6, 5, 4, 3, 2, 1])).toBeLessThan(0.3);
    expect(recencyOf([])).toBe(0.5);
    expect(recencyOf([0, 0, 0])).toBe(0.5);
  });
  it("writes notes in the handoff voice", () => {
    expect(recencyNote([3, 3, 4, 4, 5, 6, 7, 8], 412, 14)).toBe("rising in 4 of the last 4 months");
    expect(recencyNote([2, 3, 3, 5, 6, 6, 7, 7], 388, 14)).toBe("rising steadily");
    expect(recencyNote([3, 3, 4, 4, 5, 5, 6, 7], 351, 14)).toBe("rising in 3 of the last 4 months");
    expect(recencyNote([5, 5, 5, 5, 5, 5, 5, 5], 297, 14)).toBe("steady over 14 months");
    expect(recencyNote([5, 5, 5, 5, 5, 5, 5, 5], 20, 14)).toBe("flat");
    expect(recencyNote([0, 0, 0, 0, 1, 2, 6, 9], 143, 14)).toBe("spiking in the last 2 months");
    expect(recencyNote([8, 7, 6, 5, 4, 3, 2, 1], 50, 14)).toBe("falling");
  });
});

describe("scoreTheme", () => {
  it("produces factor notes matching the handoff format", () => {
    const t = theme({ id: "rest", name: "Rest timer unreliable in background", count: 412, severityAvg: 4.1, trend: [3, 3, 4, 4, 5, 6, 7, 8] });
    const r = scoreTheme({ theme: t, topCount: 412, rank: 1, totalThemes: 14, fit: { value: 0.92, note: 'matches "fix before the annual-pricing push"' }, months: 14 });
    expect(r.factors.map((f) => f.name)).toEqual(["Frequency", "Severity", "Recency", "Strategic fit"]);
    expect(r.factors[0]).toEqual({ name: "Frequency", value: 1, note: "412 mentions · ranked #1 of 14" });
    expect(r.factors[1]).toEqual({ name: "Severity", value: 0.82, note: "avg. 4.1 / 5" });
    expect(r.factors[2]?.note).toBe("rising in 4 of the last 4 months");
    expect(r.factors[3]).toEqual({ name: "Strategic fit", value: 0.92, note: 'matches "fix before the annual-pricing push"' });
    expect(r.score).toBeGreaterThanOrEqual(85);
    expect(r.score).toBeLessThanOrEqual(100);
  });
  it("formats thousands and defaults fit to 0.7 with a note", () => {
    const r = scoreTheme({ theme: theme({ id: "x", count: 1234 }), topCount: 2000, rank: 2, totalThemes: 5 });
    expect(r.factors[0]?.note).toBe("1,234 mentions · ranked #2 of 5");
    expect(r.factors[3]).toEqual({ name: "Strategic fit", value: 0.7, note: DEFAULT_FIT_NOTE });
  });
});

describe("rankOpportunities", () => {
  it("excludes positive and Other themes, applies the threshold and caps at 6", () => {
    const themes: Theme[] = [
      theme({ id: "big-positive", count: 900, sentiment: "positive", severityAvg: 1.2 }),
      theme({ id: "other", count: 800, other: true, severityAvg: 4 }),
      ...Array.from({ length: 8 }, (_, i) => theme({ id: `neg-${i}`, count: 500 - i * 10, severityAvg: 4 })),
      theme({ id: "tiny", count: 5, severityAvg: 1 }),
    ];
    const { ranked, scored } = rankOpportunities(themes);
    expect(scored).toHaveLength(themes.length);
    expect(ranked).toHaveLength(MAX_OPPORTUNITIES);
    expect(ranked.map((r) => r.theme.id)).toEqual(["neg-0", "neg-1", "neg-2", "neg-3", "neg-4", "neg-5"]);
    expect(ranked.every((r) => r.score >= SCORE_THRESHOLD)).toBe(true);
    expect(scored.find((r) => r.theme.id === "tiny")!.score).toBeLessThan(SCORE_THRESHOLD);
    expect(ranked.every((r, i, a) => i === 0 || a[i - 1]!.score >= r.score)).toBe(true);
  });
  it("uses per-theme fits when provided", () => {
    const themes = [theme({ id: "a", count: 100, severityAvg: 4 }), theme({ id: "b", count: 100, severityAvg: 4 })];
    const fits = new Map([
      ["a", { value: 0.2, note: "off-strategy" }],
      ["b", { value: 1, note: "core" }],
    ]);
    const { ranked } = rankOpportunities(themes, { fits });
    expect(ranked[0]?.theme.id).toBe("b");
    expect(ranked[0]?.factors[3]?.note).toBe("core");
  });
});
