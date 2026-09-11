"use client";

import type { Evidence, Item } from "@/lib/types";
import { shortDate } from "@/lib/format";
import { SourceChip } from "./ui";

/**
 * The signature element. One component, one style string, used in the
 * extraction stream, the evidence drawer, the opportunity page and the brief.
 * On the instrument only the paragraph size changes (15px); mark and chip are
 * identical.
 */
export function EvidenceQuote({
  evidence,
  item,
  size = 16,
  color = "var(--ink)",
  link = true,
}: {
  evidence: Evidence;
  item: Item;
  size?: 15 | 16;
  color?: string;
  link?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 font-serif leading-[1.5]" style={{ fontSize: size, color }}>
        {evidence.pre}
        <mark className="evidence">{evidence.quote}</mark>
        {evidence.post}
      </p>
      <div className="flex items-center gap-3">
        <SourceChip rating={item.rating} date={shortDate(item.date)} source={item.source} />
        {link && (
          <a href={`#item-${item.id}`} className="font-mono text-[11px] no-underline" onClick={(e) => e.preventDefault()} title={item.id}>
            Open original ↗
          </a>
        )}
      </div>
    </div>
  );
}
