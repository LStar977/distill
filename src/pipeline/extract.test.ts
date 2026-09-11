import { describe, expect, it } from "vitest";
import type { Extraction, Item } from "../lib/types";
import { findSpan, longestSentence } from "../lib/text";
import { batchItems, buildExtractSystem, canonicalLabel, clampSeverity, normalizeRow, pickRepresentative, runExtraction, validateQuotes } from "./extract";
import { Timeline } from "./events";
import { finalizeTaxonomy, OTHER_LABEL, taxonomyIndex } from "./taxonomy";
import { FakeLLM } from "./testing/fake-llm";

const taxonomy = finalizeTaxonomy({
  themes: [
    { name: "Rest timer unreliable in background", short: "Rest timer", description: "Timer stops when locked." },
    { name: "Apple Watch sync drops sets", short: "Watch sync", description: "Sets lost on sync." },
  ],
});
const index = taxonomyIndex(taxonomy);

describe("batchItems", () => {
  it("splits into batches of the given size with a remainder", () => {
    const b = batchItems(Array.from({ length: 45 }, (_, i) => i), 20);
    expect(b.map((x) => x.length)).toEqual([20, 20, 5]);
    expect(batchItems([], 20)).toEqual([]);
    expect(() => batchItems([1], 0)).toThrow(RangeError);
  });
});

describe("validateQuotes", () => {
  const text = "Great logging but the rest timer just stops counting the second I lock my phone. Missed my 3-minute rest twice.";
  it("keeps verbatim substrings and drops paraphrases", () => {
    const spans = validateQuotes(text, ["the rest timer just stops counting the second I lock my phone", "timer is broken when locked"]);
    expect(spans).toHaveLength(1);
    expect(spans[0]).toEqual({ start: 18, end: 79, text: "the rest timer just stops counting the second I lock my phone" });
    expect(text.slice(spans[0]!.start, spans[0]!.end)).toBe(spans[0]!.text);
  });
  it("tolerates stray quotes and trailing punctuation", () => {
    const spans = validateQuotes(text, ['"Missed my 3-minute rest twice."']);
    expect(spans[0]?.text).toBe("Missed my 3-minute rest twice");
  });
  it("falls back to the longest sentence when nothing matches", () => {
    const spans = validateQuotes(text, ["not in the text at all"]);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.text).toBe(longestSentence(text));
    expect(spans[0]?.text).toBe("Great logging but the rest timer just stops counting the second I lock my phone.");
  });
  it("dedupes identical spans and caps at two", () => {
    const spans = validateQuotes(text, ["Great logging", "Great logging", "Missed my", "rest twice"]);
    expect(spans.map((s) => s.text)).toEqual(["Great logging", "Missed my"]);
  });
  it("findSpan is case-insensitive as a last resort", () => {
    expect(findSpan("Timer dies if I switch to Spotify", "timer dies")?.text).toBe("Timer dies");
    expect(findSpan("abc", "")).toBeNull();
  });
});

describe("normalizeRow", () => {
  const item: Item = { id: "i1", source: "IronLog", text: "Timer dies if I switch to Spotify for ten seconds.", rating: 2 };
  it("canonicalizes taxonomy labels, keeps raw ones, clamps severity", () => {
    const row = normalizeRow(
      item,
      { itemId: "i1", sentiment: "negative", severity: 9, themes: ["rest timer", "timer bugs", "Rest timer unreliable in background"], painPoints: [" timer "], featureRequests: [], quotes: ["Timer dies"], segments: ["Paid subscriber", "Paid subscriber"] },
      index,
    );
    expect(row.extraction.themes).toEqual(["Rest timer unreliable in background", "Timer bugs"]);
    expect(row.rawLabels).toEqual(["Timer bugs"]);
    expect(row.extraction.severity).toBe(5);
    expect(row.extraction.painPoints).toEqual(["timer"]);
    expect(row.extraction.segments).toEqual(["Paid subscriber"]);
    expect(row.extraction.quotes[0]?.text).toBe("Timer dies");
  });
  it("uses Other when no theme is given and drops Other when a real theme is present", () => {
    expect(normalizeRow(item, { itemId: "i1", sentiment: "neutral", severity: 1, themes: [], painPoints: [], featureRequests: [], quotes: [], segments: [] }, index).extraction.themes).toEqual([OTHER_LABEL]);
    expect(normalizeRow(item, { itemId: "i1", sentiment: "neutral", severity: 1, themes: ["other", "Watch sync"], painPoints: [], featureRequests: [], quotes: [], segments: [] }, index).extraction.themes).toEqual(["Apple Watch sync drops sets"]);
  });
  it("canonicalLabel matches by short label and normalizes raw text", () => {
    expect(canonicalLabel("WATCH SYNC", index)).toEqual({ label: "Apple Watch sync drops sets", raw: false });
    expect(canonicalLabel("  too   expensive.. ", index)).toEqual({ label: "Too expensive", raw: true });
    expect(clampSeverity(Number.NaN)).toBe(1);
  });
});

describe("pickRepresentative", () => {
  it("prefers the highest severity, then the longer quote", () => {
    const mk = (id: string, severity: 1 | 2 | 3 | 4 | 5, q: string): Extraction => ({ itemId: id, sentiment: "negative", severity, themes: [], painPoints: [], featureRequests: [], quotes: [{ start: 0, end: q.length, text: q }], segments: [] });
    expect(pickRepresentative([mk("a", 2, "short"), mk("b", 4, "x"), mk("c", 4, "longer quote")]).itemId).toBe("c");
  });
});

