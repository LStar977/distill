"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { mmss, pad3 } from "@/lib/format";
import { applyEvent, initialState, stateAt, visibleThemes, type LiveState } from "@/lib/replay";
import type { PipelineEvent, Run } from "@/lib/types";
import { AgentLog } from "./agent-log";
import { Constellation } from "./constellation";
import { CountersStrip } from "./counters-strip";
import { ExtractionStream } from "./extraction-stream";
import { StageRail } from "./stage-rail";

const SPEEDS = [1, 2, 4] as const;

export function LiveRun({
  run,
  initialAt = 0,
  initialSpeed = 1,
  paused = false,
  initialEvents,
}: {
  run: Run;
  initialAt?: number;
  initialSpeed?: number;
  paused?: boolean;
  /** Provided when rendering a static frame (paused); avoids opening a stream. */
  initialEvents?: PipelineEvent[];
}) {
  const [speed, setSpeed] = useState(initialSpeed);
  const [state, setState] = useState<LiveState>(() => (paused && initialEvents ? stateAt(initialEvents, initialAt) : initialState()));
  const [clock, setClock] = useState(initialAt);
  const [logOpen, setLogOpen] = useState(false);
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const [reconnectKey, setReconnectKey] = useState(0);
  const fromRef = useRef(initialAt);
  const doneRef = useRef(state.done);
  useEffect(() => {
    doneRef.current = state.done;
  }, [state.done]);

  const totalItems = run.stats.items;
  const finalT = useMemo(() => Math.max(run.stats.durationMs / 1000, 41), [run]);

  // Stream events from the server; it paces them by `t` / speed.
  useEffect(() => {
    if (paused) return;
    const from = fromRef.current;
    const es = new EventSource(`/api/runs/${run.id}/stream?speed=${speed}&from=${from}`);
    const startWall = performance.now();
    let raf = 0;
    const tick = () => {
      const t = Math.min(finalT, from + ((performance.now() - startWall) / 1000) * speed);
      setClock(t);
      if (!doneRef.current) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const freshTimers: ReturnType<typeof setTimeout>[] = [];
    es.onmessage = (msg) => {
      const e = JSON.parse(msg.data) as PipelineEvent | { type: "hello" };
      if (e.type === "hello") return;
      setState((prev) => applyEvent(prev, e));
      if (e.type === "batch") {
        setFresh((prev) => new Set(prev).add(e.batch));
        freshTimers.push(setTimeout(() => setFresh((prev) => { const n = new Set(prev); n.delete(e.batch); return n; }), 250 / speed));
      }
      if (e.type === "done") {
        setClock(e.t);
        es.close();
      }
    };
    es.onerror = () => es.close();
    return () => {
      es.close();
      cancelAnimationFrame(raf);
      freshTimers.forEach(clearTimeout);
    };
  }, [run.id, speed, paused, finalT, reconnectKey]);

  const changeSpeed = (s: number) => {
    if (s === speed) return;
    fromRef.current = clock;
    // Keep the state we already have; the stream resumes from `clock`.
    setSpeed(s);
  };

  const replay = () => {
    fromRef.current = 0;
    setState(initialState());
    setClock(0);
    setLogOpen(false);
    setReconnectKey((k) => k + 1);
  };

  const themes = visibleThemes(state, clock);
  const visibleCount = themes.filter((t) => t.mergedAt === undefined).length;
  const finalCounts = useMemo(() => new Map(run.themes.map((t) => [t.id, t.count])), [run.themes]);
  const themeShorts = useMemo(() => new Map(run.themes.map((t) => [t.name, t.short])), [run.themes]);
  const lastLog = state.log.length ? state.log[state.log.length - 1].message : "Starting…";
  const batchLabel = `batch ${pad3(Math.min(state.totalBatches || 161, state.batch))} / ${state.totalBatches || 161}`;

  return (
    <div className="flex min-h-0 flex-1 p-4">
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-instrument-line bg-instrument text-instrument-ink">
        <div className="flex h-[76px] flex-none items-center border-b border-instrument-line px-6">
          <StageRail state={state} totalItems={totalItems} running={!paused && !state.done} />
          <div className="flex flex-none items-center gap-[18px] border-l border-instrument-line pl-5">
            <div className="flex items-center gap-1 font-mono text-[10px] text-instrument-ink-dim" aria-label="Replay speed">
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => changeSpeed(s)}
                  className="cursor-pointer rounded border-0 px-1.5 py-0.5 font-mono text-[10px]"
                  style={{ background: speed === s ? "var(--instrument-line)" : "transparent", color: speed === s ? "var(--instrument-ink-bright)" : "var(--instrument-ink-dim)" }}
                >
                  {s}×
                </button>
              ))}
            </div>
            <div className="flex flex-col items-end gap-0.5">
              <span className="eyebrow-instrument">ELAPSED</span>
              <span className="tnum font-mono text-[22px] font-medium leading-none text-instrument-ink-bright">{mmss(clock)}</span>
            </div>
            {state.done ? (
              <div className="flex items-center gap-2">
                <button type="button" onClick={replay} className="cursor-pointer border-0 bg-transparent font-mono text-[11px] text-instrument-ink-dim hover:text-instrument-ink-bright">
                  replay ↺
                </button>
                <Link
                  href={`/runs/${run.id}`}
                  className="anim-up-slow rounded-lg bg-signal px-4 py-2.5 font-sans text-[13px] font-medium leading-[1.2] text-paper no-underline transition-colors hover:bg-signal-hover"
                >
                  View results →
                </Link>
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-2">
          <ExtractionStream rows={state.rows} items={run.items} themeShorts={themeShorts} freshBatches={fresh} batchLabel={batchLabel} />
          <div className="relative flex min-h-0 min-w-0 flex-col">
            <div className="flex flex-none items-center justify-between px-5 pb-2 pt-3">
              <span className="eyebrow-instrument">THEME MAP · CONSTELLATION</span>
              <span className="font-mono text-[11px] text-instrument-ink-dim">size = mentions · color = sentiment</span>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
              <Constellation themes={themes} now={clock} finalCounts={finalCounts} />
            </div>
          </div>
        </div>

        {logOpen && <AgentLog log={state.log} onClose={() => setLogOpen(false)} />}

        <CountersStrip
          state={state}
          clock={clock}
          totalItems={totalItems}
          visibleThemeCount={visibleCount}
          lastLog={lastLog}
          logOpen={logOpen}
          onToggleLog={() => setLogOpen((v) => !v)}
        />
      </div>
    </div>
  );
}
