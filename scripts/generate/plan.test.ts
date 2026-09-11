import { describe, expect, it } from "vitest";
import { buildPlan, datasetMeta, goldenFor, HANDOFF_REVIEWS, MONTHS, ratingHistogram, THEME_SPECS, TOTAL_ITEMS } from "./plan";

describe("dataset plan", () => {
  const plan = buildPlan();

  it("is deterministic and the right size", () => {
    const again = buildPlan();
    expect(plan.rows).toHaveLength(TOTAL_ITEMS);
    expect(again.rows.map((r) => `${r.id}${r.app}${r.date}${r.rating}${r.themes.join()}`)).toEqual(plan.rows.map((r) => `${r.id}${r.app}${r.date}${r.rating}${r.themes.join()}`));
    expect(new Set(plan.rows.map((r) => r.id)).size).toBe(TOTAL_ITEMS);
    expect(buildPlan("other-seed").rows.map((r) => r.date).join()).not.toBe(plan.rows.map((r) => r.date).join());
  });

  it("meets every theme quota by primary theme", () => {
    for (const spec of THEME_SPECS) {
      expect(plan.rows.filter((r) => r.themes[0] === spec.key).length, spec.name).toBe(spec.quota);
    }
  });

  it("includes the 26 handoff reviews verbatim with their app, rating, date and themes", () => {
    const handoff = plan.rows.filter((r) => r.handoff);
    expect(handoff).toHaveLength(26);
    const first = HANDOFF_REVIEWS[0]!;
    const row = handoff.find((r) => r.text === `${first.pre}${first.quote}${first.post}`)!;
    expect(row).toMatchObject({ app: "IronLog", rating: 2, date: "2026-03-14", themes: ["rest-timer"], tone: "negative", severity: 4 });
    const watch = handoff.find((r) => r.text?.startsWith("Lost an entire leg day"))!;
    expect(watch.text).toBe("Lost an entire leg day because the Watch dropped half my sets on sync. Not the first time.");
    expect(watch.persona).toBe("Apple Watch owner");
    const twoThemes = handoff.find((r) => r.text?.startsWith("Paying monthly"))!;
    expect(twoThemes.themes).toEqual(["rest-timer", "subscription"]);
    const curly = handoff.find((r) => r.text?.includes("aren’t in the library"));
    expect(curly).toBeDefined();
  });

  it("spans 14 months ending 2026-09-09, sorted by date, with crashes in the last three months", () => {
    const dates = plan.rows.map((r) => r.date);
    expect(dates.every((d, i) => i === 0 || d >= dates[i - 1]!)).toBe(true);
    expect(dates[0]!.slice(0, 7)).toBe("2025-08");
    expect(dates.at(-1)! <= "2026-09-09").toBe(true);
    expect(new Set(dates.map((d) => d.slice(0, 7)))).toEqual(new Set(MONTHS));
    const crashes = plan.rows.filter((r) => r.themes[0] === "crashes");
    expect(crashes.filter((r) => r.date >= "2026-07-01").length / crashes.length).toBeGreaterThan(0.9);
  });

  it("skews ratings positive, roughly 38/24/14/12/12", () => {
    const [r1, r2, r3, r4, r5] = ratingHistogram(plan.rows) as [number, number, number, number, number];
    expect(r5).toBeGreaterThan(0.3);
    expect(r5).toBeLessThan(0.42);
    expect(r4).toBeGreaterThan(0.18);
    expect(r3).toBeLessThan(0.2);
    expect(r2).toBeLessThan(0.17);
    expect(r1).toBeLessThan(0.16);
    expect(r1 + r2 + r3 + r4 + r5).toBeCloseTo(1, 6);
  });

  it("keeps ratings consistent with theme sentiment and tone", () => {
    for (const r of plan.rows) {
      const spec = THEME_SPECS.find((s) => s.key === r.themes[0])!;
      if (spec.polarity === "positive") {
        expect(r.rating).toBeGreaterThanOrEqual(3);
        expect(r.tone).toBe("positive");
      }
      if (spec.key === "crashes") expect(r.rating).toBeLessThanOrEqual(5);
      if (spec.polarity === "negative" && r.rating <= 3 && r.themes.length === 1) expect(r.tone).toBe("negative");
      if (spec.polarity === "negative" && r.rating >= 4 && r.themes.length === 1) expect(r.tone).toBe("mixed");
    }
    const secondary = plan.rows.filter((r) => r.themes.length > 1).length / plan.rows.filter((r) => r.themes[0] !== "other").length;
    expect(secondary).toBeGreaterThan(0.09);
    expect(secondary).toBeLessThan(0.15);
    expect(plan.rows.filter((r) => r.themes[0] === "other").every((r) => r.subtopic)).toBe(true);
  });

  it("builds a 50-item golden set stratified across all 14 themes", () => {
    const golden = goldenFor(plan);
    expect(golden.items).toHaveLength(50);
    expect(golden.note).toMatch(/planted by construction/);
    const ids = new Set(plan.rows.map((r) => r.id));
    const byName = new Map<string, number>();
    for (const g of golden.items) {
      expect(ids.has(g.itemId)).toBe(true);
      const row = plan.rows.find((r) => r.id === g.itemId)!;
      expect(g.themes[0]).toBe(THEME_SPECS.find((s) => s.key === row.themes[0])!.name);
      expect(g.sentiment).toBe(row.tone);
      byName.set(g.themes[0]!, (byName.get(g.themes[0]!) ?? 0) + 1);
    }
    expect(byName.size).toBe(14);
    for (const n of byName.values()) expect(n).toBeGreaterThanOrEqual(2);
    expect(byName.get("Rest timer unreliable in background")).toBeGreaterThanOrEqual(5);
    expect(goldenFor(plan).items.map((g) => g.itemId)).toEqual(golden.items.map((g) => g.itemId));
  });

  it("describes the dataset as the brief specifies", () => {
    const meta = datasetMeta(TOTAL_ITEMS);
    expect(meta).toMatchObject({ id: "fitness", kind: "App Store reviews", meta: "3,214 items · 3 apps · 14 months", description: "IronLog, SetCount and LiftLab. The flagship demo.", sources: ["IronLog", "SetCount", "LiftLab"] });
    expect(meta.defaultContext.product).toBe("IronLog is a paid workout tracker for strength athletes on iOS and Apple Watch. We're deciding what to fix before the next annual-pricing push.");
  });

  it("scales down with a limit for smoke runs", () => {
    const small = buildPlan("distill-fitness-v1", 200);
    expect(small.rows.length).toBeGreaterThan(150);
    expect(small.rows.length).toBeLessThan(250);
    expect(small.rows.some((r) => r.handoff)).toBe(false);
  });
});
