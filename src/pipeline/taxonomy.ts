import { z } from "zod";
import type { Item, RunContext } from "../lib/types";
import { sample } from "../lib/prng";
import { slugify, normalizeLabel } from "../lib/text";
import type { LLM } from "./client";
import { TAXONOMY_SYSTEM } from "./prompts/taxonomy";

export const OTHER_LABEL = "Other / uncategorized";
export const OTHER_ID = "other";

export interface TaxonomyTheme {
  id: string;
  name: string;
  short: string;
  description: string;
  other?: boolean;
}

export interface Taxonomy {
  themes: TaxonomyTheme[];
}

export const taxonomySchema = z.object({
  themes: z
    .array(
      z.object({
        name: z.string().describe("Sentence-case declarative phrase, 3-7 words"),
        short: z.string().describe("1-3 word map label"),
        description: z.string().describe("One line, < 140 chars"),
      }),
    )
    .describe("8 to 12 themes, most frequent first"),
});

export type TaxonomyDraft = z.infer<typeof taxonomySchema>;

export const TAXONOMY_SAMPLE_SIZE = 200;

/** Seeded sample used for the taxonomy draft. Items are sampled by id order so reruns see the same items. */
export function sampleForTaxonomy(items: readonly Item[], n = TAXONOMY_SAMPLE_SIZE, seed = "taxonomy"): Item[] {
  const sorted = items.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return sample(sorted, n, seed);
}

export function renderContext(context: RunContext): string {
  const lines = [`Product: ${context.product.trim() || "(not provided)"}`];
  if (context.decision?.trim()) lines.push(`Decision being made: ${context.decision.trim()}`);
  return lines.join("\n");
}

export function buildTaxonomyUser(context: RunContext, items: readonly Item[]): string {
  const rows = items.map((it) => {
    const bits = [it.source];
    if (it.rating !== undefined) bits.push(`${it.rating}★`);
    if (it.date) bits.push(it.date);
    return `- [${bits.join(" · ")}] ${it.text}`;
  });
  return `${renderContext(context)}\n\nSample of ${items.length} items:\n${rows.join("\n")}`;
}

export function themeIdFor(name: string, taken: Set<string>): string {
  const base = slugify(name, 40) || "theme";
  let id = base;
  let n = 2;
  while (taken.has(id) || id === OTHER_ID) id = `${base}-${n++}`;
  taken.add(id);
  return id;
}

/** Turn a draft into a Taxonomy: dedupe by normalized name, cap at 12, append Other. */
export function finalizeTaxonomy(draft: TaxonomyDraft): Taxonomy {
  const taken = new Set<string>();
  const seenNames = new Set<string>();
  const themes: TaxonomyTheme[] = [];
  for (const t of draft.themes) {
    const name = t.name.trim();
    const key = normalizeLabel(name);
    if (!name || seenNames.has(key) || key === normalizeLabel(OTHER_LABEL)) continue;
    seenNames.add(key);
    themes.push({
      id: themeIdFor(name, taken),
      name,
      short: (t.short.trim() || name.split(/\s+/).slice(0, 2).join(" ")).slice(0, 24),
      description: t.description.trim().slice(0, 200),
    });
    if (themes.length >= 12) break;
  }
  themes.push({ id: OTHER_ID, name: OTHER_LABEL, short: "Other", description: "Feedback that did not fit a theme with enough support.", other: true });
  return { themes };
}

export interface DraftTaxonomyOptions {
  items: readonly Item[];
  context: RunContext;
  llm: LLM;
  model: string;
  sampleSize?: number;
}

export async function draftTaxonomy(opts: DraftTaxonomyOptions): Promise<{ taxonomy: Taxonomy; sampleSize: number }> {
  const sampled = sampleForTaxonomy(opts.items, opts.sampleSize ?? TAXONOMY_SAMPLE_SIZE);
  const { output } = await opts.llm.parse({
    model: opts.model,
    system: TAXONOMY_SYSTEM,
    user: buildTaxonomyUser(opts.context, sampled),
    schema: taxonomySchema,
    purpose: "taxonomy",
    maxTokens: 8192,
    reasoning: "medium",
  });
  return { taxonomy: finalizeTaxonomy(output), sampleSize: sampled.length };
}

/** Lookup from normalized label → taxonomy theme (names and shorts both resolve). */
export function taxonomyIndex(taxonomy: Taxonomy): Map<string, TaxonomyTheme> {
  const idx = new Map<string, TaxonomyTheme>();
  for (const t of taxonomy.themes) {
    idx.set(normalizeLabel(t.name), t);
    idx.set(normalizeLabel(t.short), t);
    idx.set(t.id, t);
  }
  idx.set("other", taxonomy.themes.find((t) => t.other) as TaxonomyTheme);
  return idx;
}
