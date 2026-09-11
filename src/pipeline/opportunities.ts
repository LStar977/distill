import { z } from "zod";
import type { Evidence, Extraction, Item, Opportunity, RunContext, Theme } from "../lib/types";
import { findSpan, fmtInt } from "../lib/text";
import type { LLM } from "./client";
import type { Timeline } from "./events";
import { OPPORTUNITY_SYSTEM } from "./prompts/opportunities";
import type { RankedTheme } from "./rank";
import { renderContext } from "./taxonomy";

export const MIN_EVIDENCE = 5;
export const MAX_EVIDENCE = 8;
export const CANDIDATES_PER_THEME = 30;

const TSHIRT = ["S", "M", "L", "XL"] as const;
const CONFIDENCE = ["High", "Medium", "Low"] as const;

export const opportunitySchema = z.object({
  title: z.string(),
  problem: z.string(),
  direction: z.string(),
  validate: z.array(z.string()).describe("2 to 3 items"),
  effort: z.enum(TSHIRT),
  impact: z.enum(TSHIRT),
  confidence: z.enum(CONFIDENCE),
  evidence: z.array(z.object({ itemId: z.string(), quote: z.string() })).describe("5 to 8 items"),
});
export type OpportunityDraft = z.infer<typeof opportunitySchema>;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export interface Candidate {
  item: Item;
  extraction: Extraction;
}

/** Items carrying the theme, highest severity first (ties: longer quote, then id). */
export function candidatesFor(theme: Theme, items: ReadonlyMap<string, Item>, extractions: ReadonlyMap<string, Extraction>, limit = CANDIDATES_PER_THEME): Candidate[] {
  const out: Candidate[] = [];
  for (const ex of extractions.values()) {
    if (!ex.themes.includes(theme.name)) continue;
    const item = items.get(ex.itemId);
    if (item) out.push({ item, extraction: ex });
  }
  out.sort(
    (a, b) =>
      b.extraction.severity - a.extraction.severity ||
      (b.extraction.quotes[0]?.text.length ?? 0) - (a.extraction.quotes[0]?.text.length ?? 0) ||
      (a.item.id < b.item.id ? -1 : 1),
  );
  return out.slice(0, limit);
}

/** Build {pre, quote, post} for a quote that is verified to sit inside the item text. */
export function evidenceFor(item: Item, quote: string): Evidence | null {
  const span = findSpan(item.text, quote);
  if (!span || span.text.trim().length < 3) return null;
  return { itemId: item.id, pre: item.text.slice(0, span.start), quote: span.text, post: item.text.slice(span.end) };
}

/**
 * Validate the model's picks: the id must be one of the candidates and the
 * quote a real substring. Failures are dropped; the list is topped up from the
 * candidates' own validated spans to reach MIN_EVIDENCE and capped at MAX_EVIDENCE.
 */
export function resolveEvidence(picks: readonly { itemId: string; quote: string }[], candidates: readonly Candidate[]): { evidence: Evidence[]; dropped: number } {
  const byId = new Map(candidates.map((c) => [c.item.id, c]));
  const evidence: Evidence[] = [];
  const used = new Set<string>();
  let dropped = 0;
  for (const p of picks) {
    if (evidence.length >= MAX_EVIDENCE) break;
    const c = byId.get(p.itemId);
    if (!c || used.has(p.itemId)) {
      dropped++;
      continue;
    }
    const ev = evidenceFor(c.item, p.quote);
    if (!ev) {
      dropped++;
      continue;
    }
    used.add(p.itemId);
    evidence.push(ev);
  }
  for (const c of candidates) {
    if (evidence.length >= MIN_EVIDENCE) break;
    if (used.has(c.item.id)) continue;
    const quote = c.extraction.quotes[0]?.text;
    if (!quote) continue;
    const ev = evidenceFor(c.item, quote);
    if (!ev) continue;
    used.add(c.item.id);
    evidence.push(ev);
  }
  return { evidence, dropped };
}

