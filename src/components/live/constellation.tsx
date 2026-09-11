"use client";

import { useMemo } from "react";
import { MAP_H, MAP_W, radiusFor, solveLayout, type LayoutNode } from "@/lib/constellation";
import { fmt } from "@/lib/format";
import { mergeProgress, type LiveTheme } from "@/lib/replay";
import { SENTIMENT_COLOR } from "@/components/ui";

const lerp = (a: number, b: number, x: number) => a + (b - a) * x;
const f1 = (x: number) => Math.round(x * 10) / 10;

export function Constellation({
  themes,
  now,
  finalCounts,
}: {
  themes: LiveTheme[];
  /** Replay clock in seconds; drives pulse rings and merge drift. */
  now: number;
  /** Final counts when known (pre-computed run), so the layout is stable from the first frame. */
  finalCounts: Map<string, number>;
}) {
  // Radius used for layout: the final count when known (pre-computed run), else
  // the live count. Re-solve when a node appears or its radius crosses a 10px
  // step, not on every tick; CSS transitions smooth the drift between solves.
  const layoutNodes: LayoutNode[] = themes.map((t) => ({
    id: t.id,
    r: radiusFor(Math.max(finalCounts.get(t.id) ?? 0, t.count)),
    parentId: t.parentId,
  }));
  const key = layoutNodes
    .map((n) => `${n.id}:${Math.round(n.r / 10)}`)
    .sort()
    .join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layout = useMemo(() => solveLayout(layoutNodes), [key]);

  const posOf = (t: LiveTheme) => {
    const p = layout.get(t.id);
    if (!p) return { x: MAP_W / 2, y: MAP_H / 2 };
    const m = mergeProgress(t, now);
    if (m > 0 && t.parentId) {
      const pp = layout.get(t.parentId);
      if (pp) return { x: lerp(p.x, pp.x, m), y: lerp(p.y, pp.y, m) };
    }
    return p;
  };

  return (
    <svg width={MAP_W} height={MAP_H} className="block overflow-visible" role="img" aria-label="Theme map">
      {themes.map((t) => {
        const age = Math.max(0, Math.min(1, (now - t.lastHitAt) / 0.7));
        if (age >= 1 || t.mergedAt !== undefined) return null;
        const { x, y } = posOf(t);
        return (
          <circle
            key={`pulse-${t.id}`}
            cx={f1(x)}
            cy={f1(y)}
            r={f1(radiusFor(t.count) + 4 + age * 16)}
            fill="none"
            stroke={SENTIMENT_COLOR[t.sentiment]}
            opacity={f1((1 - age) * 0.8)}
            strokeWidth="1.5"
          />
        );
      })}
      {themes.map((t) => {
        const { x, y } = posOf(t);
        const r = radiusFor(t.count);
        const big = r >= 30;
        const m = mergeProgress(t, now);
        const fill = SENTIMENT_COLOR[t.sentiment];
        const stroke = t.other ? "var(--ink-faint)" : t.sentiment === "mixed" ? "var(--negative)" : "none";
        const transition = "r .4s, cx .8s, cy .8s";
        return (
          <g key={t.id} opacity={f1(1 - m)}>
            <circle cx={f1(x)} cy={f1(y)} r={f1(r * 1.45)} fill={fill} opacity="0.10" style={{ transition }} />
            <circle
              cx={f1(x)}
              cy={f1(y)}
              r={f1(r)}
              fill={fill}
              fillOpacity={t.other ? 0.08 : 0.9}
              stroke={stroke}
              strokeDasharray={t.other ? "4 4" : undefined}
              strokeWidth="1.5"
              style={{ transition }}
            />
            <text
              x={f1(x)}
              y={f1(big ? y - 2 : y + r + 14)}
              fill={big ? "var(--surface)" : "var(--instrument-ink-soft)"}
              className="font-sans"
              style={{ fontSize: 11, fontWeight: 500, textAnchor: "middle", transition: "x .8s, y .8s" }}
            >
              {t.short}
            </text>
            <text
              x={f1(x)}
              y={f1(big ? y + 13 : y + r + 27)}
              fill={big ? "var(--surface)" : "var(--instrument-ink-soft)"}
              className="font-mono tnum"
              style={{ fontSize: 11, textAnchor: "middle", opacity: 0.8, transition: "x .8s, y .8s" }}
            >
              {fmt(t.count)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