describe("runExtraction", () => {
  const items: Item[] = Array.from({ length: 45 }, (_, i) => ({
    id: `it-${i}`,
    source: i % 2 ? "IronLog" : "SetCount",
    text: i % 3 === 0 ? "Lost an entire leg day because the Watch dropped half my sets on sync." : "The rest timer just stops counting the second I lock my phone.",
    date: `2026-0${1 + (i % 8)}-10`,
  }));

  function fake(): FakeLLM {
    return new FakeLLM(
      (params) => {
        const ids = Array.from(params.user.matchAll(/^\[(it-\d+) · /gm), (m) => m[1] as string);
        return {
          items: ids.map((id, k) => {
            const n = Number(id.slice(3));
            const watch = n % 3 === 0;
            return {
              itemId: id,
              sentiment: "negative",
              severity: watch ? 4 : 3,
              themes: watch ? ["watch disconnects"] : n % 5 === 0 ? ["Rest timer"] : ["Rest timer unreliable in background"],
              painPoints: [],
              featureRequests: [],
              quotes: [k === 0 ? "made up quote" : watch ? "the Watch dropped half my sets" : "stops counting the second I lock my phone"],
              segments: watch ? ["Apple Watch owner"] : [],
            };
          }),
        };
      },
      { simulateCache: true },
    );
  }

  it("batches, keeps the system prompt frozen, emits events and validates quotes", async () => {
    const llm = fake();
    let clock = 0;
    const timeline = new Timeline(() => (clock += 100));
    const counters = () => ({ tokensIn: 1000, tokensOut: 100, costUsd: 0.01, cacheHitRate: 0.8 });
    const result = await runExtraction({ items, taxonomy, llm, model: "claude-sonnet-5", timeline, counters, concurrency: 2, batchSize: 20 });

    expect(result.batches).toBe(3);
    expect(llm.calls).toHaveLength(3);
    expect(new Set(llm.calls.map((c) => c.system)).size).toBe(1);
    expect(llm.calls[0]?.system).toBe(buildExtractSystem(taxonomy));
    expect(llm.calls[0]?.system).toContain("Rest timer unreliable in background — Timer stops when locked.");
    expect(llm.calls.every((c) => c.cache !== false)).toBe(true);
    expect(result.extractions.size).toBe(45);
    expect(result.failures).toBe(0);

    const batchEvents = timeline.events.filter((e) => e.type === "batch");
    expect(batchEvents).toHaveLength(3);
    expect(batchEvents.map((e) => (e.type === "batch" ? e.processed : 0))).toEqual([20, 40, 45]);
    expect(batchEvents.every((e) => e.type === "batch" && e.totalBatches === 3 && e.row.extraction.severity === 4)).toBe(true);
    expect(timeline.events.filter((e) => e.type === "counters")).toHaveLength(3);

    const themeEvents = timeline.events.filter((e) => e.type === "theme");
    const raw = themeEvents.find((e) => e.type === "theme" && e.transient);
    expect(raw && raw.type === "theme" ? raw.themeId : "").toBe("raw-watch-disconnects");
    const restTimer = themeEvents.filter((e) => e.type === "theme" && e.themeId === "rest-timer-unreliable-in-background");
    expect(restTimer.at(-1)).toMatchObject({ count: 30, sentiment: "negative", severityAvg: 3 });

    // quotes: the made-up quote in the first row of each batch fell back to the longest sentence
    const first = result.extractions.get("it-0");
    expect(first?.quotes[0]?.text).toBe("Lost an entire leg day because the Watch dropped half my sets on sync.");
    expect(result.extractions.get("it-1")?.quotes[0]?.text).toBe("stops counting the second I lock my phone");
    for (const ex of result.extractions.values()) {
      const item = items.find((i) => i.id === ex.itemId)!;
      for (const q of ex.quotes) expect(item.text.slice(q.start, q.end)).toBe(q.text);
    }

    const logs = timeline.events.filter((e) => e.type === "log").map((e) => (e.type === "log" ? e.message : ""));
    expect(logs[0]).toBe("Extracting in batches of 20 · 3 batches · taxonomy prompt cached");
    expect(logs.some((l) => /^Batch 1 proposed a label outside the taxonomy: 'Watch disconnects' · keeping as raw$/.test(l))).toBe(true);
    expect(logs.some((l) => l.startsWith("New theme from batch") && l.includes("'Watch disconnects'"))).toBe(true);
    expect(logs.some((l) => l.startsWith("Cache warm · hit rate 80%"))).toBe(true);
    expect(logs.at(-1)).toBe("Extraction complete · 45 / 45 · 0 failures · 0 retries");
    expect(timeline.events.every((e, i, arr) => i === 0 || e.t >= arr[i - 1]!.t)).toBe(true);
  });

  it("fills items the model skipped with a default extraction", async () => {
    const llm = new FakeLLM(() => ({ items: [] }));
    const timeline = new Timeline(() => 0);
    const result = await runExtraction({ items: items.slice(0, 3), taxonomy, llm, model: "m", timeline, counters: () => ({ tokensIn: 0, tokensOut: 0, costUsd: 0, cacheHitRate: 0 }), batchSize: 20 });
    expect(result.missing).toBe(3);
    expect(result.extractions.get("it-0")?.themes).toEqual([OTHER_LABEL]);
  });
});
