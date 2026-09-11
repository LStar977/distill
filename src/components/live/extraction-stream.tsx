"use client";

import { evidenceFromItem } from "@/lib/evidence";
import { pad3 } from "@/lib/format";
import type { Item, StreamRow } from "@/lib/types";
import { EvidenceQuote } from "@/components/evidence-quote";
import { SentimentChip, SeverityDots, ThemeTag } from "@/components/ui";

const shortLabel = (label: string, shorts: Map<string, string>) => shorts.get(label) ?? label;

export function ExtractionStream({
  rows,
  items,
  themeShorts,
  freshBatches,
  batchLabel,
}: {
  rows: StreamRow[];
  items: Record<string, Item>;
  themeShorts: Map<string, string>;
  /** Batch numbers that arrived in the last ~250ms (rendered faded and lifted). */
  freshBatches: Set<number>;
  batchLabel: string;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-col border-r border-instrument-line">
      <div className="flex flex-none items-center justify-between px-5 pb-2 pt-3">
        <span className="eyebrow-instrument">EXTRACTION STREAM · 1 ROW PER BATCH OF 20</span>
        <span className="tnum font-mono text-[11px] text-instrument-ink-dim">{batchLabel}</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-5 pb-3">
        {rows.map((r) => {
          const item = items[r.itemId];
          if (!item) return null;
          const fresh = freshBatches.has(r.batch);
          return (
            <div
              key={r.batch}
              className="grid flex-none grid-cols-[minmax(0,1fr)_220px] gap-4 rounded-lg border border-instrument-line bg-instrument-row px-3.5 py-3"
              style={{ opacity: fresh ? 0.25 : 1, transform: fresh ? "translateY(-6px)" : "none", transition: "opacity .35s, transform .35s" }}
            >
              <div className="min-w-0">
                <EvidenceQuote evidence={evidenceFromItem(item, r.extraction)} item={item} size={15} color="var(--instrument-ink)" link={false} />
              </div>
              <div className="flex min-w-0 flex-col items-start gap-2">
                <div className="flex items-center gap-2.5">
                  <SentimentChip sentiment={r.extraction.sentiment} />
                  <SeverityDots value={r.extraction.severity} on="var(--instrument-ink)" off="var(--instrument-chip-line)" />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {r.extraction.themes.map((t) => (
                    <ThemeTag key={t}>{shortLabel(t, themeShorts)}</ThemeTag>
                  ))}
                </div>
                <span className="tnum font-mono text-[10px] text-ink-faint">batch #{pad3(r.batch)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