/** Top segments among the theme's items, share = % of theme items naming that segment. */
export function computeSegments(theme: Theme, items: ReadonlyMap<string, Item>, extractions: ReadonlyMap<string, Extraction>, max = 3): { name: string; share: number }[] {
  const counts = new Map<string, number>();
  let total = 0;
  for (const ex of extractions.values()) {
    if (!ex.themes.includes(theme.name)) continue;
    total++;
    const segs = ex.segments.length > 0 ? ex.segments : items.get(ex.itemId)?.segment ? [items.get(ex.itemId)?.segment as string] : [];
    for (const raw of new Set(segs.map((s) => s.trim()).filter(Boolean))) {
      const name = raw.charAt(0).toUpperCase() + raw.slice(1);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  if (total === 0) return [];
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, max)
    .map(([name, n]) => ({ name, share: Math.round((n / total) * 100) }));
}

/** Other themes that co-occur on this theme's items, by overlap share (≥ 3%), top 3. */
export function relatedThemes(theme: Theme, themes: readonly Theme[], extractions: ReadonlyMap<string, Extraction>, max = 3): string[] {
  const idByName = new Map(themes.map((t) => [t.name, t.id]));
  const counts = new Map<string, number>();
  let total = 0;
  for (const ex of extractions.values()) {
    if (!ex.themes.includes(theme.name)) continue;
    total++;
    for (const other of ex.themes) {
      if (other === theme.name) continue;
      const id = idByName.get(other);
      if (!id || id === "other") continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  if (total === 0) return [];
  return Array.from(counts.entries())
    .filter(([, n]) => n / total >= 0.03)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, max)
    .map(([id]) => id);
}

export function sharePct(theme: Theme): string {
  return `${(theme.share * 100).toFixed(1)}%`;
}

/** The problem statement must carry the count and share; append them when the model left them out. */
export function ensureProblemNumbers(problem: string, theme: Theme): string {
  const count = fmtInt(theme.count);
  const share = sharePct(theme);
  const hasCount = problem.includes(count) || problem.includes(String(theme.count));
  const hasShare = problem.includes(share) || problem.includes(`${Math.round(theme.share * 100)}%`);
  if (hasCount && hasShare) return problem.trim();
  const trimmed = problem.trim().replace(/\s+$/, "");
  return `${trimmed}${/[.!?]$/.test(trimmed) ? "" : "."} ${count} reviews (${share}) mention it.`;
}

export function buildOpportunityUser(input: {
  context: RunContext;
  ranked: RankedTheme;
  candidates: readonly Candidate[];
  segments: readonly { name: string; share: number }[];
  related: readonly Theme[];
  totalItems: number;
}): string {
  const { theme, score, factors } = input.ranked;
  const factorLines = factors.map((f) => `- ${f.name}: ${f.value.toFixed(2)} · ${f.note}`);
  const cands = input.candidates.map((c) => {
    const bits = [c.item.id, c.item.source];
    if (c.item.rating !== undefined) bits.push(`${c.item.rating}★`);
    if (c.item.date) bits.push(c.item.date);
    bits.push(`severity ${c.extraction.severity}`, c.extraction.sentiment);
    const spans = c.extraction.quotes.map((q) => `"${q.text}"`).join(" | ");
    return `[${bits.join(" · ")}]\n${c.item.text}\n  spans: ${spans}`;
  });
  return [
    renderContext(input.context),
    "",
    `Theme: "${theme.name}" (id ${theme.id})`,
    theme.description,
    `Mentions: ${fmtInt(theme.count)} of ${fmtInt(input.totalItems)} items (${sharePct(theme)}) · sentiment ${theme.sentiment} · split positive/neutral/negative ${theme.sentimentSplit.join("/")} · average severity ${theme.severityAvg.toFixed(1)} / 5`,
    `Trend (oldest → newest buckets): ${theme.trend.join(", ")}`,
    `Score: ${score}`,
    ...factorLines,
    input.segments.length ? `Segments (share of this theme's items): ${input.segments.map((s) => `${s.name} ${s.share}%`).join(", ")}` : "Segments: none identified",
    input.related.length ? `Related themes: ${input.related.map((r) => `"${r.name}" (${r.count})`).join(", ")}` : "Related themes: none",
    "",
    `Candidate evidence (${cands.length} items, highest severity first):`,
    ...cands,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// LLM call + orchestration
// ---------------------------------------------------------------------------

export interface OpportunityOptions {
  ranked: readonly RankedTheme[];
  themes: readonly Theme[];
  items: ReadonlyMap<string, Item>;
  extractions: ReadonlyMap<string, Extraction>;
  context: RunContext;
  llm: LLM;
  model: string;
  timeline: Timeline;
  concurrency?: number;
}

export async function writeOpportunities(opts: OpportunityOptions): Promise<Opportunity[]> {
  const themesById = new Map(opts.themes.map((t) => [t.id, t]));
  const totalItems = opts.items.size;

  const writeOne = async (r: RankedTheme, index: number): Promise<Opportunity> => {
    const candidates = candidatesFor(r.theme, opts.items, opts.extractions);
    const segments = computeSegments(r.theme, opts.items, opts.extractions);
    const relatedIds = relatedThemes(r.theme, opts.themes, opts.extractions);
    const related = relatedIds.map((id) => themesById.get(id)).filter((t): t is Theme => t !== undefined);
    const { output } = await opts.llm.parse({
      model: opts.model,
      system: OPPORTUNITY_SYSTEM,
      user: buildOpportunityUser({ context: opts.context, ranked: r, candidates, segments, related, totalItems }),
      schema: opportunitySchema,
      purpose: "opportunity",
      maxTokens: 4096,
    });
    const { evidence, dropped } = resolveEvidence(output.evidence, candidates);
    if (dropped > 0) opts.timeline.log(`Dropped ${dropped} evidence pick${dropped === 1 ? "" : "s"} for '${r.theme.short}' · quote not found in source`);
    return {
      id: `opp-${index + 1}`,
      rank: index + 1,
      title: output.title.trim(),
      problem: ensureProblemNumbers(output.problem, r.theme),
      score: r.score,
      factors: r.factors,
      confidence: output.confidence,
      segments,
      evidence,
      direction: output.direction.trim(),
      validate: output.validate.map((v) => v.trim()).filter(Boolean).slice(0, 3),
      effort: output.effort,
      impact: output.impact,
      themeIds: [r.theme.id],
      relatedThemeIds: relatedIds,
    };
  };

  const concurrency = Math.max(1, opts.concurrency ?? 3);
  const results: Opportunity[] = new Array(opts.ranked.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < opts.ranked.length) {
      const i = cursor++;
      results[i] = await writeOne(opts.ranked[i] as RankedTheme, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, opts.ranked.length) }, () => worker()));
  return results;
}
