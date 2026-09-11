import type { DatasetMeta, Extraction, Item, PipelineEvent, Run, RunContext, RunFile, RunSettings, RunStats, StageName } from "../lib/types";
import { fmtInt, fmtPct, fmtUsd } from "../lib/text";
import { writeBrief } from "./brief";
import { type LLM, type Logger, TrackingLLM } from "./client";
import { runCluster } from "./cluster";
import { PipelineError } from "./errors";
import { evaluate, loadGolden, type GoldenSet } from "./eval";
import { type CounterSnapshot, Timeline } from "./events";
import { BATCH_SIZE, DEFAULT_CONCURRENCY, runExtraction } from "./extract";
import { judgeStrategicFit } from "./fit";
import { loadDataset, normalizeItems } from "./ingest";
import { cacheHitRate, type ModelChoice, resolveModels } from "./models";
import { writeOpportunities } from "./opportunities";
import { MAX_OPPORTUNITIES, rankOpportunities, SCORE_THRESHOLD } from "./rank";
import { draftTaxonomy, TAXONOMY_SAMPLE_SIZE } from "./taxonomy";

export interface RunPipelineOptions {
  /** Load `data/datasets/<id>.json` (+ golden set when present). */
  datasetId?: string;
  /** Or pass items directly (uploads, tests). */
  items?: Item[];
  datasetMeta?: Partial<DatasetMeta>;
  golden?: GoldenSet | null;
  context: RunContext;
  settings: RunSettings;
  llm: LLM;
  onEvent?: (event: PipelineEvent) => void;
  /** Millisecond clock; defaults to performance.now(). Inject in tests. */
  now?: () => number;
  /** Wall-clock ISO timestamps for startedAt/finishedAt. */
  wallClock?: () => Date;
  logger?: Logger;
  runId?: string;
  runNumber?: number;
  models?: Partial<ModelChoice>;
  concurrency?: number;
  batchSize?: number;
  dataRoot?: string;
  /** Marks the run as a bundled demo. */
  demo?: boolean;
}

const STAGE_ORDER: StageName[] = ["ingest", "extract", "cluster", "rank", "brief"];

function emptyStageDurations(): Record<StageName, number> {
  return { ingest: 0, extract: 0, cluster: 0, rank: 0, brief: 0 };
}

/**
 * Run the whole pipeline: ingest → extract → cluster → rank → brief, emitting
 * the event timeline as it goes. Returns the RunFile the UI replays. Safe to
 * call from a route handler: no process.exit, no console output unless a
 * logger is passed. Throws a PipelineError (after emitting an `error` event)
 * when a stage fails.
 */
