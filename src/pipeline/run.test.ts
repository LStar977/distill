import { describe, expect, it } from "vitest";
import type { Item, PipelineEvent, StageName } from "../lib/types";
import { OTHER_LABEL } from "./taxonomy";
import { runPipeline } from "./run";
import { FakeLLM } from "./testing/fake-llm";

/**
 * A small synthetic dataset: 60 items over 8 months, three planted themes plus
 * praise and noise. The fake LLM labels items from the text so the run is
 * fully deterministic.
 */
const TEXTS: [string, string][] = [
  ["timer", "Great logging but the rest timer just stops counting the second I lock my phone. Missed my 3-minute rest twice."],
  ["timer", "The rest timer notification never fires when the app is in the background. Have to keep the screen on."],
  ["timer", "Timer dies if I switch to Spotify for ten seconds."],
  ["watch", "Lost an entire leg day because the Watch dropped half my sets on sync. Not the first time."],
  ["watch", "Sets logged on the Watch show up on the phone minutes later, or not at all."],
  ["price", "$79 a year feels steep when the free version already does 80% of what I need."],
  ["praise", "The plate calculator alone is worth the download, saves me doing math between sets."],
  ["noise", "Good"],
];

const items: Item[] = Array.from({ length: 60 }, (_, i) => {
  const [kind, text] = TEXTS[i % TEXTS.length]!;
  return {
    id: `it-${String(i + 1).padStart(3, "0")}`,
    source: ["IronLog", "SetCount", "LiftLab"][i % 3]!,
    text: `${text}${i >= TEXTS.length ? ` (${i})` : ""}`,
    rating: kind === "praise" ? 5 : kind === "noise" ? 4 : 2,
    date: `2026-0${1 + (i % 8)}-${String(1 + (i % 27)).padStart(2, "0")}`,
    segment: i % 2 ? "Paid subscriber" : "New user",
  };
});

const THEME_OF: Record<string, string> = {
  timer: "Rest timer unreliable in background",
  watch: "Apple Watch sync drops sets",
  price: "Subscription price vs. value",
  praise: "Plate calculator loved",
  noise: OTHER_LABEL,
};

function kindOf(text: string): string {
  return TEXTS.find(([, t]) => text.startsWith(t))?.[0] ?? "noise";
}

function makeFake(): FakeLLM {
  return new FakeLLM(
    (params) => {
      switch (params.purpose) {
        case "taxonomy":
          return {
            themes: [
              { name: "Rest timer unreliable in background", short: "Rest timer", description: "Timer stops in background." },
              { name: "Apple Watch sync drops sets", short: "Watch sync", description: "Sets lost on sync." },
              { name: "Subscription price vs. value", short: "Subscription", description: "Price complaints and defences." },
              { name: "Plate calculator loved", short: "Plate calc", description: "Praise for plate math." },
            ],
          };
        case "extract": {
          const ids = Array.from(params.user.matchAll(/^\[(it-\d+) · /gm), (m) => m[1] as string);
          return {
            items: ids.map((id) => {
              const item = items.find((i) => i.id === id)!;
              const kind = kindOf(item.text);
              const label = kind === "timer" && Number(id.slice(3)) % 2 === 0 ? "timer bugs" : THEME_OF[kind]!;
              const quote = kind === "timer" ? "rest timer" : kind === "watch" ? "Watch" : kind === "price" ? "$79 a year feels steep" : kind === "praise" ? "plate calculator" : "Good";
              return {
                itemId: id,
                sentiment: kind === "praise" ? "positive" : kind === "noise" ? "neutral" : kind === "price" ? "mixed" : "negative",
                severity: kind === "watch" ? 5 : kind === "timer" ? 4 : kind === "price" ? 3 : 1,
                themes: [label],
                painPoints: [],
                featureRequests: [],
                quotes: [quote],
                segments: item.segment ? [item.segment] : [],
              };
            }),
          };
        }
        case "cluster":
          return {
            merges: [{ label: "timer bugs", into: "Rest timer unreliable in background", similarity: 0.91 }],
            themes: [
              { label: "Rest timer unreliable in background", name: "Rest timer unreliable in background", short: "Rest timer", description: "Timer stops in background." },
              { label: "Apple Watch sync drops sets", name: "Apple Watch sync drops sets", short: "Watch sync", description: "Sets lost on sync." },
              { label: "Subscription price vs. value", name: "Subscription price vs. value", short: "Subscription", description: "Price." },
              { label: "Plate calculator loved", name: "Plate calculator loved", short: "Plate calc", description: "Praise." },
            ],
          };
        case "fit": {
          const ids = Array.from(params.user.matchAll(/id=([a-z0-9-]+)/g), (m) => m[1] as string);
          return { fits: ids.map((themeId) => ({ themeId, fit: themeId.startsWith("rest") ? 0.95 : 0.7, note: themeId.startsWith("rest") ? 'matches "fix before the annual-pricing push"' : "relevant to the core job" })) };
        }
        case "opportunity": {
          const cands = Array.from(params.user.matchAll(/^\[(it-\d+) · [^\]]*\]\n([^\n]*)\n/gm), (m) => ({ id: m[1] as string, text: m[2] as string }));
          const picks = cands.slice(0, 6).map((c, i) => ({ itemId: c.id, quote: i === 0 ? "a quote that is not in the text" : c.text.split(" ").slice(0, 4).join(" ") }));
          picks.push({ itemId: "it-999", quote: "bogus" });
          return {
            title: "Fix the thing",
            problem: "Users lose data. It happens a lot.",
            direction: "Move the timer off the foreground process.",
            validate: ["Share that is background-specific", "Battery effect"],
            effort: "M",
            impact: "XL",
            confidence: "High",
            evidence: picks,
          };
        }
        case "brief": {
          const ids = Array.from(params.user.matchAll(/\[item:(it-\d+)\]/g), (m) => m[1] as string);
          const cited = ids.slice(0, 3).map((id) => `[item:${id}]`).join(" ");
          return { markdown: `## Executive summary\nSixty reviews. Timer is the problem ${cited} [item:it-999].\n\n## Top opportunities\nSee above.\n\n## Theme overview\n| a |\n\n## Methodology\nBatches.` };
        }
        default:
          throw new Error(`unexpected purpose ${params.purpose}`);
      }
    },
    { simulateCache: true },
  );
}

