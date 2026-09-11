import { z } from "zod";
import type { Extraction, Item, QuoteSpan, Sentiment, Severity } from "../lib/types";
import { findSpan, fmtInt, fmtPct, fmtUsd, longestSentence, normalizeLabel, slugify } from "../lib/text";
import type { LLM } from "./client";
import { LLMRefusalError, LLMRequestError } from "./errors";
import type { CounterSnapshot, Timeline } from "./events";
import { EXTRACT_INSTRUCTIONS, EXTRACT_TAXONOMY_HEADER } from "./prompts/extract";
import { OTHER_LABEL, taxonomyIndex, type Taxonomy, type TaxonomyTheme } from "./taxonomy";

export const BATCH_SIZE = 20;
export const DEFAULT_CONCURRENCY = 4;
/** A raw label with this many mentions is announced as a new theme in the log. */
export const NEW_THEME_SUPPORT = 10;

const SENTIMENTS = ["positive", "negative", "neutral", "mixed"] as const;

export const extractionRowSchema = z.object({
  itemId: z.string(),
  sentiment: z.enum(SENTIMENTS),
  severity: z.number().int().describe("1 to 5"),
  themes: z.array(z.string()).describe("Taxonomy labels verbatim, or a new short label"),
  painPoints: z.array(z.string()),
  featureRequests: z.array(z.string()),
  quotes: z.array(z.string()).describe("Verbatim substrings of the item text"),
  segments: z.array(z.string()),
});

