"use client";

import { fmt } from "@/lib/format";
import type { LiveState } from "@/lib/replay";
import { STAGES } from "@/lib/types";

export function StageRail({ state, totalItems, running }: { state: LiveState; totalItems: number; running: boolean }) {
  const rawThemes = [...state.themes.values()].filter((t) => t.count > 0 && t.mergedAt === undefined).length;
  const sub = (key: (typeof STAGES)[number]["key"], status: string, note?: string) => {
    if (status === "done") return note ?? "done";
    switch (key) {
      case "ingest":
        return status === "running" ? "parsing · normalizing…" : `${fmt(totalItems)} items`;
      case "extract":
        if (status !== "running") return "batches of 20";
        return state.processed < 1
          ? "first batches in flight…"
          : `${fmt(state.processed)} / ${fmt(totalItems)} · batch ${state.batch} / ${state.totalBatches}`;
      case "cluster":
        return status === "running" ? `consolidating ${rawThemes} raw themes` : "awaiting extraction";
      case "rank":
        return status === "running" ? `scoring ${rawThemes} themes…` : "freq × sev × recency × fit";
      case "brief":
        return status === "running" ? "writing · citing item IDs…" : "with citations";
    }
  };

  return (
    <>
      {STAGES.map((s, i) => {
        const st = state.stages[s.key];
        const status = st.status;
        const fill = status === "done" ? "var(--positive)" : status === "running" ? "var(--signal)" : "none";
        const subColor = status === "running" ? "var(--signal)" : status === "done" ? "var(--instrument-ink-dim)" : "var(--ink-faint)";
        return (
          <div key={s.key} className="flex min-w-0 flex-1 items-center">
            <div className="flex flex-none items-center gap-2.5">
              <svg width="18" height="18" className="block flex-none overflow-visible">
                {status === "running" && running && <circle cx="9" cy="9" r="6" fill={fill} className="anim-pulse-ring" />}
                <circle cx="9" cy="9" r="6" fill={fill} stroke={status === "queued" ? "var(--instrument-queued)" : "none"} strokeWidth="1.5" />
              </svg>
              <div className="flex flex-col gap-0.5">
                <div className="flex items-baseline gap-2">
                  <span className="eyebrow-instrument">{s.index}</span>
                  <span className="text-[13px] font-medium text-instrument-ink-bright">{s.label}</span>
                </div>
                <span className="tnum whitespace-nowrap font-mono text-[11px]" style={{ color: subColor }}>
                  {sub(s.key, status, st.note)}
                </span>
              </div>
            </div>
            <div
              className="mx-4 h-px min-w-3 flex-1"
              style={{ background: i === STAGES.length - 1 ? "transparent" : status === "done" ? "var(--positive)" : "var(--instrument-line)" }}
            />
          </div>
        );
      })}
    </>
  );
}
