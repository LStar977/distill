import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyEvent, initialState, mergeProgress, stateAt, visibleThemes } from "./replay";
import type { PipelineEvent, RunFile } from "./types";

const fixture = JSON.parse(readFileSync(join(process.cwd(), "design", "fixture", "fitness-demo.json"), "utf8")) as RunFile;

describe("replay reducer", () => {
  it("starts with every stage queued and nothing processed", () => {
    const s = initialState();
    expect(Object.values(s.stages).every((st) => st.status === "queued")).toBe(true);
    expect(s.processed).toBe(0);
    expect(s.themes.size).toBe(0);
  });

  it("tracks stage transitions", () => {
    let s = initialState();
    s = applyEvent(s, { t: 0, type: "stage", stage: "ingest", status: "running" });
    expect(s.stages.ingest.status).toBe("running");
    s = applyEvent(s, { t: 2, type: "stage", stage: "ingest", status: "done", note: "3,214 items · 2.0s" });
    expect(s.stages.ingest).toMatchObject({ status: "done", note: "3,214 items · 2.0s", endedAt: 2 });
  });

  it("keeps the newest eight stream rows", () => {
    let s = initialState();
    for (let b = 1; b <= 12; b++) {
      s = applyEvent(s, {
        t: b,
        type: "batch",
        batch: b,
        totalBatches: 161,
        processed: b * 20,
        row: { batch: b, itemId: "x", extraction: { itemId: "x", sentiment: "neutral", severity: 1, themes: [], painPoints: [], featureRequests: [], quotes: [], segments: [] } },
      });
    }
    expect(s.rows).toHaveLength(8);
    expect(s.rows[0].batch).toBe(12);
    expect(s.processed).toBe(240);
  });

  it("records the last hit time only when a theme grows", () => {
    let s = initialState();
    const base = { type: "theme" as const, themeId: "t01", name: "Rest timer", short: "Rest timer", sentiment: "negative" as const, severityAvg: 4.1 };
    s = applyEvent(s, { t: 5, ...base, count: 10 });
    s = applyEvent(s, { t: 6, ...base, count: 10 });
    expect(s.themes.get("t01")?.lastHitAt).toBe(5);
    s = applyEvent(s, { t: 7, ...base, count: 11 });
    expect(s.themes.get("t01")?.lastHitAt).toBe(7);
  });

  it("merges a transient theme into its parent and fades it out over a second", () => {
    let s = initialState();
    s = applyEvent(s, { t: 10, type: "theme", themeId: "x1", name: "timer bugs", short: "timer bugs", count: 60, sentiment: "negative", severityAvg: 4, transient: true, parentId: "t01" });
    s = applyEvent(s, { t: 31.2, type: "merge", fromId: "x1", intoId: "t01", similarity: 0.91 });
    const x1 = s.themes.get("x1")!;
    expect(x1.mergedAt).toBe(31.2);
    expect(mergeProgress(x1, 31.7)).toBeCloseTo(0.5);
    expect(visibleThemes(s, 31.7).map((t) => t.id)).toContain("x1");
    expect(visibleThemes(s, 32.5).map((t) => t.id)).not.toContain("x1");
    expect(s.merges).toBe(1);
  });
});

describe("design-derived fixture (design/fixture/fitness-demo.json)", () => {
  const { run, events } = fixture;

  it("is sorted by time", () => {
    for (let i = 1; i < events.length; i++) expect(events[i].t).toBeGreaterThanOrEqual(events[i - 1].t);
  });

  it("shows eleven raw themes and 1,840 processed at the mid-run frame", () => {
    const s = stateAt(events, 24);
    expect(visibleThemes(s).filter((t) => t.mergedAt === undefined)).toHaveLength(11);
    expect(s.processed).toBe(1840);
    expect(s.stages.extract.status).toBe("running");
    expect(s.stages.cluster.status).toBe("queued");
  });

  it("ends with fourteen themes whose counts match the final run", () => {
    const s = stateAt(events, 41);
    expect(s.done).toBe(true);
    const finals = visibleThemes(s).filter((t) => t.mergedAt === undefined);
    expect(finals).toHaveLength(14);
    for (const t of run.themes) expect(s.themes.get(t.id)?.count).toBe(t.count);
    expect(s.costUsd).toBeCloseTo(run.stats.costUsd, 2);
    expect(s.tokensIn).toBe(run.stats.tokensIn);
  });

  it("references only items that exist, with quotes that are real substrings", () => {
    for (const o of run.opportunities) {
      for (const e of o.evidence) {
        const item = run.items[e.itemId];
        expect(item, `${o.id} → ${e.itemId}`).toBeDefined();
        expect(item.text).toBe(e.pre + e.quote + e.post);
      }
    }
    for (const ex of Object.values(run.extractions)) {
      const item = run.items[ex.itemId];
      for (const q of ex.quotes) expect(item.text.slice(q.start, q.end)).toBe(q.text);
    }
  });

  it("ranks opportunities by score and links each to a theme", () => {
    const scores = run.opportunities.map((o) => o.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    for (const o of run.opportunities) {
      const theme = run.themes.find((t) => t.id === o.themeIds[0]);
      expect(theme?.opportunityId).toBe(o.id);
    }
  });

  it("every stream row points at a known item", () => {
    const rows = events.filter((e): e is Extract<PipelineEvent, { type: "batch" }> => e.type === "batch");
    expect(rows).toHaveLength(161);
    for (const r of rows) expect(run.items[r.row.itemId]).toBeDefined();
  });
});
