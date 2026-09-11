"use client";

import { useEffect, useRef } from "react";
import { mmss } from "@/lib/format";
import type { LogLine } from "@/lib/replay";

export function AgentLog({ log, onClose }: { log: LogLine[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log.length]);
  return (
    <div
      className="anim-up absolute inset-x-0 bottom-[60px] flex h-[230px] flex-col border-t border-instrument-line bg-instrument-deep"
      style={{ boxShadow: "0 -20px 40px rgba(0,0,0,.35)" }}
    >
      <div className="flex flex-none items-center justify-between border-b border-instrument-line px-5 py-2.5">
        <span className="eyebrow-instrument">AGENT LOG · {log.length} ENTRIES</span>
        <button type="button" onClick={onClose} className="cursor-pointer border-0 bg-transparent font-mono text-[11px] text-instrument-ink-dim hover:text-instrument-ink-bright">
          close ▾
        </button>
      </div>
      <div ref={ref} className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto px-5 py-2.5">
        {log.map((e, i) => (
          <div key={i} className="tnum flex gap-4 font-mono text-[12px] leading-[1.5]">
            <span className="flex-none text-ink-faint">
              {mmss(e.t)}.{Math.floor((e.t % 1) * 10)}
            </span>
            <span className="text-instrument-ink-soft">{e.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
