"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DemoDataset } from "@/lib/datasets";
import { LIVE_CAP } from "@/lib/datasets";
import { fmt, secs, shortDate, usd } from "@/lib/format";
import type { Depth } from "@/lib/types";
import { useToast } from "./toast";

export interface RecentRun {
  id: string;
  number: number;
  datasetName: string;
  date: string;
  themes: number;
  opportunities: number;
  precision: number | null;
  costUsd: number;
  durationMs: number;
}

export function NewRun({ datasets, recent, demo }: { datasets: DemoDataset[]; recent: RecentRun[]; demo: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [datasetId, setDatasetId] = useState(datasets[0]?.id ?? "");
  const [depth, setDepth] = useState<Depth>("thorough");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [product, setProduct] = useState(datasets[0]?.defaultContext.product ?? "");
  const [decision, setDecision] = useState(datasets[0]?.defaultContext.decision ?? "");

  const dataset = datasets.find((d) => d.id === datasetId) ?? datasets[0];
  const estimate = dataset ? dataset.estimate[depth] : "";
  const canRun = Boolean(dataset?.runId);

  const pick = (d: DemoDataset) => {
    setDatasetId(d.id);
    setProduct(d.defaultContext.product);
    setDecision(d.defaultContext.decision ?? "");
  };

  const run = () => {
    if (!dataset) return;
    if (!dataset.runId) {
      toast("Pre-computed run for this dataset lands with the pipeline", "info");
      return;
    }
    router.push(`/runs/${dataset.runId}/live?autoplay=1`);
  };

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto flex max-w-[1140px] flex-col gap-8 px-8 pb-12 pt-7">
        {demo && (
          <div className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3.5 py-2.5 text-[13px] text-ink">
            <svg width="8" height="8" className="block flex-none">
              <circle cx="4" cy="4" r="4" fill="var(--signal)" />
            </svg>
            <span className="flex-1">You&apos;re viewing a pre-computed run. Sign in with a key to run live.</span>
            <a
              href="#api-key"
              className="font-mono text-[12px] no-underline"
              onClick={(e) => {
                e.preventDefault();
                toast("Live runs arrive with the pipeline. Set ANTHROPIC_API_KEY on the server to enable them.", "info");
              }}
            >
              Add API key →
            </a>
          </div>
        )}

        <header className="flex flex-col gap-1.5">
          <h1 className="m-0 font-serif text-[34px] font-semibold leading-[1.1] tracking-[-0.01em]">New run</h1>
          <p className="pretty m-0 max-w-[560px] text-[15px] text-ink-dim">
            Drop in a pile of feedback. Get back a ranked list of decisions, each one citing its sources.
          </p>
        </header>

        <section className="flex flex-col gap-3">
          <span className="eyebrow">Dataset</span>
          <div className="grid grid-cols-4 gap-3.5">
            {datasets.map((d) => {
              const selected = d.id === datasetId;
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => pick(d)}
                  className="flex min-h-[168px] cursor-pointer flex-col gap-2 rounded-[10px] border bg-surface p-[18px] text-left font-sans text-ink transition-colors hover:border-ink"
                  style={{ borderColor: selected ? "var(--ink)" : "var(--line)", boxShadow: selected ? "0 0 0 1px var(--ink)" : "none" }}
                >
                  <span className="eyebrow">{d.kind}</span>
                  <span className="font-serif text-[19px] font-semibold leading-[1.2]">{d.name}</span>
                  <span className="tnum font-mono text-[12px] text-ink-dim">{d.meta}</span>
                  <span className="pretty mt-auto text-[13px] text-ink-dim">{d.description}</span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => toast("Upload arrives with live runs", "info")}
              className="flex min-h-[168px] cursor-pointer flex-col items-center justify-center gap-2 rounded-[10px] border border-dashed border-line-strong bg-transparent p-[18px] text-center text-ink-dim transition-colors hover:border-ink"
            >
              <span className="font-serif text-[19px] font-semibold text-ink">Upload your own</span>
              <span className="text-[13px]">CSV or paste text</span>
              <span className="font-mono text-[11px]">Live runs capped at {LIVE_CAP} items on the demo</span>
            </button>
          </div>
        </section>

        <div className="grid grid-cols-[minmax(0,1fr)_380px] items-start gap-6">
          <section className="flex flex-col gap-4 rounded-[10px] border border-line bg-surface p-[22px]">
            <span className="eyebrow">Context · feeds the strategic-fit score</span>
            <label className="flex flex-col gap-1.5 text-[13px] font-medium">
              What&apos;s the product?
              <textarea
                rows={3}
                value={product}
                onChange={(e) => setProduct(e.target.value)}
                className="resize-y rounded-lg border border-line bg-paper px-3 py-2.5 text-[14px] font-normal leading-[1.5] text-ink outline-none focus:border-ink"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-[13px] font-medium">
              <span>
                What are you trying to decide? <span className="font-normal text-ink-dim">(optional)</span>
              </span>
              <textarea
                rows={2}
                value={decision}
                onChange={(e) => setDecision(e.target.value)}
                placeholder="e.g. Which two things to fix this quarter to reduce churn among paid subscribers"
                className="resize-y rounded-lg border border-line bg-paper px-3 py-2.5 text-[14px] font-normal leading-[1.5] text-ink outline-none placeholder:text-ink-faint focus:border-ink"
              />
            </label>
          </section>

          <aside className="flex flex-col gap-3">
            <div className="overflow-hidden rounded-[10px] border border-line bg-surface">
              <button
                type="button"
                onClick={() => setSettingsOpen((v) => !v)}
                className="flex w-full cursor-pointer items-center justify-between gap-3 border-0 bg-transparent px-4 py-3.5 text-left font-sans text-[13px] font-medium text-ink transition-colors hover:bg-paper"
              >
                <span>Run settings</span>
                <span className="tnum font-mono text-[12px] font-normal text-ink-dim">
                  {depth === "thorough" ? "Thorough" : "Fast"} · cap {fmt(dataset?.itemCount ?? 0)} · {estimate}
                </span>
              </button>
              {settingsOpen && (
                <div className="flex flex-col gap-3.5 border-t border-line px-4 pb-4 pt-1">
                  <div className="flex items-center justify-between pt-3">
                    <span className="text-[13px]">Depth</span>
                    <div className="inline-flex rounded-lg border border-line bg-paper p-0.5">
                      {(["fast", "thorough"] as Depth[]).map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setDepth(d)}
                          className="cursor-pointer rounded-md border-0 px-3 py-[5px] font-sans text-[12px] font-medium text-ink"
                          style={{ background: depth === d ? "var(--surface)" : "transparent" }}
                        >
                          {d === "fast" ? "Fast" : "Thorough"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[13px]">Item cap</span>
                    <span className="tnum rounded-md border border-line bg-paper px-2.5 py-1 font-mono text-[13px]">{fmt(dataset?.itemCount ?? 0)}</span>
                  </div>
                  <div className="flex items-center justify-between border-t border-line pt-3">
                    <span className="text-[13px] text-ink-dim">Estimate</span>
                    <span className="tnum font-mono text-[13px]">{estimate}</span>
                  </div>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={run}
              className="flex cursor-pointer items-center justify-between rounded-lg border-0 bg-signal px-[18px] py-3.5 font-sans text-[15px] font-medium text-paper transition-colors hover:bg-signal-hover"
              style={{ opacity: canRun ? 1 : 0.6 }}
            >
              <span>Run analysis</span>
              <span className="tnum font-mono text-[12px] opacity-90">{estimate}</span>
            </button>
            <span className="text-center font-mono text-[11px] text-ink-dim">
              {canRun ? (demo ? "Demo mode · pre-computed run, replays instantly" : "Live run · streams as it works") : "Pre-computed run for this dataset is coming"}
            </span>
          </aside>
        </div>

        <section className="flex flex-col gap-3">
          <span className="eyebrow">Recent runs</span>
          <div className="flex flex-col overflow-hidden rounded-[10px] border border-line bg-surface">
            {recent.length === 0 && <div className="px-4 py-6 text-center text-[13px] text-ink-dim">No runs yet. Pick a dataset and run the analysis.</div>}
            {recent.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => router.push(`/runs/${r.id}`)}
                className="-mt-px grid cursor-pointer grid-cols-[minmax(0,1.4fr)_110px_minmax(0,1.6fr)_80px_60px] items-center gap-4 border-0 border-t border-line bg-transparent px-4 py-3 text-left font-sans text-[13px] text-ink transition-colors hover:bg-paper"
              >
                <span className="font-medium">
                  {r.datasetName} <span className="font-mono font-normal text-ink-dim">#{r.number}</span>
                </span>
                <span className="tnum font-mono text-[12px] text-ink-dim">{shortDate(r.date.slice(0, 10))}</span>
                <span className="text-ink-dim">
                  {r.themes} themes · {r.opportunities} opportunities{r.precision !== null ? ` · ${Math.round(r.precision * 100)}% precision` : ""}
                </span>
                <span className="tnum text-right font-mono text-[12px]">{usd(r.costUsd)}</span>
                <span className="tnum text-right font-mono text-[12px] text-ink-dim">{secs(r.durationMs)}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
