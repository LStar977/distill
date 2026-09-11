import { z } from "zod";
import type { Brief, EvalResult, Item, Opportunity, RunContext, RunStats, Theme } from "../lib/types";
import { countWords, fmtInt, fmtPct, fmtUsd } from "../lib/text";
import type { LLM } from "./client";
import type { ModelChoice } from "./models";
import { BRIEF_SYSTEM } from "./prompts/brief";
import { renderContext } from "./taxonomy";

export const briefSchema = z.object({ markdown: z.string() });

export const CITATION_RE = /\[item:([^\]\s]+)\]/g;

export function extractCitations(markdown: string): string[] {
  return Array.from(markdown.matchAll(CITATION_RE), (m) => m[1] as string);
}

/** Remove citation markers whose ids are not known; returns the cleaned markdown and counts. */
export function validateCitations(markdown: string, knownIds: ReadonlySet<string>): { markdown: string; citations: number; unresolved: number } {
  let citations = 0;
  let unresolved = 0;
  const cleaned = markdown.replace(CITATION_RE, (whole, id: string) => {
    if (knownIds.has(id)) {
      citations++;
      return whole;
    }
    unresolved++;
    return "";
  });
  return { markdown: cleaned.replace(/[ \t]+([.,;:)])/g, "$1"), citations, unresolved };
}

export function trendWord(trend: readonly number[]): string {
  const n = trend.length;
  const total = trend.reduce((a, b) => a + b, 0);
  if (n < 2 || total === 0) return "flat";
  const lastTwo = (trend[n - 1] ?? 0) + (trend[n - 2] ?? 0);
  if (total >= 10 && lastTwo / total > 0.5) return "spiking";
  const half = Math.floor(n / 2);
  const first = trend.slice(0, half).reduce((a, b) => a + b, 0);
  const last = trend.slice(n - half).reduce((a, b) => a + b, 0);
  if (last > first * 1.25) return "rising";
  if (last < first * 0.8) return "falling";
  return "flat";
}

/** Code-generated appendix used when the model leaves it out. */
export function renderAppendix(opportunities: readonly Opportunity[], items: ReadonlyMap<string, Item>): string {
  const lines: string[] = ["## Evidence appendix", ""];
  const seen = new Set<string>();
  for (const o of opportunities) {
    for (const e of o.evidence) {
      if (seen.has(e.itemId)) continue;
      seen.add(e.itemId);
      const it = items.get(e.itemId);
      const meta = it ? [it.source, it.rating !== undefined ? `${it.rating}★` : null, it.date ?? null].filter(Boolean).join(" · ") : "";
      lines.push(`- [item:${e.itemId}] ${meta ? `${meta} — ` : ""}"${e.quote}"`);
    }
  }
  return lines.join("\n");
}

export interface BriefInput {
  context: RunContext;
  themes: readonly Theme[];
  opportunities: readonly Opportunity[];
  items: ReadonlyMap<string, Item>;
  stats: Pick<RunStats, "items" | "tokensIn" | "tokensOut" | "costUsd" | "cacheHitRate">;
  models: ModelChoice;
  batches: number;
  taxonomySize: number;
  mergeCount: number;
  evalResult?: EvalResult;
  datasetName: string;
}

export function buildBriefUser(input: BriefInput): string {
  const themeRows = input.themes.map(
    (t) =>
      `| ${t.name} | ${fmtInt(t.count)} | ${(t.share * 100).toFixed(1)}% | ${t.sentiment} | ${t.severityAvg.toFixed(1)} | ${trendWord(t.trend)} |`,
  );
  const opps = input.opportunities.map((o) => {
    const ev = o.evidence.map((e) => {
      const it = input.items.get(e.itemId);
      const meta = it ? [it.source, it.rating !== undefined ? `${it.rating}★` : null, it.date ?? null].filter(Boolean).join(" · ") : "";
      return `    - [item:${e.itemId}] ${meta} — "${e.quote}"`;
    });
    return [
      `### ${o.rank}. ${o.title} — score ${o.score}`,
      `Problem: ${o.problem}`,
      `Direction: ${o.direction}`,
      `Factors: ${o.factors.map((f) => `${f.name} ${f.value.toFixed(2)} (${f.note})`).join("; ")}`,
      `Confidence: ${o.confidence} · effort ${o.effort} · impact ${o.impact}`,
      `Validate: ${o.validate.join(" / ")}`,
      `Evidence:`,
      ...ev,
    ].join("\n");
  });
  const evalLine = input.evalResult
    ? `Eval against ${input.evalResult.n}-item golden set: theme precision ${input.evalResult.themePrecision.toFixed(2)}, recall ${input.evalResult.themeRecall.toFixed(2)}, sentiment accuracy ${input.evalResult.sentimentAccuracy.toFixed(2)}.`
    : "No golden set for this dataset; eval not run.";
  return [
    renderContext(input.context),
    "",
    `Dataset: ${input.datasetName} · ${fmtInt(input.stats.items)} items · ${input.batches} extraction batches`,
    `Models: extraction ${input.models.extract}, synthesis ${input.models.synth} · taxonomy ${input.taxonomySize} themes + other · ${input.mergeCount} merges in consolidation`,
    `Usage so far: ${fmtInt(input.stats.tokensIn)} tokens in, ${fmtInt(input.stats.tokensOut)} out, ${fmtUsd(input.stats.costUsd)}, cache hit rate ${fmtPct(input.stats.cacheHitRate)}`,
    evalLine,
    "",
    "Themes:",
    "| Theme | Mentions | Share | Sentiment | Avg. severity | Trend |",
    "|---|---|---|---|---|---|",
    ...themeRows,
    "",
    `Opportunities (${input.opportunities.length}):`,
    ...opps,
  ].join("\n");
}

export interface BriefOptions extends BriefInput {
  llm: LLM;
  model: string;
}

export interface BriefResult {
  brief: Brief;
  citations: number;
  unresolved: number;
}

export async function writeBrief(opts: BriefOptions): Promise<BriefResult> {
  const { output } = await opts.llm.parse({
    model: opts.model,
    system: BRIEF_SYSTEM,
    user: buildBriefUser(opts),
    schema: briefSchema,
    purpose: "brief",
    maxTokens: 8192,
  });
  const known = new Set<string>();
  for (const o of opts.opportunities) for (const e of o.evidence) known.add(e.itemId);
  let markdown = output.markdown.trim();
  if (!/^##\s+Evidence appendix/im.test(markdown)) {
    markdown = `${markdown}\n\n${renderAppendix(opts.opportunities, opts.items)}`;
  }
  const validated = validateCitations(markdown, known);
  return {
    brief: { markdown: validated.markdown, wordCount: countWords(validated.markdown) },
    citations: validated.citations,
    unresolved: validated.unresolved,
  };
}
