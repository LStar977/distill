import { z } from "zod";
import type { Extraction, Item, RunContext, Sentiment, Theme } from "../lib/types";
import { fmtInt, normalizeLabel, slugify } from "../lib/text";
import type { LLM } from "./client";
import type { Timeline } from "./events";
import { dominantSentiment, type LabelLedger, type LabelStat } from "./extract";
import { CLUSTER_SYSTEM } from "./prompts/cluster";
import { OTHER_ID, OTHER_LABEL, renderContext, type Taxonomy } from "./taxonomy";

export const TREND_BUCKETS = 8;
export const EXAMPLES_PER_THEME = 5;

export const consolidationSchema = z.object({
  merges: z.array(
    z.object({
      label: z.string().describe("The label being merged away"),
      into: z.string().describe("The surviving label"),
      similarity: z.number().describe("0 to 1"),
    }),
  ),
  themes: z.array(
    z.object({
      label: z.string().describe("Current label, exactly as given"),
      name: z.string(),
      short: z.string(),
      description: z.string(),
    }),
  ),
});
export type ConsolidationDecision = z.infer<typeof consolidationSchema>;

/** A final theme before aggregation: identity plus the labels that feed it. */
export interface FinalThemeDef {
  id: string;
  name: string;
  short: string;
  description: string;
  other?: boolean;
  /** Extraction labels (canonical taxonomy names or raw labels) that map here. */
  sourceLabels: string[];
}

export interface MergeRecord {
  fromLabel: string;
  fromId: string;
  intoLabel: string;
  intoId: string;
  similarity: number;
}

/** Minimum mentions for a raw label to be shown to the consolidation model. */
export function minSupport(itemCount: number): number {
  return Math.max(2, Math.round(itemCount * 0.0015));
}

// ---------------------------------------------------------------------------
// Merge map (pure)
// ---------------------------------------------------------------------------

/** label → final label. Resolves chains (a→b→c) and breaks cycles at Other. */
export function resolveMergeMap(direct: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const start of Object.keys(direct)) {
    let cur = start;
    const seen = new Set<string>([start]);
    while (direct[cur] !== undefined && direct[cur] !== cur) {
      const next = direct[cur] as string;
      if (seen.has(next)) {
        cur = OTHER_LABEL;
        break;
      }
      seen.add(next);
      cur = next;
    }
    out[start] = cur;
  }
  return out;
}

/** Apply a resolved merge map to one extraction's labels (dedupes, keeps order). */
export function applyMergeMap(extraction: Extraction, mergeMap: Record<string, string>): Extraction {
  const themes: string[] = [];
  for (const t of extraction.themes) {
    const mapped = mergeMap[t] ?? t;
    if (!themes.includes(mapped)) themes.push(mapped);
  }
  if (themes.length > 1 && themes.includes(OTHER_LABEL)) themes.splice(themes.indexOf(OTHER_LABEL), 1);
  return { ...extraction, themes };
}

export interface DecisionInput {
  taxonomy: Taxonomy;
  /** All labels with counts, taxonomy and raw. */
  stats: readonly LabelStat[];
  /** Raw labels below the support floor (already folded to Other). */
  folded: readonly string[];
}

export interface DecisionOutput {
  defs: FinalThemeDef[];
  mergeMap: Record<string, string>;
  merges: MergeRecord[];
  /** Raw labels the model neither merged nor promoted; folded into Other. */
  unplaced: string[];
  droppedEmpty: string[];
}

function labelKeyIndex(stats: readonly LabelStat[]): Map<string, LabelStat> {
  const idx = new Map<string, LabelStat>();
  for (const s of stats) idx.set(normalizeLabel(s.label), s);
  return idx;
}

/**
 * Turn the model's decision into a merge map and final theme definitions.
 * Pure; tolerant of labels the model misspelled (matched by normalized text)
 * or forgot (folded into Other for raw labels, kept as-is for taxonomy themes).
 */
