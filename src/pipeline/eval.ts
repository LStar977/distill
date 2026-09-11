import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { EvalResult, Extraction, Sentiment } from "../lib/types";
import { normalizeLabel } from "../lib/text";
import { DEFAULT_DATA_ROOT } from "./ingest";
import { OTHER_LABEL } from "./taxonomy";

const goldenSchema = z.object({
  note: z.string().optional(),
  items: z.array(
    z.object({
      itemId: z.string(),
      themes: z.array(z.string()),
      sentiment: z.enum(["positive", "negative", "neutral", "mixed"]),
    }),
  ),
});

export type GoldenSet = z.infer<typeof goldenSchema>;
export type GoldenItem = GoldenSet["items"][number];

export function goldenPath(id: string, dataRoot = DEFAULT_DATA_ROOT): string {
  return join(dataRoot, "datasets", `${id}.golden.json`);
}

/** Load the golden set for a dataset; null when there is none. */
export async function loadGolden(id: string, dataRoot = DEFAULT_DATA_ROOT): Promise<GoldenSet | null> {
  let raw: string;
  try {
    raw = await readFile(goldenPath(id, dataRoot), "utf8");
  } catch {
    return null;
  }
  const parsed = goldenSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : null;
}

export type Alignment = "exact" | "greedy";

export interface EvaluateOptions {
  /** Extractions with labels already mapped through the merge map (final theme names). */
  extractions: ReadonlyMap<string, Extraction>;
  golden: GoldenSet;
  /**
   * "exact": labels must match after normalization.
   * "greedy" (default): golden labels are aligned one-to-one to predicted
   * labels by co-occurrence first, since the pipeline names its own themes.
   */
  alignment?: Alignment;
}

/**
 * Greedy one-to-one alignment golden label → predicted label by co-occurrence
 * count over the golden items. Labels that already match exactly are pinned
 * first. Returns a map of normalized golden label → normalized predicted label.
 */
export function alignLabels(
  pairs: readonly { gold: string[]; pred: string[] }[],
): Map<string, string> {
  const co = new Map<string, Map<string, number>>();
  const goldLabels = new Set<string>();
  const predLabels = new Set<string>();
  for (const { gold, pred } of pairs) {
    for (const g of gold) {
      goldLabels.add(g);
      const row = co.get(g) ?? new Map<string, number>();
      for (const p of pred) {
        predLabels.add(p);
        row.set(p, (row.get(p) ?? 0) + 1);
      }
      co.set(g, row);
    }
  }
  const mapping = new Map<string, string>();
  const takenPred = new Set<string>();
  for (const g of goldLabels) {
    if (predLabels.has(g) && !takenPred.has(g)) {
      mapping.set(g, g);
      takenPred.add(g);
    }
  }
  const edges: { g: string; p: string; n: number }[] = [];
  for (const [g, row] of co) {
    if (mapping.has(g)) continue;
    for (const [p, n] of row) edges.push({ g, p, n });
  }
  edges.sort((a, b) => b.n - a.n || (a.g < b.g ? -1 : a.g > b.g ? 1 : a.p < b.p ? -1 : 1));
  for (const e of edges) {
    if (mapping.has(e.g) || takenPred.has(e.p)) continue;
    if (e.n < 1) continue;
    mapping.set(e.g, e.p);
    takenPred.add(e.p);
  }
  for (const g of goldLabels) if (!mapping.has(g)) mapping.set(g, g);
  return mapping;
}

/** Micro precision/recall on theme label sets plus sentiment accuracy over the golden items present in the run. */
export function evaluate(opts: EvaluateOptions): EvalResult {
  const alignment = opts.alignment ?? "greedy";
  const other = normalizeLabel(OTHER_LABEL);
  const pairs: { gold: string[]; pred: string[]; goldSentiment: Sentiment; predSentiment: Sentiment }[] = [];
  for (const g of opts.golden.items) {
    const ex = opts.extractions.get(g.itemId);
    if (!ex) continue;
    const gold = Array.from(new Set(g.themes.map(normalizeLabel).filter((l) => l && l !== other)));
    const pred = Array.from(new Set(ex.themes.map(normalizeLabel).filter((l) => l && l !== other)));
    pairs.push({ gold: gold.length ? gold : [other], pred: pred.length ? pred : [other], goldSentiment: g.sentiment, predSentiment: ex.sentiment });
  }
  const mapping = alignment === "greedy" ? alignLabels(pairs) : new Map<string, string>();
  let tp = 0;
  let predicted = 0;
  let gold = 0;
  let sentimentHits = 0;
  for (const p of pairs) {
    const goldSet = new Set(p.gold.map((g) => mapping.get(g) ?? g));
    const predSet = new Set(p.pred);
    gold += goldSet.size;
    predicted += predSet.size;
    for (const g of goldSet) if (predSet.has(g)) tp++;
    if (p.goldSentiment === p.predSentiment) sentimentHits++;
  }
  const n = pairs.length;
  const r3 = (x: number): number => Math.round(x * 1000) / 1000;
  return {
    n,
    themePrecision: predicted === 0 ? 0 : r3(tp / predicted),
    themeRecall: gold === 0 ? 0 : r3(tp / gold),
    sentimentAccuracy: n === 0 ? 0 : r3(sentimentHits / n),
  };
}
