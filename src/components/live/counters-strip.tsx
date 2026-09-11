"use client";

import { fmt, mmss, tok, usd } from "@/lib/format";
import type { LiveState } from "@/lib/replay";

export function CountersStrip({
  state,
  clock,
  totalItems,
  visibleThemeCount,
  lastLog,
  logOpen,
  onToggleLog,
}: {
  state: LiveState;
  clock: number;
  totalItems: number;
  visibleThemeCount: number;
  lastLog: string;
  logOpen: boolean;
  onToggleLog: () => void;
}) {
  const done = state.done;
  const counters: { k: string; v: string; u: string }[] = [
    { k: "PROCESSED", v: fmt(state.processed), u: `/ ${fmt(totalItems)}` },
    { k: "THEMES", v: String(visibleThemeCount), u: done ? "final" : "found" },
    { k: "TOKENS", v: tok(state.tokensIn), u: `in · ${tok(state.tokensOut)} out` },
    { k: "COST", v: usd(state.costUsd), u: done ? "total" : "so far" },
    { k: "ELAPSED", v: mmss(clock), u: done ? "done" : "running" },
    { k: "CACHE", v: `${Math.round(state.cacheHitRate * 100)}%`, u: "hit rate" },
  ];
  return (
    <div className="flex h-[60px] flex-none items-stretch border-t border-instrument-line bg-instrument-deep">
      {counters.map((c) => (
        <div key={c.k} className="flex min-w-0 flex-1 flex-col justify-center gap-1 border-r border-instrument-line px-5">
          <span className="eyebrow-instrument">{c.k}</span>
          <span className="tnum whitespace-nowrap font-mono text-[18px] font-medium leading-none text-instrument-ink-bright">
            {c.v} <span className="text-[11px] font-normal text-ink-dim">{c.u}</span>
          </span>
        </div>
      ))}
      <button
        type="button"
        onClick={onToggleLog}
        className="flex w-[380px] min-w-0 flex-none cursor-pointer items-center gap-2.5 border-0 bg-transparent px-5 text-left font-mono text-[11px] text-instrument-ink-soft transition-colors hover:bg-instrument-row"
      >
        <svg width="8" height="8" className="block flex-none">
          <circle cx="4" cy="4" r="3" fill="var(--signal)" className={done ? "" : "anim-blink"} />
        </svg>
        <span className="min-w-0 flex-1 truncate">{lastLog}</span>
        <span className="flex-none text-instrument-ink-dim">{logOpen ? "▾ hide" : "▴ log"}</span>
      </button>
    </div>
  );
}