export function applyDecision(input: DecisionInput, decision: ConsolidationDecision): DecisionOutput {
  const { taxonomy, stats, folded } = input;
  const byKey = labelKeyIndex(stats);
  const statOf = (label: string): LabelStat | undefined => byKey.get(normalizeLabel(label));
  const taxonomyByName = new Map(taxonomy.themes.map((t) => [t.name, t]));
  const isOther = (label: string): boolean => normalizeLabel(label) === normalizeLabel(OTHER_LABEL);

  const direct: Record<string, string> = {};
  const merges: MergeRecord[] = [];
  const mergedAway = new Set<string>();
  for (const m of decision.merges) {
    const from = statOf(m.label);
    const into = statOf(m.into);
    if (!from || !into || from.label === into.label || isOther(from.label) || isOther(into.label)) continue;
    if (mergedAway.has(from.label)) continue;
    const similarity = Math.min(1, Math.max(0, Math.round(m.similarity * 100) / 100));
    if (similarity < 0.6) continue;
    direct[from.label] = into.label;
    mergedAway.add(from.label);
    merges.push({ fromLabel: from.label, fromId: from.id, intoLabel: into.label, intoId: into.id, similarity });
  }
  for (const f of folded) direct[f] = OTHER_LABEL;

  const named = new Map<string, { name: string; short: string; description: string }>();
  for (const t of decision.themes) {
    const s = statOf(t.label);
    if (!s || isOther(s.label) || mergedAway.has(s.label)) continue;
    named.set(s.label, { name: t.name.trim() || s.label, short: t.short.trim() || s.label, description: t.description.trim() });
  }

  const unplaced: string[] = [];
  const droppedEmpty: string[] = [];
  const surviving: LabelStat[] = [];
  for (const s of stats) {
    if (isOther(s.label) || mergedAway.has(s.label) || folded.includes(s.label)) continue;
    if (s.raw && !named.has(s.label)) {
      direct[s.label] = OTHER_LABEL;
      unplaced.push(s.label);
      continue;
    }
    if (!s.raw && s.count === 0) {
      droppedEmpty.push(s.label);
      continue;
    }
    surviving.push(s);
  }

  const mergeMap = resolveMergeMap(direct);
  // A merge target that itself merged away or folded collapses transitively; fix up merge records.
  for (const m of merges) {
    const final = mergeMap[m.intoLabel] ?? m.intoLabel;
    if (final !== m.intoLabel) {
      m.intoLabel = final;
      m.intoId = statOf(final)?.id ?? OTHER_ID;
    }
  }

  const takenIds = new Set<string>([OTHER_ID]);
  const defs: FinalThemeDef[] = [];
  for (const s of surviving) {
    const tax = taxonomyByName.get(s.label);
    const n = named.get(s.label);
    const name = n?.name ?? tax?.name ?? s.label;
    const short = (n?.short ?? tax?.short ?? name.split(/\s+/).slice(0, 2).join(" ")).slice(0, 24);
    const description = (n?.description ?? tax?.description ?? "").slice(0, 200);
    let id = tax?.id ?? slugify(name, 40) ?? "theme";
    if (!tax) {
      const base = id;
      let k = 2;
      while (takenIds.has(id)) id = `${base}-${k++}`;
    }
    takenIds.add(id);
    const sourceLabels = [s.label, ...Object.keys(mergeMap).filter((k) => mergeMap[k] === s.label)];
    defs.push({ id, name, short, description, sourceLabels });
  }
  const otherSources = [OTHER_LABEL, ...Object.keys(mergeMap).filter((k) => mergeMap[k] === OTHER_LABEL)];
  defs.push({
    id: OTHER_ID,
    name: OTHER_LABEL,
    short: "Other",
    description: "Feedback that did not map to a theme with enough support.",
    other: true,
    sourceLabels: otherSources,
  });
  return { defs, mergeMap, merges, unplaced, droppedEmpty };
}

// ---------------------------------------------------------------------------
// Aggregation (pure)
// ---------------------------------------------------------------------------

/** Percentages [positive, neutral, negative] summing to 100 (largest remainder). "mixed" counts as neutral. */
export function sentimentSplit(counts: Record<Sentiment, number>): [number, number, number] {
  const raw = [counts.positive, counts.neutral + counts.mixed, counts.negative];
  const total = raw[0]! + raw[1]! + raw[2]!;
  if (total === 0) return [0, 100, 0];
  const exact = raw.map((v) => (v / total) * 100);
  const floors = exact.map((v) => Math.floor(v));
  let remainder = 100 - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i] = (floors[i] ?? 0) + 1;
    remainder--;
  }
  return [floors[0] ?? 0, floors[1] ?? 0, floors[2] ?? 0];
}

export interface TimeRange {
  fromMs: number;
  toMs: number;
}

export function dateRange(items: readonly Item[]): TimeRange | null {
  let fromMs = Number.POSITIVE_INFINITY;
  let toMs = Number.NEGATIVE_INFINITY;
  for (const it of items) {
    if (!it.date) continue;
    const ms = Date.parse(it.date);
    if (Number.isNaN(ms)) continue;
    if (ms < fromMs) fromMs = ms;
    if (ms > toMs) toMs = ms;
  }
  return Number.isFinite(fromMs) ? { fromMs, toMs } : null;
}