export async function runPipeline(opts: RunPipelineOptions): Promise<RunFile> {
  const now = opts.now ?? (() => performance.now());
  const wall = opts.wallClock ?? (() => new Date());
  const timeline = new Timeline(now, opts.onEvent, opts.logger);
  const tracker = new TrackingLLM(opts.llm);
  const counters = (): CounterSnapshot => {
    const u = tracker.usage;
    return {
      tokensIn: u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens,
      tokensOut: u.outputTokens,
      costUsd: Math.round(tracker.costUsd * 10000) / 10000,
      cacheHitRate: Math.round(cacheHitRate(u) * 1000) / 1000,
    };
  };
  const resolved = resolveModels(opts.settings.depth);
  const models: ModelChoice = { extract: opts.models?.extract ?? resolved.extract, synth: opts.models?.synth ?? resolved.synth };
  const stageDurations = emptyStageDurations();
  const startedAt = wall().toISOString();
  const runId = opts.runId ?? `run-${startedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}`;

  let current: StageName | undefined;
  let stageStart = 0;
  const begin = (stage: StageName, note?: string): void => {
    current = stage;
    stageStart = timeline.elapsedMs();
    timeline.emit({ type: "stage", stage, status: "running", ...(note ? { note } : {}) });
  };
  const end = (note?: string): void => {
    if (!current) return;
    stageDurations[current] = Math.round(timeline.elapsedMs() - stageStart);
    timeline.emit({ type: "stage", stage: current, status: "done", ...(note ? { note } : {}) });
    current = undefined;
  };

  try {
    // ------------------------------------------------------------ 01 Ingest
    begin("ingest");
    let rawItems: Item[];
    let meta: DatasetMeta;
    let golden: GoldenSet | null = opts.golden ?? null;
    if (opts.items) {
      rawItems = opts.items;
      meta = {
        id: opts.datasetMeta?.id ?? "upload",
        kind: opts.datasetMeta?.kind ?? "Upload",
        name: opts.datasetMeta?.name ?? "Uploaded items",
        meta: opts.datasetMeta?.meta ?? `${fmtInt(rawItems.length)} items`,
        description: opts.datasetMeta?.description ?? "",
        itemCount: rawItems.length,
        sources: opts.datasetMeta?.sources ?? [],
        defaultContext: opts.datasetMeta?.defaultContext ?? { product: opts.context.product },
      };
    } else if (opts.datasetId) {
      const file = await loadDataset(opts.datasetId, opts.dataRoot);
      rawItems = file.items;
      meta = file.meta;
      if (golden === null && opts.golden === undefined) golden = await loadGolden(opts.datasetId, opts.dataRoot);
    } else {
      throw new PipelineError("no_input", "runPipeline needs a datasetId or items", { stage: "ingest" });
    }
    const sourceName = opts.datasetId ? `${opts.datasetId}.json` : meta.name;
    const norm = normalizeItems(rawItems, { cap: opts.settings.cap });
    const items = norm.items;
    timeline.log(
      `Parsed ${fmtInt(rawItems.length)} rows from ${sourceName} · ${norm.sources.length} ${norm.sources.length === 1 ? "source" : "apps"} · ${norm.months} month${norm.months === 1 ? "" : "s"}`,
    );
    timeline.log(
      `Normalized dates and ratings · ${norm.dropped} row${norm.dropped === 1 ? "" : "s"} dropped${norm.capped > 0 ? ` · capped to ${fmtInt(items.length)} of ${fmtInt(rawItems.length)}` : ""}`,
    );
    if (items.length === 0) throw new PipelineError("empty", "No items left after normalization", { stage: "ingest" });
    const sampleSize = Math.min(TAXONOMY_SAMPLE_SIZE, items.length);
    timeline.log(`Sampling ${fmtInt(sampleSize)} reviews to draft a taxonomy…`);
    const { taxonomy } = await draftTaxonomy({ items, context: opts.context, llm: tracker, model: models.synth, sampleSize });
    const taxonomySize = taxonomy.themes.length - 1;
    timeline.log(`Drafted taxonomy: ${taxonomySize} candidate themes + other`);
    end(`${fmtInt(items.length)} items`);

    // ----------------------------------------------------------- 02 Extract
    begin("extract");
    const extracted = await runExtraction({
      items,
      taxonomy,
      llm: tracker,
      model: models.extract,
      timeline,
      counters,
      concurrency: opts.concurrency ?? DEFAULT_CONCURRENCY,
      batchSize: opts.batchSize ?? BATCH_SIZE,
    });
    end(`${fmtInt(items.length)} items · ${extracted.batches} batches`);

    // ----------------------------------------------------------- 03 Cluster
    begin("cluster");
    const clustered = await runCluster({
      items,
      extractions: extracted.extractions,
      ledger: extracted.ledger,
      taxonomy,
      context: opts.context,
      llm: tracker,
      model: models.synth,
      timeline,
    });
    const themes = clustered.themes;
    end(`${themes.length} themes`);

    // -------------------------------------------------------------- 04 Rank
    begin("rank");
    timeline.log(
      opts.context.product.trim()
        ? "Scoring: frequency × severity × recency × strategic fit (from your product context)"
        : "Scoring: frequency × severity × recency × strategic fit (no product context · fit defaults to 0.70)",
    );
    const fits = await judgeStrategicFit({ themes, context: opts.context, llm: tracker, model: models.synth });
    const { ranked } = rankOpportunities(themes, { fits, months: norm.months, threshold: SCORE_THRESHOLD, max: MAX_OPPORTUNITIES });
    const top = ranked.slice(0, 3).map((r) => r.score);
    timeline.log(
      `${ranked.length} opportunit${ranked.length === 1 ? "y" : "ies"} above threshold (score ≥ ${SCORE_THRESHOLD})${top.length ? ` · top: ${top.join(", ")}` : ""}`,
    );
    const itemsById = new Map(items.map((i) => [i.id, i]));
    const opportunities = await writeOpportunities({
      ranked,
      themes,
      items: itemsById,
      extractions: clustered.extractions,
      context: opts.context,
      llm: tracker,
      model: models.synth,
      timeline,
    });
    for (const o of opportunities) {
      const t = themes.find((th) => th.id === o.themeIds[0]);
      if (t) t.opportunityId = o.id;
    }
    end(`${opportunities.length} opportunities`);

    // ------------------------------------------------------------- 05 Brief
    begin("brief");
    timeline.log("Writing brief · every claim mapped to source item IDs…");
    const evalResult = golden ? evaluate({ extractions: clustered.extractions, golden }) : undefined;
    const statsSoFar = counters();
    const briefResult = await writeBrief({
      context: opts.context,
      themes,
      opportunities,
      items: itemsById,
      stats: { items: items.length, ...statsSoFar },
      models,
      batches: extracted.batches,
      taxonomySize,
      mergeCount: clustered.merges.length,
      evalResult,
      datasetName: meta.name,
      llm: tracker,
      model: models.synth,
    });
    timeline.log(
      `Brief written · ${fmtInt(briefResult.brief.wordCount)} words · ${briefResult.citations} citation${briefResult.citations === 1 ? "" : "s"}${
        briefResult.unresolved ? ` · ${briefResult.unresolved} unresolved removed` : ""
      }`,
    );
    if (evalResult && evalResult.n > 0) {
      timeline.log(
        `Eval against ${evalResult.n}-item golden set: precision ${evalResult.themePrecision.toFixed(2)} · recall ${evalResult.themeRecall.toFixed(2)}`,
      );
    }
    end(`${fmtInt(briefResult.brief.wordCount)} words`);

    // ------------------------------------------------------------- Finish
    const final = counters();
    const durationMs = Math.round(timeline.elapsedMs());
    const stats: RunStats = {
      items: items.length,
      themes: themes.length,
      opportunities: opportunities.length,
      tokensIn: final.tokensIn,
      tokensOut: final.tokensOut,
      costUsd: Math.round(tracker.costUsd * 100) / 100,
      cacheHitRate: final.cacheHitRate,
      durationMs,
      stageDurationsMs: stageDurations,
    };
    timeline.log(
      `Done · ${themes.length} themes · ${opportunities.length} opportunities · ${Math.round(durationMs / 1000)}s · ${fmtUsd(stats.costUsd)}${
        final.cacheHitRate > 0 ? ` · cache ${fmtPct(final.cacheHitRate)}` : ""
      }`,
    );

    const referenced = collectReferencedIds(themes, opportunities, timeline.events, briefResult.brief.markdown);
    const runItems: Record<string, Item> = {};
    const runExtractions: Record<string, Extraction> = {};
    for (const id of referenced) {
      const it = itemsById.get(id);
      const ex = clustered.extractions.get(id);
      if (it) runItems[id] = it;
      if (ex) runExtractions[id] = ex;
    }

    const run: Run = {
      id: runId,
      number: opts.runNumber ?? 1,
      datasetId: meta.id,
      datasetName: meta.name,
      sources: norm.sources.length ? norm.sources : meta.sources,
      context: opts.context,
      settings: opts.settings,
      status: "done",
      startedAt,
      finishedAt: wall().toISOString(),
      stats,
      ...(evalResult ? { eval: evalResult } : {}),
      themes,
      opportunities,
      brief: briefResult.brief,
      items: runItems,
      extractions: runExtractions,
      ...(opts.demo ? { demo: true } : {}),
    };
    timeline.emit({ type: "done" });
    return { run, events: timeline.events };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    timeline.emit({ type: "error", message });
    if (err instanceof PipelineError) throw err;
    throw new PipelineError("stage_failed", `${current ?? "pipeline"} failed: ${message}`, { stage: current, cause: err });
  }
}

/** Item ids the run file must carry so the UI can resolve every reference. */
export function collectReferencedIds(
  themes: readonly { exampleItemIds: string[] }[],
  opportunities: readonly { evidence: { itemId: string }[] }[],
  events: readonly PipelineEvent[],
  briefMarkdown: string,
): Set<string> {
  const ids = new Set<string>();
  for (const t of themes) for (const id of t.exampleItemIds) ids.add(id);
  for (const o of opportunities) for (const e of o.evidence) ids.add(e.itemId);
  for (const e of events) if (e.type === "batch") ids.add(e.row.itemId);
  for (const m of briefMarkdown.matchAll(/\[item:([^\]\s]+)\]/g)) ids.add(m[1] as string);
  return ids;
}

export { STAGE_ORDER };