describe("runPipeline", () => {
  it("emits stages in order, ends with done, and returns a consistent Run", async () => {
    const llm = makeFake();
    let clock = 0;
    const events: PipelineEvent[] = [];
    const golden = {
      items: items.slice(0, 16).map((it) => ({ itemId: it.id, themes: [THEME_OF[kindOf(it.text)]!], sentiment: (kindOf(it.text) === "praise" ? "positive" : kindOf(it.text) === "noise" ? "neutral" : kindOf(it.text) === "price" ? "mixed" : "negative") as "positive" | "neutral" | "mixed" | "negative" })),
    };
    const file = await runPipeline({
      items,
      datasetMeta: { id: "synthetic", name: "Synthetic reviews" },
      golden,
      context: { product: "IronLog is a paid workout tracker.", decision: "What to fix before the annual-pricing push." },
      settings: { depth: "thorough", cap: 60 },
      llm,
      onEvent: (e) => events.push(e),
      now: () => (clock += 250),
      wallClock: () => new Date("2026-09-11T10:00:00Z"),
      runId: "run-test",
      concurrency: 2,
      batchSize: 20,
    });
    const { run } = file;

    // Stage events: running/done pairs in canonical order.
    const stages = events.filter((e): e is Extract<PipelineEvent, { type: "stage" }> => e.type === "stage");
    const order: StageName[] = ["ingest", "extract", "cluster", "rank", "brief"];
    expect(stages.map((s) => `${s.stage}:${s.status}`)).toEqual(order.flatMap((s) => [`${s}:running`, `${s}:done`]));
    expect(events.at(-1)?.type).toBe("done");
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(file.events).toEqual(events);
    expect(events.every((e, i) => i === 0 || e.t >= events[i - 1]!.t)).toBe(true);

    // Run shape.
    expect(run.status).toBe("done");
    expect(run.id).toBe("run-test");
    expect(run.datasetId).toBe("synthetic");
    expect(run.sources).toEqual(["IronLog", "LiftLab", "SetCount"]);
    expect(run.stats.items).toBe(60);
    expect(run.stats.themes).toBe(run.themes.length);
    expect(run.stats.opportunities).toBe(run.opportunities.length);
    expect(run.stats.tokensIn).toBeGreaterThan(0);
    expect(run.stats.costUsd).toBeGreaterThan(0);
    expect(run.stats.cacheHitRate).toBeGreaterThan(0.3);
    expect(Object.values(run.stats.stageDurationsMs).every((ms) => ms >= 0)).toBe(true);
    expect(run.stats.durationMs).toBeGreaterThan(0);

    // Themes: ranked by count with Other last; raw label merged away.
    expect(run.themes.map((t) => t.rank)).toEqual(run.themes.map((_, i) => i + 1));
    expect(run.themes.at(-1)?.other).toBe(true);
    const rest = run.themes.find((t) => t.name === "Rest timer unreliable in background")!;
    expect(rest.count).toBe(24);
    expect(run.themes.some((t) => t.name.toLowerCase() === "timer bugs")).toBe(false);
    expect(events.some((e) => e.type === "merge" && e.fromId === "raw-timer-bugs" && e.intoId === rest.id && e.similarity === 0.91)).toBe(true);
    for (let i = 1; i < run.themes.length - 1; i++) expect(run.themes[i - 1]!.count).toBeGreaterThanOrEqual(run.themes[i]!.count);

    // Opportunities: capped, no positive/Other, evidence resolvable and verbatim.
    expect(run.opportunities.length).toBeGreaterThan(0);
    expect(run.opportunities.length).toBeLessThanOrEqual(6);
    for (const o of run.opportunities) {
      const t = run.themes.find((th) => th.id === o.themeIds[0])!;
      expect(t.sentiment).not.toBe("positive");
      expect(t.other).toBeUndefined();
      expect(t.opportunityId).toBe(o.id);
      expect(o.score).toBeGreaterThanOrEqual(55);
      expect(o.evidence.length).toBeGreaterThanOrEqual(5);
      expect(o.evidence.length).toBeLessThanOrEqual(8);
      expect(o.evidence.some((e) => e.itemId === "it-999")).toBe(false);
      for (const e of o.evidence) {
        const item = run.items[e.itemId];
        expect(item, `evidence item ${e.itemId} present in run.items`).toBeDefined();
        expect(item!.text).toBe(`${e.pre}${e.quote}${e.post}`);
        expect(run.extractions[e.itemId]).toBeDefined();
      }
      expect(o.problem).toContain(`${t.count} reviews`);
      expect(o.factors.map((f) => f.name)).toEqual(["Frequency", "Severity", "Recency", "Strategic fit"]);
    }
    expect(run.opportunities[0]?.factors[3]?.note).toBe('matches "fix before the annual-pricing push"');
    for (const t of run.themes) for (const id of t.exampleItemIds) expect(run.items[id]).toBeDefined();

    // Brief: unknown citation stripped, appendix appended, words counted.
    expect(run.brief?.markdown).not.toContain("it-999");
    expect(run.brief?.markdown).toContain("## Evidence appendix");
    expect(run.brief!.wordCount).toBeGreaterThan(20);

    // Eval on the golden subset.
    expect(run.eval?.n).toBe(16);
    expect(run.eval?.themePrecision).toBe(1);
    expect(run.eval?.themeRecall).toBe(1);

    // Log voice.
    const logs = events.filter((e) => e.type === "log").map((e) => (e.type === "log" ? e.message : ""));
    expect(logs[0]).toBe("Parsed 60 rows from Synthetic reviews · 3 apps · 8 months");
    expect(logs).toContain("Sampling 60 reviews to draft a taxonomy…");
    expect(logs).toContain("Drafted taxonomy: 4 candidate themes + other");
    expect(logs).toContain("Extracting in batches of 20 · 3 batches · taxonomy prompt cached");
    expect(logs).toContain("Merged 'Timer bugs' into 'Rest timer unreliable in background' (0.91 similarity)");
    expect(logs.some((l) => /^\d+ opportunit(y|ies) above threshold \(score ≥ 55\) · top: /.test(l))).toBe(true);
    expect(logs).toContain("Eval against 16-item golden set: precision 1.00 · recall 1.00");
    expect(logs.at(-1)).toMatch(/^Done · \d+ themes · \d+ opportunities · \d+s · \$\d+\.\d\d/);

    // Model routing: extraction on sonnet, synthesis on opus (env overrides absent).
    const models = new Set(llm.calls.map((c) => `${c.purpose}:${c.model}`));
    expect(models.has("extract:claude-sonnet-5") || models.has("extract:claude-haiku-4-5")).toBe(true);
    expect(llm.callsFor("taxonomy")[0]?.model).toBe("claude-opus-5");
    expect(new Set(llm.callsFor("extract").map((c) => c.system)).size).toBe(1);
  });

  it("emits an error event and throws a PipelineError when a stage fails", async () => {
    const llm = new FakeLLM(() => {
      throw new Error("boom");
    });
    const events: PipelineEvent[] = [];
    await expect(
      runPipeline({ items, context: { product: "x" }, settings: { depth: "fast", cap: 10 }, llm, onEvent: (e) => events.push(e), now: () => 0 }),
    ).rejects.toMatchObject({ name: "PipelineError", stage: "ingest" });
    expect(events.at(-1)).toMatchObject({ type: "error" });
  });
});
