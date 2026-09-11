/**
 * Shared domain types for Distill.
 *
 * A pre-computed run file (data/runs/<id>.json) is a `RunFile`: the final
 * `Run` plus the ordered `PipelineEvent` timeline the live-run screen replays.
 * A live run streams the same events over SSE and ends with the same `Run`.
 */

export type Sentiment = "positive" | "negative" | "neutral" | "mixed";
export type Severity = 1 | 2 | 3 | 4 | 5;
export type Depth = "fast" | "thorough";
export type StageName = "ingest" | "extract" | "cluster" | "rank" | "brief";
export type TShirt = "S" | "M" | "L" | "XL";
export type Confidence = "High" | "Medium" | "Low";

export const STAGES: { key: StageName; label: string; index: string }[] = [
  { key: "ingest", label: "Ingest", index: "01" },
  { key: "extract", label: "Extract", index: "02" },
  { key: "cluster", label: "Cluster", index: "03" },
  { key: "rank", label: "Rank", index: "04" },
  { key: "brief", label: "Brief", index: "05" },
];

export interface DatasetMeta {
  id: string;
  /** Eyebrow on the dataset card, e.g. "App Store reviews". */
  kind: string;
  name: string;
  /** Mono meta line, e.g. "3,214 items · 3 apps · 14 months". */
  meta: string;
  description: string;
  itemCount: number;
  sources: string[];
  /** Default product context shown in the New run form. */
  defaultContext: { product: string; decision?: string };
}

export interface Item {
  id: string;
  /** Source app / product / channel the item came from. */
  source: string;
  text: string;
  rating?: number;
  /** ISO date (YYYY-MM-DD). */
  date?: string;
  segment?: string;
}

export interface QuoteSpan {
  start: number;
  end: number;
  text: string;
}

export interface Extraction {
  itemId: string;
  sentiment: Sentiment;
  severity: Severity;
  /** Theme labels. Taxonomy labels or free text; free text gets merged in Cluster. */
  themes: string[];
  painPoints: string[];
  featureRequests: string[];
  quotes: QuoteSpan[];
  segments: string[];
}

export interface Theme {
  id: string;
  rank: number;
  name: string;
  /** Short label for the theme map node. */
  short: string;
  description: string;
  count: number;
  /** Fraction of all items, 0–1. */
  share: number;
  sentiment: Sentiment;
  /** Percentages [positive, neutral, negative], summing to 100. */
  sentimentSplit: [number, number, number];
  severityAvg: number;
  /** Mentions per time bucket, oldest first. */
  trend: number[];
  exampleItemIds: string[];
  opportunityId?: string;
  /** The catch-all bucket. Drawn hollow on the map. */
  other?: boolean;
}

export interface Evidence {
  itemId: string;
  /** Text before the quoted span, the span itself, and the text after. */
  pre: string;
  quote: string;
  post: string;
}

export interface OpportunityFactor {
  name: "Frequency" | "Severity" | "Recency" | "Strategic fit";
  /** 0–1. */
  value: number;
  note: string;
}

export interface Opportunity {
  id: string;
  rank: number;
  title: string;
  problem: string;
  /** 0–100. */
  score: number;
  factors: OpportunityFactor[];
  confidence: Confidence;
  segments: { name: string; share: number }[];
  evidence: Evidence[];
  direction: string;
  validate: string[];
  effort: TShirt;
  impact: TShirt;
  themeIds: string[];
  relatedThemeIds: string[];
}

export interface Brief {
  markdown: string;
  wordCount: number;
}

export interface RunStats {
  items: number;
  themes: number;
  opportunities: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  /** 0–1. */
  cacheHitRate: number;
  durationMs: number;
  stageDurationsMs: Record<StageName, number>;
}

export interface EvalResult {
  n: number;
  themePrecision: number;
  themeRecall: number;
  sentimentAccuracy: number;
}

export interface RunContext {
  product: string;
  decision?: string;
}

export interface RunSettings {
  depth: Depth;
  cap: number;
}

export interface Run {
  id: string;
  number: number;
  datasetId: string;
  datasetName: string;
  sources: string[];
  context: RunContext;
  settings: RunSettings;
  status: "queued" | "running" | "done" | "failed";
  startedAt: string;
  finishedAt?: string;
  stats: RunStats;
  eval?: EvalResult;
  themes: Theme[];
  opportunities: Opportunity[];
  brief?: Brief;
  /** Items referenced by evidence and examples. Full datasets live in data/datasets. */
  items: Record<string, Item>;
  /** Extractions for the referenced items, keyed by item id. */
  extractions: Record<string, Extraction>;
  demo?: boolean;
}

/** One representative row shown in the extraction stream per batch. */
export interface StreamRow {
  batch: number;
  itemId: string;
  extraction: Extraction;
}

export type PipelineEvent = { t: number } & (
  | { type: "stage"; stage: StageName; status: "running" | "done"; note?: string }
  | { type: "batch"; batch: number; totalBatches: number; processed: number; row: StreamRow }
  | {
      type: "theme";
      themeId: string;
      name: string;
      short: string;
      count: number;
      sentiment: Sentiment;
      severityAvg: number;
      /** Raw label proposed outside the taxonomy; merged away in Cluster. */
      transient?: boolean;
      other?: boolean;
      parentId?: string;
    }
  | { type: "merge"; fromId: string; intoId: string; similarity: number }
  | {
      type: "counters";
      processed: number;
      tokensIn: number;
      tokensOut: number;
      costUsd: number;
      cacheHitRate: number;
    }
  | { type: "log"; message: string }
  | { type: "done" }
  | { type: "error"; message: string }
);

export interface RunFile {
  run: Run;
  events: PipelineEvent[];
}