/** Index of the bucket a date falls in, oldest first. */
export function bucketIndex(date: string | undefined, range: TimeRange, buckets = TREND_BUCKETS): number | null {
  if (!date) return null;
  const ms = Date.parse(date);
  if (Number.isNaN(ms)) return null;
  if (range.toMs === range.fromMs) return buckets - 1;
  const frac = (ms - range.fromMs) / (range.toMs - range.fromMs);
  return Math.min(buckets - 1, Math.max(0, Math.floor(frac * buckets)));
}

export interface AggregateInput {
  items: readonly Item[];
  /** Extractions with labels already mapped through the merge map. */
  extractions: ReadonlyMap<string, Extraction>;
  defs: readonly FinalThemeDef[];
  buckets?: number;
}

/** Counts, shares, sentiment split, severity average, trend and examples per theme. Ranks by count, Other last. */
export function aggregateThemes(input: AggregateInput): Theme[] {
  const buckets = input.buckets ?? TREND_BUCKETS;
  const itemsById = new Map(input.items.map((i) => [i.id, i]));
  const range = dateRange(input.items);
  const labelToDef = new Map<string, FinalThemeDef>();
  for (const d of input.defs) for (const l of d.sourceLabels) labelToDef.set(l, d);
  const otherDef = input.defs.find((d) => d.other);

  interface Acc {
    def: FinalThemeDef;
    itemIds: Set<string>;
    severitySum: number;
    sentiments: Record<Sentiment, number>;
    trend: number[];
    examples: { id: string; severity: number; quoteLen: number }[];
  }
  const acc = new Map<string, Acc>();
  for (const d of input.defs) {
    acc.set(d.id, {
      def: d,
      itemIds: new Set(),
      severitySum: 0,
      sentiments: { positive: 0, negative: 0, neutral: 0, mixed: 0 },
      trend: Array.from({ length: buckets }, () => 0),
      examples: [],
    });
  }

  for (const ex of input.extractions.values()) {
    const item = itemsById.get(ex.itemId);
    if (!item) continue;
    const defs = new Set<FinalThemeDef>();
    for (const label of ex.themes) {
      const d = labelToDef.get(label) ?? otherDef;
      if (d) defs.add(d);
    }
    for (const d of defs) {
      const a = acc.get(d.id);
      if (!a || a.itemIds.has(item.id)) continue;
      a.itemIds.add(item.id);
      a.severitySum += ex.severity;
      a.sentiments[ex.sentiment]++;
      if (range) {
        const b = bucketIndex(item.date, range, buckets);
        if (b !== null) a.trend[b] = (a.trend[b] ?? 0) + 1;
      }
      a.examples.push({ id: item.id, severity: ex.severity, quoteLen: ex.quotes[0]?.text.length ?? 0 });
    }
  }

  const total = input.items.length || 1;
  const themes = Array.from(acc.values()).map((a): Theme => {
    const count = a.itemIds.size;
    a.examples.sort((x, y) => y.severity - x.severity || y.quoteLen - x.quoteLen || (x.id < y.id ? -1 : 1));
    return {
      id: a.def.id,
      rank: 0,
      name: a.def.name,
      short: a.def.short,
      description: a.def.description,
      count,
      share: Math.round((count / total) * 10000) / 10000,
      sentiment: dominantSentiment(a.sentiments),
      sentimentSplit: sentimentSplit(a.sentiments),
      severityAvg: count === 0 ? 0 : Math.round((a.severitySum / count) * 10) / 10,
      trend: a.trend,
      exampleItemIds: a.examples.slice(0, EXAMPLES_PER_THEME).map((e) => e.id),
      ...(a.def.other ? { other: true } : {}),
    };
  });

  themes.sort((x, y) => {
    if (Boolean(x.other) !== Boolean(y.other)) return x.other ? 1 : -1;
    return y.count - x.count || (x.name < y.name ? -1 : 1);
  });
  themes.forEach((t, i) => {
    t.rank = i + 1;
  });
  return themes;
}

// ---------------------------------------------------------------------------
// LLM call + orchestration
// ---------------------------------------------------------------------------

export function buildClusterUser(input: {
  context: RunContext;
  taxonomyStats: readonly LabelStat[];
  rawStats: readonly LabelStat[];
  examples: (stat: LabelStat) => string[];
}): string {
  const tax = input.taxonomyStats.map((s) => `- "${s.label}" · ${s.count} mentions`);
  const raw = input.rawStats.map((s) => {
    const ex = input
      .examples(s)
      .map((t) => `    · ${t}`)
      .join("\n");
    return `- "${s.label}" · ${s.count} mentions\n${ex}`;
  });
  return `${renderContext(input.context)}\n\nTaxonomy themes:\n${tax.join("\n")}\n\nRaw labels proposed outside the taxonomy:\n${
    raw.length ? raw.join("\n") : "(none)"
  }`;
}

