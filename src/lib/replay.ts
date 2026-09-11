/**
 * Pure reducer that folds a PipelineEvent timeline into the state the live-run
 * screen renders. Used by the client while streaming, and by anything that
 * wants to jump to a point in time (tests, screenshots, the Remotion video).
 */
import type { PipelineEvent, Sentiment, StageName, StreamRow } from "./types";
import { STAGES } from "./types";

export type StageStatus = "queued" | "running" | "done";

export interface LiveTheme {
  id: string;
  name: string;
  short: string;
  count: number;
  sentiment: Sentiment;
  severityAvg: number;
  transient: boolean;
  other: boolean;
  parentId?: string;
  /** Replay time (s) of the last count increase, for pulse rings. */
  lastHitAt: number;
  /** Set when merged away; the node drifts into `parentId` and fades. */
  mergedAt?: number;
}

export interface LogLine {
  t: number;
  message: string;
}

export interface LiveState {
  t: number;
  stages: Record<StageName, { status: StageStatus; note?: string; startedAt?: number; endedAt?: number }>;
  processed: number;
  batch: number;
  totalBatches: number;
  rows: StreamRow[]; // newest first, capped
  themes: Map<string, LiveTheme>;
  merges: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  cacheHitRate: number;
  log: LogLine[];
  done: boolean;
  error?: string;
}

export const MAX_ROWS = 8;

export function initialState(): LiveState {
  const stages = Object.fromEntries(STAGES.map((s) => [s.key, { status: "queued" as StageStatus }])) as LiveState["stages"];
  return {
    t: 0,
    stages,
    processed: 0,
    batch: 0,
    totalBatches: 0,
    rows: [],
    themes: new Map(),
    merges: 0,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    cacheHitRate: 0,
    log: [],
    done: false,
  };
}

/** Applies one event. Mutates a shallow copy so React sees a new reference. */
export function applyEvent(prev: LiveState, e: PipelineEvent): LiveState {
  const s: LiveState = { ...prev, t: Math.max(prev.t, e.t) };
  switch (e.type) {
    case "stage": {
      const cur = s.stages[e.stage];
      s.stages = {
        ...s.stages,
        [e.stage]:
          e.status === "running"
            ? { ...cur, status: "running", startedAt: e.t }
            : { ...cur, status: "done", endedAt: e.t, note: e.note ?? cur.note },
      };
      break;
    }
    case "batch": {
      s.processed = e.processed;
      s.batch = e.batch;
      s.totalBatches = e.totalBatches;
      s.rows = [e.row, ...prev.rows].slice(0, MAX_ROWS);
      break;
    }
    case "theme": {
      const themes = new Map(prev.themes);
      const existing = themes.get(e.themeId);
      const grew = !existing || e.count > existing.count;
      themes.set(e.themeId, {
        id: e.themeId,
        name: e.name,
        short: e.short,
        count: e.count,
        sentiment: e.sentiment,
        severityAvg: e.severityAvg,
        transient: e.transient ?? existing?.transient ?? false,
        other: e.other ?? existing?.other ?? false,
        parentId: e.parentId ?? existing?.parentId,
        lastHitAt: grew ? e.t : (existing?.lastHitAt ?? e.t),
        mergedAt: existing?.mergedAt,
      });
      s.themes = themes;
      break;
    }
    case "merge": {
      const themes = new Map(prev.themes);
      const from = themes.get(e.fromId);
      if (from) themes.set(e.fromId, { ...from, mergedAt: e.t, parentId: e.intoId });
      s.themes = themes;
      s.merges = prev.merges + 1;
      break;
    }
    case "counters": {
      s.processed = Math.max(s.processed, e.processed);
      s.tokensIn = e.tokensIn;
      s.tokensOut = e.tokensOut;
      s.costUsd = e.costUsd;
      s.cacheHitRate = e.cacheHitRate;
      break;
    }
    case "log":
      s.log = [...prev.log, { t: e.t, message: e.message }];
      break;
    case "done":
      s.done = true;
      break;
    case "error":
      s.error = e.message;
      break;
  }
  return s;
}

/** Folds every event with t <= at. */
export function stateAt(events: PipelineEvent[], at: number): LiveState {
  let s = initialState();
  for (const e of events) {
    if (e.t > at) break;
    s = applyEvent(s, e);
  }
  s.t = at;
  return s;
}

/** Themes currently visible on the map (merged ones linger ~1s while they drift). */
export function visibleThemes(state: LiveState, now = state.t): LiveTheme[] {
  return [...state.themes.values()].filter((t) => t.count > 0 && (t.mergedAt === undefined || now - t.mergedAt < 1));
}

/** 0 → just merged, 1 → fully gone. */
export function mergeProgress(t: LiveTheme, now: number) {
  if (t.mergedAt === undefined) return 0;
  return Math.max(0, Math.min(1, now - t.mergedAt));
}

export const rawThemeCount = (state: LiveState) =>
  [...state.themes.values()].filter((t) => t.count > 0 && t.mergedAt === undefined).length;
