"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { Sentiment } from "@/lib/types";

export const SENTIMENT_COLOR: Record<Sentiment, string> = {
  negative: "var(--negative)",
  positive: "var(--positive)",
  neutral: "var(--neutral)",
  mixed: "var(--neutral)",
};

type Variant = "primary" | "secondary" | "ghost";

export function Button({
  variant = "secondary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const base =
    "cursor-pointer rounded-lg px-3.5 py-[9px] font-sans text-[13px] font-medium leading-[1.2] transition-colors disabled:cursor-not-allowed";
  const styles: Record<Variant, string> = {
    primary: "border-0 bg-signal text-paper hover:bg-signal-hover disabled:bg-line disabled:text-instrument-ink-dim",
    secondary: "border border-line bg-surface text-ink hover:bg-paper",
    ghost: "border-0 bg-transparent px-2.5 text-ink-dim hover:text-ink",
  };
  return <button className={`${base} ${styles[variant]} ${className}`} {...props} />;
}

export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`eyebrow ${className}`}>{children}</span>;
}

/** "★ 2 · 14 Mar 2026 · IronLog" — byte-identical everywhere it appears. */
export function SourceChip({ rating, date, source }: { rating?: number; date: string; source: string }) {
  return (
    <span className="tnum inline-flex items-center gap-1.5 self-start rounded-full border border-line bg-surface px-2 py-1 font-mono text-[11px] leading-none text-ink-dim">
      {rating !== undefined ? `★ ${rating} · ` : ""}
      {date}
      {" · "}
      {source}
    </span>
  );
}

export function SentimentChip({ sentiment }: { sentiment: Sentiment }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-instrument-chip-line px-2 py-1 font-mono text-[11px] leading-none text-instrument-ink">
      <svg width="8" height="8" className="block">
        <circle cx="4" cy="4" r="4" fill={SENTIMENT_COLOR[sentiment]} />
      </svg>
      {sentiment}
    </span>
  );
}

export function ThemeTag({ children }: { children: ReactNode }) {
  return (
    <span className="rounded border border-instrument-chip-line bg-surface px-1.5 py-1 font-mono text-[11px] leading-none text-instrument-ink-soft">
      {children}
    </span>
  );
}

/** Five 5×8 bars. `on`/`off` colors differ between paper and instrument surfaces. */
export function SeverityDots({ value, on = "var(--ink)", off = "var(--line)" }: { value: number; on?: string; off?: string }) {
  const filled = Math.round(value);
  return (
    <svg width="34" height="8" className="block" aria-label={`severity ${value} of 5`}>
      {[0, 1, 2, 3, 4].map((k) => (
        <rect key={k} x={k * 7} y="0" width="5" height="8" rx="1" fill={k < filled ? on : off} />
      ))}
    </svg>
  );
}

/** Positive / neutral / negative split bar. `split` is percentages summing to 100. */
export function SentimentBar({ split, width = 120 }: { split: [number, number, number]; width?: number }) {
  const k = width / 100;
  const [pos, neu, neg] = split;
  return (
    <svg width={width} height="6" className="block">
      <rect x="0" y="0" width={width} height="6" rx="1" fill="var(--line)" />
      <rect x="0" y="0" width={pos * k} height="6" fill="var(--positive)" />
      <rect x={pos * k} y="0" width={neu * k} height="6" fill="var(--neutral)" />
      <rect x={(pos + neu) * k} y="0" width={neg * k} height="6" fill="var(--negative)" />
    </svg>
  );
}

export function Sparkline({ values, max = 10 }: { values: number[]; max?: number }) {
  const n = Math.max(1, values.length - 1);
  const points = values.map((v, k) => `${((k * 72) / n).toFixed(1)},${(18 - (v / max) * 16).toFixed(1)}`).join(" ");
  return (
    <svg width="72" height="20" className="block">
      <polyline points={points} fill="none" stroke="var(--ink-dim)" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export function FactorBar({ value, color = "var(--ink)" }: { value: number; color?: string }) {
  return (
    <svg width="100%" height="4" className="block">
      <rect x="0" y="0" width="100%" height="4" rx="2" fill="var(--line)" />
      <rect x="0" y="0" width={`${Math.round(value * 100)}%`} height="4" rx="2" fill={color} />
    </svg>
  );
}

/** "→ 92" opportunity marker. */
export function OppMarker({ score, onClick, className = "" }: { score: number; onClick?: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`tnum inline-flex cursor-pointer items-center gap-1.5 rounded-md border-0 bg-signal-soft px-2 py-1 font-mono text-[12px] font-medium text-signal transition-colors hover:bg-signal hover:text-paper ${className}`}
    >
      → {score}
    </button>
  );
}

export function FilterChip({ label, value }: { label: string; value: string }) {
  return (
    <button
      type="button"
      className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-line bg-surface px-2.5 py-1.5 font-sans text-[12px] text-ink transition-colors hover:border-ink"
    >
      <span className="text-ink-dim">{label}</span>
      {value}
      <svg width="8" height="5" className="block">
        <polyline points="0,0 4,4 8,0" fill="none" stroke="var(--ink-dim)" strokeWidth="1.2" />
      </svg>
    </button>
  );
}