export const extractBatchSchema = z.object({ items: z.array(extractionRowSchema) });
export type ExtractionRow = z.infer<typeof extractionRowSchema>;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function batchItems<T>(items: readonly T[], size = BATCH_SIZE): T[][] {
  if (size <= 0) throw new RangeError("batch size must be positive");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function renderTaxonomy(taxonomy: Taxonomy): string {
  const lines = taxonomy.themes.map((t) => `- ${t.name} — ${t.description}`);
  return `${EXTRACT_TAXONOMY_HEADER}\n${lines.join("\n")}`;
}

/** Frozen per run: instructions + taxonomy. */
export function buildExtractSystem(taxonomy: Taxonomy): string {
  return `${EXTRACT_INSTRUCTIONS}\n\n${renderTaxonomy(taxonomy)}`;
}

export function buildExtractUser(batch: readonly Item[]): string {
  const rows = batch.map((it) => {
    const bits = [it.id, it.source];
    if (it.rating !== undefined) bits.push(`${it.rating}★`);
    if (it.date) bits.push(it.date);
    return `[${bits.join(" · ")}]\n${it.text}`;
  });
  return `Batch of ${batch.length} items. Return one record per item id, in order.\n\n${rows.join("\n\n")}`;
}

/**
 * Keep only quotes that are real substrings of the item text. When none
 * survive, fall back to the longest sentence so every extraction has a span.
 */
export function validateQuotes(text: string, quotes: readonly string[], max = 2): QuoteSpan[] {
  const spans: QuoteSpan[] = [];
  for (const q of quotes) {
    const span = findSpan(text, q);
    if (!span || span.text.trim().length < 3) continue;
    if (spans.some((s) => s.start === span.start && s.end === span.end)) continue;
    spans.push(span);
    if (spans.length >= max) break;
  }
  if (spans.length === 0) {
    const sentence = longestSentence(text);
    const span = findSpan(text, sentence) ?? { start: 0, end: text.length, text };
    spans.push(span);
  }
  return spans;
}

export function clampSeverity(n: number): Severity {
  const v = Math.min(5, Math.max(1, Math.round(Number.isFinite(n) ? n : 1)));
  return v as Severity;
}

/** Map a proposed label onto the taxonomy when it matches; otherwise keep it as a tidy raw label. */
export function canonicalLabel(label: string, index: Map<string, TaxonomyTheme>): { label: string; raw: boolean } {
  const key = normalizeLabel(label);
  if (!key) return { label: OTHER_LABEL, raw: false };
  const hit = index.get(key);
  if (hit) return { label: hit.name, raw: false };
  const cleaned = label.trim().replace(/\s+/g, " ").replace(/[.]+$/g, "");
  const cased = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return { label: cased.slice(0, 60), raw: true };
}

export function defaultExtraction(item: Item): Extraction {
  return {
    itemId: item.id,
    sentiment: "neutral",
    severity: 1,
    themes: [OTHER_LABEL],
    painPoints: [],
    featureRequests: [],
    quotes: validateQuotes(item.text, []),
    segments: item.segment ? [item.segment] : [],
  };
}

export interface NormalizedRow {
  extraction: Extraction;
  rawLabels: string[];
}

/** Turn a model row into a validated Extraction for a known item. */
export function normalizeRow(item: Item, row: ExtractionRow, index: Map<string, TaxonomyTheme>): NormalizedRow {
  const themes: string[] = [];
  const rawLabels: string[] = [];
  for (const t of row.themes) {
    const c = canonicalLabel(t, index);
    if (themes.includes(c.label)) continue;
    themes.push(c.label);
    if (c.raw) rawLabels.push(c.label);
  }
  if (themes.length === 0) themes.push(OTHER_LABEL);
  if (themes.length > 1 && themes.includes(OTHER_LABEL)) themes.splice(themes.indexOf(OTHER_LABEL), 1);
  const segments = Array.from(new Set(row.segments.map((s) => s.trim()).filter(Boolean)));
  return {
    extraction: {
      itemId: item.id,
      sentiment: row.sentiment,
      severity: clampSeverity(row.severity),
      themes,
      painPoints: row.painPoints.map((s) => s.trim()).filter(Boolean).slice(0, 5),
      featureRequests: row.featureRequests.map((s) => s.trim()).filter(Boolean).slice(0, 5),
      quotes: validateQuotes(item.text, row.quotes),
      segments,
    },
    rawLabels,
  };
}

/** Highest severity wins; ties go to the longer quote so the stream row reads well. */
export function pickRepresentative(extractions: readonly Extraction[]): Extraction {
  if (extractions.length === 0) throw new RangeError("no extractions");
  return extractions.reduce((best, e) => {
    if (e.severity !== best.severity) return e.severity > best.severity ? e : best;
    const lb = best.quotes[0]?.text.length ?? 0;
    const le = e.quotes[0]?.text.length ?? 0;
    return le > lb ? e : best;
  });
}

/** Running per-label statistics kept during extraction. */
export interface LabelStat {
  label: string;
  id: string;
  raw: boolean;
  count: number;
  severitySum: number;
  sentiments: Record<Sentiment, number>;
  itemIds: string[];
}

export function labelIdFor(label: string, taxonomy: Taxonomy): string {
  const hit = taxonomy.themes.find((t) => t.name === label);
  return hit ? hit.id : `raw-${slugify(label, 40)}`;
}

export function dominantSentiment(counts: Record<Sentiment, number>): Sentiment {
  const total = counts.positive + counts.negative + counts.neutral + counts.mixed;
  if (total === 0) return "neutral";
  const pos = counts.positive / total;
  const neg = counts.negative / total;
  if (pos >= 0.25 && neg >= 0.25) return "mixed";
  if (neg >= 0.5) return "negative";
  if (pos >= 0.5) return "positive";
  if (neg > pos && neg > (counts.neutral + counts.mixed) / total) return "negative";
  if (pos > neg && pos > (counts.neutral + counts.mixed) / total) return "positive";
  return "neutral";
}

export class LabelLedger {
  readonly stats = new Map<string, LabelStat>();
  constructor(private readonly taxonomy: Taxonomy) {
    for (const t of taxonomy.themes) this.ensure(t.name, false);
  }
  ensure(label: string, raw: boolean): LabelStat {
    let s = this.stats.get(label);
    if (!s) {
      s = {
        label,
        id: labelIdFor(label, this.taxonomy),
        raw,
        count: 0,
        severitySum: 0,
        sentiments: { positive: 0, negative: 0, neutral: 0, mixed: 0 },
        itemIds: [],
      };
      this.stats.set(label, s);
    }
    return s;
  }
  /** Record an extraction; returns the labels whose counts changed. */
  add(extraction: Extraction, rawLabels: readonly string[]): LabelStat[] {
    const touched: LabelStat[] = [];
    for (const label of extraction.themes) {
      const s = this.ensure(label, rawLabels.includes(label));
      s.count++;
      s.severitySum += extraction.severity;
      s.sentiments[extraction.sentiment]++;
      s.itemIds.push(extraction.itemId);
      touched.push(s);
    }
    return touched;
  }
  rawLabels(): LabelStat[] {
    return Array.from(this.stats.values()).filter((s) => s.raw);
  }
  severityAvg(s: LabelStat): number {
    return s.count === 0 ? 0 : Math.round((s.severitySum / s.count) * 10) / 10;
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export interface ExtractOptions {
  items: readonly Item[];
  taxonomy: Taxonomy;
  llm: LLM;
  model: string;
  timeline: Timeline;
  /** Live token/cost totals for `counters` events and log lines. */
  counters: () => CounterSnapshot;
  concurrency?: number;
  batchSize?: number;
  /** Attempts per batch before its items fall back to a default extraction. Default 2. */
  attemptsPerBatch?: number;
}

export interface ExtractResult {
  extractions: Map<string, Extraction>;
  ledger: LabelLedger;
  batches: number;
  retries: number;
  /** Items that had to fall back to a default extraction. */
  failures: number;
  /** Items the model skipped in an otherwise successful batch (filled with defaults). */
  missing: number;
}

interface BatchOutcome {
  index: number;
  rows: NormalizedRow[];
  retries: number;
  failed: boolean;
  missing: number;
}

async function runBatch(
  index: number,
  batch: readonly Item[],
  opts: ExtractOptions,
  system: string,
  taxIndex: Map<string, TaxonomyTheme>,
): Promise<BatchOutcome> {
  const attempts = Math.max(1, opts.attemptsPerBatch ?? 2);
  let retries = 0;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const { output } = await opts.llm.parse({
        model: opts.model,
        system,
        user: buildExtractUser(batch),
        schema: extractBatchSchema,
        purpose: "extract",
        maxTokens: 8192,
      });
      const byId = new Map<string, ExtractionRow>();
      for (const row of output.items) if (!byId.has(row.itemId)) byId.set(row.itemId, row);
      let missing = 0;
      const rows = batch.map((item) => {
        const row = byId.get(item.id);
        if (!row) {
          missing++;
          return { extraction: defaultExtraction(item), rawLabels: [] };
        }
        return normalizeRow(item, row, taxIndex);
      });
      return { index, rows, retries, failed: false, missing };
    } catch (err) {
      if (err instanceof LLMRequestError) throw err;
      if (err instanceof LLMRefusalError || attempt >= attempts) {
        return {
          index,
          rows: batch.map((item) => ({ extraction: defaultExtraction(item), rawLabels: [] })),
          retries,
          failed: true,
          missing: 0,
        };
      }
      retries++;
    }
  }
  throw new Error("unreachable");
}

/**
 * Extract every item in batches with bounded concurrency. The first batch runs
 * alone so its cache write lands before the rest fan out.
 */
export async function runExtraction(opts: ExtractOptions): Promise<ExtractResult> {
  const { items, taxonomy, timeline } = opts;
  const batchSize = opts.batchSize ?? BATCH_SIZE;
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);
  const batches = batchItems(items, batchSize);
  const system = buildExtractSystem(taxonomy);
  const taxIndex = taxonomyIndex(taxonomy);
  const ledger = new LabelLedger(taxonomy);
  const extractions = new Map<string, Extraction>();

  let processed = 0;
  let retries = 0;
  let failures = 0;
  let missing = 0;
  let nextProgressLog = 500;
  let cacheWarmLogged = false;
  let midwayLogged = false;
  let rawLogsEmitted = 0;
  const announcedNew = new Set<string>();
  const seenRaw = new Set<string>();

  timeline.log(
    `Extracting in batches of ${batchSize} · ${fmtInt(batches.length)} batch${batches.length === 1 ? "" : "es"} · taxonomy prompt cached`,
  );

  const onOutcome = (outcome: BatchOutcome): void => {
    const batchNumber = outcome.index + 1;
    retries += outcome.retries;
    missing += outcome.missing;
    if (outcome.failed) failures += outcome.rows.length;
    const touched = new Map<string, LabelStat>();
    for (const row of outcome.rows) {
      extractions.set(row.extraction.itemId, row.extraction);
      for (const s of ledger.add(row.extraction, row.rawLabels)) touched.set(s.label, s);
      for (const raw of row.rawLabels) {
        if (seenRaw.has(raw)) continue;
        seenRaw.add(raw);
        if (rawLogsEmitted < 8) {
          timeline.log(
            rawLogsEmitted === 0
              ? `Batch ${batchNumber} proposed a label outside the taxonomy: '${raw}' · keeping as raw`
              : `Batch ${batchNumber} proposed '${raw}' · keeping as raw`,
          );
          rawLogsEmitted++;
        }
      }
    }
    processed += outcome.rows.length;

    const representative = pickRepresentative(outcome.rows.map((r) => r.extraction));
    timeline.emit({
      type: "batch",
      batch: batchNumber,
      totalBatches: batches.length,
      processed,
      row: { batch: batchNumber, itemId: representative.itemId, extraction: representative },
    });

    for (const s of touched.values()) {
      timeline.emit({
        type: "theme",
        themeId: s.id,
        name: s.label,
        short: taxonomy.themes.find((t) => t.name === s.label)?.short ?? s.label.split(/\s+/).slice(0, 2).join(" "),
        count: s.count,
        sentiment: dominantSentiment(s.sentiments),
        severityAvg: ledger.severityAvg(s),
        ...(s.raw ? { transient: true } : {}),
        ...(s.label === OTHER_LABEL ? { other: true } : {}),
      });
      if (s.raw && s.count >= NEW_THEME_SUPPORT && !announcedNew.has(s.label)) {
        announcedNew.add(s.label);
        const sev = ledger.severityAvg(s);
        timeline.log(`New theme from batch ${batchNumber}: '${s.label}'${sev >= 4.5 ? " · severity 5 flagged" : ""}`);
      }
    }

    const c = opts.counters();
    timeline.emit({
      type: "counters",
      processed,
      tokensIn: c.tokensIn,
      tokensOut: c.tokensOut,
      costUsd: c.costUsd,
      cacheHitRate: c.cacheHitRate,
    });
    if (!cacheWarmLogged && c.cacheHitRate >= 0.25) {
      cacheWarmLogged = true;
      timeline.log(`Cache warm · hit rate ${fmtPct(c.cacheHitRate)} and climbing`);
    }
    if (processed >= nextProgressLog && processed < items.length) {
      nextProgressLog += 500;
      timeline.log(`${fmtInt(processed)} processed · ${ledger.rawLabels().length} raw themes · ${fmtUsd(c.costUsd)} so far`);
    }
    if (!midwayLogged && batches.length >= 4 && processed >= items.length * 0.55 && processed < items.length) {
      midwayLogged = true;
      timeline.log(`Batch ${batchNumber} done · cache hit rate ${fmtPct(c.cacheHitRate)}`);
    }
  };

  if (batches.length > 0) {
    onOutcome(await runBatch(0, batches[0] as Item[], opts, system, taxIndex));
  }
  let cursor = 1;
  const worker = async (): Promise<void> => {
    while (cursor < batches.length) {
      const index = cursor++;
      onOutcome(await runBatch(index, batches[index] as Item[], opts, system, taxIndex));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(0, batches.length - 1)) }, () => worker()));

  timeline.log(
    `Extraction complete · ${fmtInt(processed)} / ${fmtInt(items.length)} · ${failures} failure${failures === 1 ? "" : "s"} · ${retries} retr${retries === 1 ? "y" : "ies"}`,
  );
  return { extractions, ledger, batches: batches.length, retries, failures, missing };
}
