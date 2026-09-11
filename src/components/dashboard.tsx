"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { evidenceFromItem } from "@/lib/evidence";
import { fmt, pct, secs, shortDate, usd } from "@/lib/format";
import type { Run, Theme } from "@/lib/types";
import { EvidenceQuote } from "./evidence-quote";
import { useToast } from "./toast";
import { Button, FilterChip, OppMarker, SENTIMENT_COLOR, SentimentBar, SeverityDots, Sparkline } from "./ui";

const pad2 = (n: number) => String(n).padStart(2, "0");

export function Dashboard({ run, initialTheme }: { run: Run; initialTheme: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [drawerTheme, setDrawerTheme] = useState<string | null>(initialTheme);
  const [tip, setTip] = useState(false);

  const openTheme = (id: string | null) => {
    setDrawerTheme(id);
    const url = id ? `/runs/${run.id}?theme=${id}` : `/runs/${run.id}`;
    window.history.replaceState(null, "", url);
  };

  const oppOf = (t: Theme) => run.opportunities.find((o) => o.id === t.opportunityId);
  const d = drawerTheme ? run.themes.find((t) => t.id === drawerTheme) : undefined;
  const dOpp = d ? oppOf(d) : undefined;
  const dQuotes = d
    ? d.exampleItemIds
        .map((id) => ({ item: run.items[id], ex: run.extractions[id] }))
        .filter((x) => x.item)
        .sort((a, b) => (b.ex?.severity ?? 0) - (a.ex?.severity ?? 0))
        .slice(0, 6)
    : [];

  // Axis ceiling: the largest theme rounded up to a friendly step, so a
  // 100-item run and a 3,000-item run both fill the matrix.
  const maxCount = Math.max(1, ...run.themes.map((t) => t.count));
  const step = maxCount > 1000 ? 250 : maxCount > 200 ? 50 : maxCount > 50 ? 10 : 5;
  const maxMentions = Math.ceil((maxCount * 1.08) / step) * step;
  const midMentions = Math.round(maxMentions / 2);
  const precision = run.eval ? Math.round(run.eval.themePrecision * 100) : null;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto px-8 pb-8 pt-[26px]">
        <div className="flex items-end justify-between gap-6">
          <div className="flex flex-col gap-1.5">
            <span className="eyebrow">Insights · Run #{run.number}</span>
            <h1 className="m-0 font-serif text-[30px] font-semibold leading-[1.15] tracking-[-0.01em]">{run.datasetName}</h1>
            <span className="tnum font-mono text-[12px] text-ink-dim">
              {shortDate(run.finishedAt?.slice(0, 10))} · {fmt(run.stats.items)} items · {run.sources.join(" · ")} · {secs(run.stats.durationMs)} · {usd(run.stats.costUsd)}
            </span>
          </div>
          <div className="flex items-center">
            <Stat value={String(run.stats.themes)} label="themes" />
            <Stat value={String(run.stats.opportunities)} label="opportunities" />
            <div className="relative flex flex-col gap-0.5 border-l border-line px-7">
              <span className="tnum font-mono text-[34px] font-medium leading-none tracking-[-0.02em]">{precision !== null ? `${precision}%` : "—"}</span>
              <span className="flex items-center gap-[5px] text-[12px] text-ink-dim">
                extraction precision
                <button
                  type="button"
                  onMouseEnter={() => setTip(true)}
                  onMouseLeave={() => setTip(false)}
                  onFocus={() => setTip(true)}
                  onBlur={() => setTip(false)}
                  className="inline-flex h-[15px] w-[15px] cursor-help items-center justify-center rounded-full border border-line-strong bg-surface p-0 font-serif text-[10px] italic leading-none text-ink-dim"
                  aria-label="How precision is measured"
                >
                  i
                </button>
              </span>
              {tip && (
                <div
                  className="absolute right-0 top-full z-10 mt-2 w-[250px] rounded-lg px-3 py-2.5 text-[12px] leading-[1.5]"
                  style={{ background: "var(--toast-bg)", color: "var(--toast-text)", boxShadow: "0 8px 24px rgba(0,0,0,.5)" }}
                >
                  Share of extracted theme labels that match a hand-labelled {run.eval?.n ?? 50}-item golden set. Recall {run.eval ? Math.round(run.eval.themeRecall * 100) : "—"}%. See the Trust panel in the brief.
                </div>
              )}
            </div>
            <Button className="ml-5" onClick={() => toast("Brief opens in the next round", "info")}>
              Open brief
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <FilterChip label="Rating" value="All" />
          <FilterChip label="Date" value="Last 14 months" />
          <FilterChip label="App" value={`All ${run.sources.length}`} />
          <FilterChip label="Sentiment" value="All" />
          <div className="flex-1" />
          <span className="tnum font-mono text-[12px] text-ink-dim">Showing all {fmt(run.stats.items)} items · click a row for evidence</span>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_420px] items-start gap-5">
          <div className="overflow-hidden rounded-[10px] border border-line bg-surface">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <Th className="pl-4 pr-2 text-left">#</Th>
                  <Th className="text-left">Theme</Th>
                  <Th className="text-right">Mentions</Th>
                  <Th className="text-right">Share</Th>
                  <Th className="text-left">Sentiment</Th>
                  <Th className="text-left">Severity</Th>
                  <Th className="text-left">Trend</Th>
                  <Th className="pr-4 text-left">Opportunity</Th>
                </tr>
              </thead>
              <tbody>
                {run.themes.map((t) => {
                  const opp = oppOf(t);
                  const selected = drawerTheme === t.id;
                  return (
                    <tr
                      key={t.id}
                      onClick={() => openTheme(t.id)}
                      className="cursor-pointer border-t border-line transition-colors hover:bg-paper"
                      style={{ background: selected ? "var(--signal-soft)" : undefined }}
                    >
                      <td className="tnum py-2.5 pl-4 pr-2 font-mono text-[12px] text-ink-dim">{pad2(t.rank)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-medium">{t.name}</td>
                      <td className="tnum px-3 py-2.5 text-right font-mono text-[13px]">{fmt(t.count)}</td>
                      <td className="tnum px-3 py-2.5 text-right font-mono text-[12px] text-ink-dim">{pct(t.share)}</td>
                      <td className="px-3 py-2.5">
                        <SentimentBar split={t.sentimentSplit} />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <SeverityDots value={t.severityAvg} />
                          <span className="tnum font-mono text-[12px]">{t.severityAvg.toFixed(1)}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <Sparkline values={t.trend} />
                      </td>
                      <td className="py-2 pl-3 pr-4">
                        {opp && (
                          <OppMarker
                            score={opp.score}
                            onClick={() => router.push(`/runs/${run.id}/opportunities/${opp.id}`)}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-2.5 rounded-[10px] border border-line bg-surface px-5 pb-3 pt-[18px]">
            <div className="flex items-baseline justify-between">
              <span className="eyebrow">Impact matrix</span>
              <span className="text-[12px] text-ink-dim">frequency × severity</span>
            </div>
            <svg width="378" height="330" className="block overflow-visible" role="img" aria-label="Impact matrix">
              <rect x="187" y="16" width="179" height="140" fill="var(--signal-soft)" opacity="0.6" />
              <text x="360" y="32" fill="var(--signal)" className="font-mono" style={{ fontSize: 10, letterSpacing: ".08em", textAnchor: "end" }}>
                OPPORTUNITIES
              </text>
              <line x1="44" y1="16" x2="44" y2="296" stroke="var(--line)" />
              <line x1="44" y1="296" x2="366" y2="296" stroke="var(--line)" />
              <line x1="187" y1="16" x2="187" y2="296" stroke="var(--line)" strokeDasharray="3 3" />
              <line x1="44" y1="156" x2="366" y2="156" stroke="var(--line)" strokeDasharray="3 3" />
              {[
                ["5", 20],
                ["3", 159],
                ["1", 299],
              ].map(([l, y]) => (
                <text key={l} x="38" y={y} fill="var(--ink-dim)" className="font-mono" style={{ fontSize: 9, textAnchor: "end" }}>
                  {l}
                </text>
              ))}
              <text x="44" y="312" fill="var(--ink-dim)" className="font-mono" style={{ fontSize: 9 }}>0</text>
              <text x="187" y="312" fill="var(--ink-dim)" className="font-mono" style={{ fontSize: 9, textAnchor: "middle" }}>{midMentions}</text>
              <text x="366" y="312" fill="var(--ink-dim)" className="font-mono" style={{ fontSize: 9, textAnchor: "end" }}>{maxMentions} mentions</text>
              <text x="14" y="160" fill="var(--ink-dim)" className="font-mono" style={{ fontSize: 9, textAnchor: "middle", transform: "rotate(-90deg)", transformOrigin: "14px 160px" }}>
                severity
              </text>
              {run.themes.map((t) => {
                const cx = 44 + (t.count / maxMentions) * 322;
                const cy = 16 + ((5 - t.severityAvg) / 4) * 280;
                const r = 3 + Math.sqrt(t.count) * 0.42;
                const labelled = t.count >= 170 || t.severityAvg >= 4.5;
                return (
                  <g key={t.id} className="cursor-pointer" onClick={() => openTheme(t.id)}>
                    <circle cx={cx} cy={cy} r={r} fill={SENTIMENT_COLOR[t.sentiment]} opacity="0.85" stroke="var(--surface)" strokeWidth="1.5" />
                    {labelled && (
                      <text x={cx + r + 5} y={cy + 4} fill="var(--ink)" className="font-sans" style={{ fontSize: 10.5 }}>
                        {t.short}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
            <div className="flex gap-3.5 border-t border-line pt-1 text-[11px] text-ink-dim">
              <Legend color="var(--negative)">negative</Legend>
              <Legend color="var(--neutral)">neutral / mixed</Legend>
              <Legend color="var(--positive)">positive</Legend>
              <span className="ml-auto">dot size = mentions</span>
            </div>
          </div>
        </div>
      </div>

      {d && (
        <aside
          className="anim-slide-in absolute inset-y-0 right-0 z-[4] flex w-[480px] flex-col border-l border-line bg-surface"
          style={{ boxShadow: "-16px 0 40px rgba(0,0,0,.5)" }}
        >
          <div className="flex flex-col gap-2.5 border-b border-line px-6 pb-4 pt-[22px]">
            <div className="flex items-center justify-between">
              <span className="eyebrow tnum">
                Theme {pad2(d.rank)} · {fmt(d.count)} mentions · {pct(d.share)}
              </span>
              <button type="button" onClick={() => openTheme(null)} className="cursor-pointer border-0 bg-transparent p-1 text-[16px] leading-none text-ink-dim hover:text-ink" aria-label="Close">
                ✕
              </button>
            </div>
            <h2 className="pretty m-0 font-serif text-[22px] font-semibold leading-[1.2] tracking-[-0.01em]">{d.name}</h2>
            <div className="flex items-center gap-3">
              <SentimentBar split={d.sentimentSplit} width={200} />
              <span className="tnum font-mono text-[11px] text-ink-dim">{d.sentimentSplit.join(" / ")}</span>
              <span className="tnum ml-auto font-mono text-[11px] text-ink-dim">sev {d.severityAvg.toFixed(1)}</span>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-[22px] overflow-auto px-6 pb-6 pt-[18px]">
            <span className="tnum font-mono text-[11px] text-ink-dim">
              Source reviews · showing {dQuotes.length} of {fmt(d.count)} · sorted by severity
            </span>
            {dQuotes.map(({ item, ex }) => (
              <EvidenceQuote key={item.id} evidence={evidenceFromItem(item, ex)} item={item} />
            ))}
            {dQuotes.length === 0 && <span className="text-[13px] text-ink-dim">No example items were kept for this theme.</span>}
          </div>
          {dOpp && (
            <div className="flex flex-none items-center justify-between border-t border-line bg-paper px-6 py-3.5">
              <span className="text-[12px] text-ink-dim">Rolled up into an opportunity</span>
              <Link
                href={`/runs/${run.id}/opportunities/${dOpp.id}`}
                className="rounded-lg bg-signal px-3.5 py-[9px] font-sans text-[13px] font-medium leading-[1.2] text-paper no-underline transition-colors hover:bg-signal-hover"
              >
                View opportunity · {dOpp.score} →
              </Link>
            </div>
          )}
        </aside>
      )}
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-l border-line px-7">
      <span className="tnum font-mono text-[34px] font-medium leading-none tracking-[-0.02em]">{value}</span>
      <span className="text-[12px] text-ink-dim">{label}</span>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`eyebrow px-3 py-2.5 font-normal ${className}`}>{children}</th>;
}

function Legend({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-[5px]">
      <svg width="8" height="8" className="block">
        <circle cx="4" cy="4" r="4" fill={color} />
      </svg>
      {children}
    </span>
  );
}
