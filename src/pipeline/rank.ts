import type { OpportunityFactor, Theme } from "../lib/types";
import { fmtInt } from "../lib/text";

/** Opportunity score threshold (0–100) and cap. */
export const SCORE_THRESHOLD = 55;
export const MAX_OPPORTUNITIES = 6;
export const DEFAULT_FIT = 0.7;
export const DEFAULT_FIT_NOTE = "no product context provided";

/** Weights of the weighted sum; they add to 1. */
export const WEIGHTS = { frequency: 0.35, severity: 0.3, recency: 0.15, fit: 0.2 } as const;

export interface FitJudgment {
  /** 0–1. */
  value: number;
  note: string;
}

export interface RankedTheme {
  theme: Theme;
  score: number;
  factors: OpportunityFactor[];
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Recency from the trend: least-squares slope of the mention counts (in units
 * of the mean per bucket) mapped so flat = 0.5, doubling across the window ≈ 1.
 */
export function recencyOf(trend: readonly number[]): number {
  const n = trend.length;
  const total = trend.reduce((a, b) => a + b, 0);
  if (n < 2 || total === 0) return 0.5;
  const mean = total / n;
  const xMean = (n - 1) / 2;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * ((trend[i] ?? 0) / mean - 1);
    den += (i - xMean) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const change = slope * (n - 1);
  return round2(clamp01(0.5 + change / 3));
}

/** Human note for the recency factor, in the handoff's voice. */
export function recencyNote(trend: readonly number[], count: number, months: number, periodLabel = "months"): string {
  const n = trend.length;
  const total = trend.reduce((a, b) => a + b, 0);
  if (n < 2 || total === 0) return "no dated mentions";
  const lastTwo = (trend[n - 1] ?? 0) + (trend[n - 2] ?? 0);
  if (total >= 10 && lastTwo / total > 0.5) return `spiking in the last 2 ${periodLabel}`;
  const window = Math.min(4, n - 1);
  let rising = 0;
  for (let i = n - window; i < n; i++) if ((trend[i] ?? 0) > (trend[i - 1] ?? 0)) rising++;
  const recency = recencyOf(trend);
  if (rising >= 3) return `rising in ${rising} of the last ${window} ${periodLabel}`;
  if (recency >= 0.75) return "rising steadily";
  if (recency >= 0.55) return "rising slowly";
  if (recency <= 0.45) return rising === 0 ? "falling" : "falling slowly";
  return count >= 100 && months > 0 ? `steady over ${months} ${periodLabel}` : "flat";
}

export interface ScoreInput {
  theme: Theme;
  /** Count of the most-mentioned non-Other theme. */
  topCount: number;
  /** 1-based rank among all themes by count. */
  rank: number;
  totalThemes: number;
  fit?: FitJudgment;
  /** Months the dataset spans; only used for the recency note. */
  months?: number;
}

/** Score one theme. Pure. */
export function scoreTheme(input: ScoreInput): RankedTheme {
  const { theme } = input;
  const frequency = input.topCount > 0 ? clamp01(theme.count / input.topCount) : 0;
  const severity = clamp01(theme.severityAvg / 5);
  const recency = recencyOf(theme.trend);
  const fit = input.fit ?? { value: DEFAULT_FIT, note: DEFAULT_FIT_NOTE };
  const fitValue = clamp01(fit.value);
  const score = Math.round(
    100 * (WEIGHTS.frequency * frequency + WEIGHTS.severity * severity + WEIGHTS.recency * recency + WEIGHTS.fit * fitValue),
  );
  const factors: OpportunityFactor[] = [
    { name: "Frequency", value: round2(frequency), note: `${fmtInt(theme.count)} mentions · ranked #${input.rank} of ${input.totalThemes}` },
    { name: "Severity", value: round2(severity), note: `avg. ${theme.severityAvg.toFixed(1)} / 5` },
    { name: "Recency", value: recency, note: recencyNote(theme.trend, theme.count, input.months ?? 0) },
    { name: "Strategic fit", value: round2(fitValue), note: fit.note },
  ];
  return { theme, score, factors };
}

export function isEligible(theme: Theme): boolean {
  return !theme.other && theme.sentiment !== "positive" && theme.count > 0;
}

export interface RankOptions {
  fits?: ReadonlyMap<string, FitJudgment>;
  threshold?: number;
  max?: number;
  months?: number;
}

/**
 * Score every theme, keep eligible ones at or above the threshold, sort by
 * score (ties: count), cap. Positive themes and Other never qualify.
 */
export function rankOpportunities(themes: readonly Theme[], opts: RankOptions = {}): { ranked: RankedTheme[]; scored: RankedTheme[] } {
  const threshold = opts.threshold ?? SCORE_THRESHOLD;
  const max = opts.max ?? MAX_OPPORTUNITIES;
  const byCount = themes
    .filter((t) => !t.other)
    .slice()
    .sort((a, b) => b.count - a.count);
  const topCount = byCount[0]?.count ?? 0;
  const rankOf = new Map(byCount.map((t, i) => [t.id, i + 1]));
  const scored = themes.map((theme) =>
    scoreTheme({
      theme,
      topCount,
      rank: rankOf.get(theme.id) ?? themes.length,
      totalThemes: themes.length,
      fit: opts.fits?.get(theme.id),
      months: opts.months,
    }),
  );
  const ranked = scored
    .filter((r) => isEligible(r.theme) && r.score >= threshold)
    .sort((a, b) => b.score - a.score || b.theme.count - a.theme.count)
    .slice(0, max);
  return { ranked, scored };
}