export interface ClusterOptions {
  items: readonly Item[];
  extractions: ReadonlyMap<string, Extraction>;
  ledger: LabelLedger;
  taxonomy: Taxonomy;
  context: RunContext;
  llm: LLM;
  model: string;
  timeline: Timeline;
}

export interface ClusterResult {
  themes: Theme[];
  defs: FinalThemeDef[];
  mergeMap: Record<string, string>;
  merges: MergeRecord[];
  /** Extractions with labels mapped to final theme labels. */
  extractions: Map<string, Extraction>;
  /** Final theme name → theme id. */
  labelToThemeId: Record<string, string>;
}

export async function runCluster(opts: ClusterOptions): Promise<ClusterResult> {
  const { timeline, ledger, taxonomy } = opts;
  const stats = Array.from(ledger.stats.values());
  const floor = minSupport(opts.items.length);
  const rawStats = stats.filter((s) => s.raw);
  const folded = rawStats.filter((s) => s.count < floor).map((s) => s.label);
  const shownRaw = rawStats.filter((s) => s.count >= floor).sort((a, b) => b.count - a.count);
  const taxonomyStats = stats.filter((s) => !s.raw && !(s.label === OTHER_LABEL)).filter((s) => s.count > 0);
  const totalRaw = stats.filter((s) => s.count > 0).length;

  timeline.log(`Consolidating ${fmtInt(totalRaw)} raw themes…`);
  if (folded.length > 0) timeline.log(`Folded ${folded.length} label${folded.length === 1 ? "" : "s"} under ${floor} mentions into Other`);

  const itemsById = new Map(opts.items.map((i) => [i.id, i]));
  const examples = (s: LabelStat): string[] =>
    s.itemIds
      .slice(0, 3)
      .map((id) => itemsById.get(id)?.text ?? "")
      .filter(Boolean)
      .map((t) => (t.length > 220 ? `${t.slice(0, 217)}…` : t));

  let decision: ConsolidationDecision = { merges: [], themes: [] };
  if (taxonomyStats.length + shownRaw.length > 0) {
    const { output } = await opts.llm.parse({
      model: opts.model,
      system: CLUSTER_SYSTEM,
      user: buildClusterUser({ context: opts.context, taxonomyStats, rawStats: shownRaw, examples }),
      schema: consolidationSchema,
      purpose: "cluster",
      maxTokens: 8192,
    });
    decision = output;
  }

  const applied = applyDecision({ taxonomy, stats, folded }, decision);
  applied.merges.forEach((m, i) => {
    timeline.emit({ type: "merge", fromId: m.fromId, intoId: m.intoId, similarity: m.similarity });
    timeline.log(
      `Merged '${m.fromLabel}' into '${m.intoLabel}' (${m.similarity.toFixed(2)}${i === 0 ? " similarity" : ""})`,
    );
  });
  if (applied.unplaced.length > 0) {
    timeline.log(`Kept ${applied.unplaced.length} raw label${applied.unplaced.length === 1 ? "" : "s"} in Other · not enough support to stand alone`);
  }
  if (applied.droppedEmpty.length > 0) {
    timeline.log(`Dropped ${applied.droppedEmpty.length} taxonomy theme${applied.droppedEmpty.length === 1 ? "" : "s"} with no mentions`);
  }

  // Remap extraction labels to the final theme *names* so downstream code and eval speak one vocabulary.
  const labelToFinalName: Record<string, string> = {};
  const labelToThemeId: Record<string, string> = {};
  for (const d of applied.defs) {
    for (const l of d.sourceLabels) labelToFinalName[l] = d.name;
    labelToThemeId[d.name] = d.id;
  }
  const mapped = new Map<string, Extraction>();
  for (const [id, ex] of opts.extractions) mapped.set(id, applyMergeMap(ex, labelToFinalName));
  const defsByName = applied.defs.map((d) => ({ ...d, sourceLabels: [d.name] }));
  const themes = aggregateThemes({ items: opts.items, extractions: mapped, defs: defsByName });

  timeline.log(`${themes.length} themes final · names and descriptions written`);
  for (const t of themes) {
    timeline.emit({
      type: "theme",
      themeId: t.id,
      name: t.name,
      short: t.short,
      count: t.count,
      sentiment: t.sentiment,
      severityAvg: t.severityAvg,
      ...(t.other ? { other: true } : {}),
    });
  }

  return { themes, defs: applied.defs, mergeMap: labelToFinalName, merges: applied.merges, extractions: mapped, labelToThemeId };
}
