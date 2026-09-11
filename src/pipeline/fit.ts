import { z } from "zod";
import type { RunContext, Theme } from "../lib/types";
import type { LLM } from "./client";
import { FIT_SYSTEM } from "./prompts/fit";
import { DEFAULT_FIT, DEFAULT_FIT_NOTE, type FitJudgment } from "./rank";
import { renderContext } from "./taxonomy";

export const fitSchema = z.object({
  fits: z.array(
    z.object({
      themeId: z.string(),
      fit: z.number().describe("0 to 1"),
      note: z.string().describe("< 60 chars"),
    }),
  ),
});

export function buildFitUser(context: RunContext, themes: readonly Theme[]): string {
  const rows = themes.map(
    (t) =>
      `- id=${t.id} · "${t.name}" · ${t.count} mentions (${Math.round(t.share * 100)}%) · ${t.sentiment} · severity ${t.severityAvg.toFixed(1)}\n    ${t.description}`,
  );
  return `${renderContext(context)}\n\nThemes:\n${rows.join("\n")}`;
}

export interface FitOptions {
  themes: readonly Theme[];
  context: RunContext;
  llm: LLM;
  model: string;
}

/** Strategic fit per theme id. Falls back to 0.7 when there is no product context or the model skips a theme. */
export async function judgeStrategicFit(opts: FitOptions): Promise<Map<string, FitJudgment>> {
  const fits = new Map<string, FitJudgment>();
  const hasContext = opts.context.product.trim().length > 0;
  for (const t of opts.themes) fits.set(t.id, { value: DEFAULT_FIT, note: hasContext ? "not assessed" : DEFAULT_FIT_NOTE });
  if (!hasContext || opts.themes.length === 0) return fits;

  const { output } = await opts.llm.parse({
    model: opts.model,
    system: FIT_SYSTEM,
    user: buildFitUser(opts.context, opts.themes),
    schema: fitSchema,
    purpose: "fit",
    maxTokens: 8192,
    reasoning: "low",
  });
  const known = new Set(opts.themes.map((t) => t.id));
  for (const f of output.fits) {
    if (!known.has(f.themeId)) continue;
    const value = Math.min(1, Math.max(0, f.fit));
    const note = f.note.trim().replace(/\.$/, "").slice(0, 80) || "assessed against product context";
    fits.set(f.themeId, { value, note });
  }
  return fits;
}
