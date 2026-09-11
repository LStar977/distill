/**
 * Generate data/datasets/fitness.json and fitness.golden.json.
 *
 *   pnpm data:generate [--out data/datasets/fitness.json] [--limit N] [--batch 30]
 *                      [--concurrency 2] [--model claude-sonnet-5] [--max-cost 3] [--plan-only] [--reset] [--seed distill-fitness-v1]
 *
 * The plan (which app, month, rating, themes, persona per item) is built
 * deterministically first; the writer model (default claude-sonnet-5, the
 * cheap option that still writes convincing reviews) then produces the text in
 * batches with structured outputs. Progress is saved to
 * data/datasets/.fitness.partial.json after every batch, so an interrupted run
 * resumes where it stopped. --plan-only prints plan statistics and exits
 * without needing an API key.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import type { Item } from "../src/lib/types";
import { hashSeed } from "../src/lib/prng";
import { normalizeText } from "../src/lib/text";
import { AnthropicLLM, hasCredentials, type LLM, TrackingLLM } from "../src/pipeline/client";
import { MissingApiKeyError, PipelineError } from "../src/pipeline/errors";
import { MODEL_IDS } from "../src/pipeline/models";
import {
  buildPlan,
  DATASET_ID,
  datasetMeta,
  DEFAULT_SEED,
  goldenFor,
  MONTHS,
  OTHER_SUBTOPICS,
  type Plan,
  type PlanRow,
  ratingHistogram,
  themeCounts,
  THEME_SPECS,
} from "./generate/plan";
import { WRITER_SYSTEM } from "./generate/prompts";

const batchSchema = z.object({
  reviews: z.array(z.object({ id: z.string(), text: z.string() })),
});

interface Partial {
  seed: string;
  planHash: number;
  texts: Record<string, string>;
}

function planHash(plan: Plan): number {
  return hashSeed(plan.rows.map((r) => `${r.id}|${r.app}|${r.date}|${r.rating}|${r.themes.join("+")}|${r.persona}|${r.subtopic ?? ""}`).join("\n"));
}

function log(message: string): void {
  process.stderr.write(`${message}\n`);
}

function fail(message: string, code: number): never {
  log(message);
  process.exit(code);
}

export function buildWriterUser(rows: readonly PlanRow[]): string {
  const lines = rows.map((r) => {
    const themes = r.themes.join(" + ");
    const sub = r.subtopic ? ` · subtopic ${r.subtopic}` : "";
    return `- id ${r.id} · ${r.app} · ${r.rating}★ · tone ${r.tone} · themes ${themes}${sub} · persona ${r.persona} · severity ${r.severity} · ${r.date.slice(0, 7)}`;
  });
  return `Write one review for each of these ${rows.length} rows.\n\n${lines.join("\n")}`;
}

function validText(text: string): boolean {
  const t = text.trim();
  if (t.length < 2 || t.length > 700) return false;
  if (/^(review|title)\s*:/i.test(t)) return false;
  return true;
}

function printPlanStats(plan: Plan): void {
  const hist = ratingHistogram(plan.rows);
  log(`plan · ${plan.rows.length} rows · seed ${plan.seed}`);
  log(`ratings · ${hist.map((h, i) => `${i + 1}★ ${(h * 100).toFixed(1)}%`).join(" · ")}`);
  const counts = themeCounts(plan.rows);
  for (const spec of THEME_SPECS) {
    const primary = plan.rows.filter((r) => r.themes[0] === spec.key).length;
    log(`  ${spec.name.padEnd(42)} primary ${String(primary).padStart(4)} · mentions ${String(counts.get(spec.key) ?? 0).padStart(4)} · quota ${spec.quota}`);
  }
  const secondary = plan.rows.filter((r) => r.themes.length > 1).length;
  log(`secondary themes on ${secondary} rows (${((secondary / plan.rows.length) * 100).toFixed(1)}%) · handoff rows ${plan.rows.filter((r) => r.handoff).length}`);
  const byMonth = new Map<string, number>();
  for (const r of plan.rows) byMonth.set(r.date.slice(0, 7), (byMonth.get(r.date.slice(0, 7)) ?? 0) + 1);
  log(`months · ${MONTHS.map((m) => `${m.slice(2)}:${byMonth.get(m) ?? 0}`).join(" ")}`);
  const subs = new Map<string, number>();
  for (const r of plan.rows) if (r.subtopic) subs.set(r.subtopic, (subs.get(r.subtopic) ?? 0) + 1);
  log(`other sub-topics · ${OTHER_SUBTOPICS.map((s) => `${s.key}:${subs.get(s.key) ?? 0}`).join(" ")}`);
}

async function loadPartial(path: string, plan: Plan, reset: boolean): Promise<Partial> {
  const fresh: Partial = { seed: plan.seed, planHash: planHash(plan), texts: {} };
  if (reset) return fresh;
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as Partial;
    if (raw.seed !== plan.seed || raw.planHash !== fresh.planHash) {
      log(`partial file at ${path} was built from a different plan · ignoring it`);
      return fresh;
    }
    log(`resuming · ${Object.keys(raw.texts).length} texts already written`);
    return { ...fresh, texts: raw.texts };
  } catch {
    return fresh;
  }
}

export async function generateTexts(opts: {
  plan: Plan;
  llm: LLM;
  model: string;
  partial: Partial;
  batchSize: number;
  concurrency: number;
  save: (p: Partial) => Promise<void>;
  maxPasses?: number;
}): Promise<Partial> {
  const { plan, partial } = opts;
  const seenTexts = new Set<string>();
  for (const r of plan.rows) if (r.text) seenTexts.add(normalizeText(r.text).toLowerCase());
  for (const t of Object.values(partial.texts)) seenTexts.add(normalizeText(t).toLowerCase());
  const rowById = new Map(plan.rows.map((r) => [r.id, r]));

  for (let pass = 1; pass <= (opts.maxPasses ?? 3); pass++) {
    const pending = plan.rows.filter((r) => !r.text && !partial.texts[r.id]);
    if (pending.length === 0) break;
    const batches: PlanRow[][] = [];
    for (let i = 0; i < pending.length; i += opts.batchSize) batches.push(pending.slice(i, i + opts.batchSize));
    log(`pass ${pass} · ${pending.length} rows pending · ${batches.length} batches of ${opts.batchSize} · ${opts.model}`);
    let done = 0;
    let accepted = 0;
    let rejected = 0;
    const handled = plan.rows.filter((r) => r.text).length;
    const runBatch = async (batch: PlanRow[]): Promise<void> => {
      const { output, usage } = await opts.llm.parse({
        model: opts.model,
        system: WRITER_SYSTEM,
        user: buildWriterUser(batch),
        schema: batchSchema,
        purpose: "write-reviews",
        maxTokens: 8192,
      });
      const wanted = new Set(batch.map((r) => r.id));
      for (const rev of output.reviews) {
        if (!wanted.has(rev.id) || partial.texts[rev.id] || !rowById.has(rev.id)) continue;
        const text = normalizeText(rev.text);
        const key = text.toLowerCase();
        if (!validText(text) || seenTexts.has(key)) {
          rejected++;
          continue;
        }
        seenTexts.add(key);
        partial.texts[rev.id] = text;
        accepted++;
      }
      done++;
      await opts.save(partial);
      const total = Object.keys(partial.texts).length + handled;
      log(
        `  batch ${done}/${batches.length} · ${total}/${plan.rows.length} texts · ${usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens} in / ${usage.outputTokens} out · cache read ${usage.cacheReadTokens}`,
      );
    };
    // First batch alone so the cached system prompt is written before the fan-out.
    await runBatch(batches[0] as PlanRow[]);
    let cursor = 1;
    const worker = async (): Promise<void> => {
      while (cursor < batches.length) {
        const index = cursor++;
        await runBatch(batches[index] as PlanRow[]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(opts.concurrency, Math.max(0, batches.length - 1)) }, () => worker()));
    log(`pass ${pass} done · accepted ${accepted} · rejected ${rejected} (duplicates or malformed)`);
  }
  return partial;
}

function toItems(plan: Plan, partial: Partial): { items: Item[]; missing: string[] } {
  const items: Item[] = [];
  const missing: string[] = [];
  for (const r of plan.rows) {
    const text = r.text ?? partial.texts[r.id];
    if (!text) {
      missing.push(r.id);
      continue;
    }
    items.push({ id: r.id, source: r.app, text, rating: r.rating, date: r.date, segment: r.persona });
  }
  return { items, missing };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      out: { type: "string", default: `data/datasets/${DATASET_ID}.json` },
      limit: { type: "string" },
      batch: { type: "string", default: "30" },
      concurrency: { type: "string", default: "2" },
      seed: { type: "string", default: DEFAULT_SEED },
      model: { type: "string", default: MODEL_IDS.sonnet },
      "max-cost": { type: "string", default: "3" },
      "plan-only": { type: "boolean", default: false },
      reset: { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
  });
  if (values.help) {
    process.stdout.write("usage: pnpm data:generate [--out file] [--limit N] [--batch 30] [--concurrency 2] [--model id] [--max-cost 3] [--plan-only] [--reset] [--seed s]\n");
    return;
  }
  const limit = values.limit !== undefined ? Number(values.limit) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) fail("--limit must be a positive integer", 2);
  const batchSize = Number(values.batch);
  const concurrency = Number(values.concurrency);
  if (!Number.isInteger(batchSize) || batchSize <= 0 || !Number.isInteger(concurrency) || concurrency <= 0) fail("--batch and --concurrency must be positive integers", 2);

  const plan = buildPlan(values.seed, limit);
  printPlanStats(plan);
  if (values["plan-only"]) return;

  const maxCostUsd = Number(values["max-cost"]);
  if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0) fail("--max-cost must be a positive dollar amount", 2);
  if (!hasCredentials()) throw new MissingApiKeyError();

  const outPath = resolve(values.out);
  const outDir = dirname(outPath);
  await mkdir(outDir, { recursive: true });
  const partialPath = join(outDir, `.${DATASET_ID}.partial.json`);
  const partial = await loadPartial(partialPath, plan, values.reset);
  const save = async (p: Partial): Promise<void> => {
    await writeFile(partialPath, JSON.stringify(p), "utf8");
  };

  const llm = new TrackingLLM(new AnthropicLLM({ logger: { warn: (m) => log(`  ! ${m}`) } }), undefined, { maxCostUsd });
  log(`writer ${values.model} · spend cap $${maxCostUsd.toFixed(2)} · progress saved after every batch`);
  await generateTexts({ plan, llm, model: values.model, partial, batchSize, concurrency, save });
  log(`spent $${llm.costUsd.toFixed(2)} on ${llm.calls.length} calls`);

  const { items, missing } = toItems(plan, partial);
  if (missing.length > 0) {
    log(`${missing.length} rows still have no text after 3 passes · partial progress kept at ${partialPath}; rerun to continue`);
    process.exit(1);
  }
  const golden = goldenFor(plan);
  const validGoldenIds = new Set(items.map((i) => i.id));
  golden.items = golden.items.filter((g) => validGoldenIds.has(g.itemId));

  const dataset = { meta: datasetMeta(items.length), items };
  await writeFile(outPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
  const goldenPath = outPath.replace(/\.json$/, ".golden.json");
  await writeFile(goldenPath, `${JSON.stringify(golden, null, 2)}\n`, "utf8");
  await rm(partialPath, { force: true });
  log(`wrote ${outPath} (${items.length} items) and ${goldenPath} (${golden.items.length} golden items)`);
}

main().catch((err: unknown) => {
  if (err instanceof PipelineError) fail(`error [${err.code}]: ${err.message}`, 1);
  fail(`error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`, 1);
});
