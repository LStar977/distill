"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { fmt } from "@/lib/format";
import type { Opportunity, Run } from "@/lib/types";
import { EvidenceQuote } from "./evidence-quote";
import { useToast } from "./toast";
import { Button, FactorBar } from "./ui";

const pad2 = (n: number) => String(n).padStart(2, "0");

function toMarkdown(run: Run, o: Opportunity) {
  const theme = run.themes.find((t) => t.id === o.themeIds[0]);
  const lines = [
    `# ${o.title}`,
    "",
    o.problem,
    "",
    `**Score ${o.score} / 100** · rank ${o.rank} of ${run.opportunities.length} · confidence ${o.confidence}`,
    ...o.factors.map((f) => `- ${f.name}: ${f.value.toFixed(2)} (${f.note})`),
    "",
    "## Evidence",
    ...o.evidence.map((e) => {
      const it = run.items[e.itemId];
      return `> ${e.pre}**${e.quote}**${e.post}\n> — ★${it?.rating ?? "?"} · ${it?.date ?? ""} · ${it?.source ?? ""} · ${e.itemId}`;
    }),
    "",
    "## Proposed direction",
    o.direction,
    "",
    "## What we'd need to validate",
    ...o.validate.map((v, i) => `${i + 1}. ${v}`),
    "",
    `Effort ${o.effort} · Impact ${o.impact}${theme ? ` · Theme: ${theme.name} (${fmt(theme.count)} mentions)` : ""}`,
  ];
  return lines.join("\n");
}

export function OpportunityView({ run, opp }: { run: Run; opp: Opportunity }) {
  const router = useRouter();
  const toast = useToast();
  const theme = run.themes.find((t) => t.id === opp.themeIds[0]);
  const confidenceBars = opp.confidence === "High" ? 3 : opp.confidence === "Medium" ? 2 : 1;
  const precision = run.eval ? Math.round(run.eval.themePrecision * 100) : null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toMarkdown(run, opp));
      toast("Copied as Markdown");
    } catch {
      toast("Clipboard unavailable in this browser", "info");
    }
  };

  return (
    <div className="relative min-h-0 flex-1 overflow-auto">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-[22px] px-8 pb-14 pt-[22px]">
        <div className="flex items-center justify-between">
          <Link href={`/runs/${run.id}`} className="py-1.5 font-sans text-[13px] font-medium text-ink-dim no-underline hover:text-ink">
            ← Dashboard
          </Link>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => toast(`Added to brief · ${opp.rank} of ${run.opportunities.length}`)}>
              Add to brief
            </Button>
            <Button onClick={copy}>Copy as markdown</Button>
            <Button
              variant="ghost"
              onClick={() => {
                toast("Opportunity dismissed · undo", "info");
                router.push(`/runs/${run.id}`);
              }}
            >
              Dismiss
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_340px] items-start gap-11">
          <main className="flex min-w-0 flex-col gap-[30px]">
            <header className="flex flex-col gap-3">
              <span className="eyebrow tnum">
                Opportunity {pad2(opp.rank)} of {pad2(run.opportunities.length)} · Run #{run.number} · {run.datasetName}
              </span>
              <h1 className="pretty m-0 font-serif text-[38px] font-semibold leading-[1.1] tracking-[-0.015em]">{opp.title}</h1>
              <p className="pretty m-0 text-[17px] leading-[1.5] text-ink">{opp.problem}</p>
            </header>

            <section className="flex flex-col gap-4">
              <div className="flex items-baseline justify-between border-b border-line pb-2">
                <h3 className="m-0 text-[12px] font-medium uppercase tracking-[.06em] text-ink-dim">Evidence</h3>
                <span className="tnum font-mono text-[11px] text-ink-dim">
                  {opp.evidence.length} of {theme ? fmt(theme.count) : "—"} source reviews · every claim maps to an item ID
                </span>
              </div>
              <div className="flex flex-col gap-5">
                {opp.evidence.map((e) => {
                  const item = run.items[e.itemId];
                  if (!item) return null;
                  return <EvidenceQuote key={e.itemId} evidence={e} item={item} />;
                })}
              </div>
            </section>

            <section className="flex flex-col gap-2.5">
              <h3 className="m-0 border-b border-line pb-2 text-[12px] font-medium uppercase tracking-[.06em] text-ink-dim">Proposed direction</h3>
              <p className="pretty m-0 font-serif text-[18px] leading-[1.55]">{opp.direction}</p>
            </section>

            <section className="flex flex-col gap-2.5">
              <h3 className="m-0 border-b border-line pb-2 text-[12px] font-medium uppercase tracking-[.06em] text-ink-dim">What we&apos;d need to validate</h3>
              <ol className="m-0 flex list-decimal flex-col gap-1.5 pl-[22px] text-[15px] leading-[1.5]">
                {opp.validate.map((v) => (
                  <li key={v} className="pretty">
                    {v}
                  </li>
                ))}
              </ol>
            </section>
          </main>

          <aside className="flex flex-col gap-3.5">
            <div className="flex flex-col gap-3.5 rounded-[10px] border border-line bg-surface p-5">
              <span className="eyebrow">Opportunity score</span>
              <div className="flex items-baseline gap-2">
                <span className="tnum font-mono text-[56px] font-medium leading-none tracking-[-0.03em]">{opp.score}</span>
                <span className="font-mono text-[13px] text-ink-dim">/ 100 · rank {pad2(opp.rank)}</span>
              </div>
              <div className="flex flex-col gap-3 pt-1">
                {opp.factors.map((f) => (
                  <div key={f.name} className="flex flex-col gap-[5px]">
                    <div className="flex justify-between text-[12px]">
                      <span className="font-medium">{f.name}</span>
                      <span className="tnum font-mono">{f.value.toFixed(2)}</span>
                    </div>
                    <FactorBar value={f.value} />
                    <span className="text-[11px] text-ink-dim">{f.note}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 border-t border-line pt-3 text-[12px]">
                <svg width="22" height="8" className="block">
                  {[0, 1, 2].map((k) => (
                    <rect key={k} x={k * 8} y="0" width="6" height="8" rx="1" fill={k < confidenceBars ? "var(--positive)" : "var(--line)"} />
                  ))}
                </svg>
                <span className="font-medium">Confidence: {opp.confidence}</span>
                <span className="tnum ml-auto font-mono text-[11px] text-ink-dim">
                  {theme ? fmt(theme.count) : "—"} items{precision !== null ? ` · ${precision}% precision` : ""}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-3 rounded-[10px] border border-line bg-surface p-5">
              <span className="eyebrow">Who&apos;s affected · share of this theme&apos;s feedback</span>
              {opp.segments.map((s) => (
                <div key={s.name} className="flex flex-col gap-[5px]">
                  <div className="flex justify-between text-[13px]">
                    <span>{s.name}</span>
                    <span className="tnum font-mono">{s.share}%</span>
                  </div>
                  <FactorBar value={s.share / 100} color="var(--signal)" />
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3.5">
              <div className="flex flex-col gap-1.5 rounded-[10px] border border-line bg-surface px-5 py-4">
                <span className="eyebrow">Effort</span>
                <span className="font-mono text-[26px] font-medium leading-none">{opp.effort}</span>
              </div>
              <div className="flex flex-col gap-1.5 rounded-[10px] border border-line bg-surface px-5 py-4">
                <span className="eyebrow">Impact</span>
                <span className="font-mono text-[26px] font-medium leading-none">{opp.impact}</span>
              </div>
            </div>

            <div className="flex flex-col gap-3 rounded-[10px] border border-line bg-surface p-5">
              <span className="eyebrow">Related themes</span>
              <div className="flex flex-wrap gap-1.5">
                {opp.relatedThemeIds.map((id) => {
                  const t = run.themes.find((x) => x.id === id);
                  if (!t) return null;
                  return (
                    <Link
                      key={id}
                      href={`/runs/${run.id}?theme=${id}`}
                      className="rounded-full border border-line bg-paper px-2.5 py-[5px] text-left font-sans text-[12px] text-ink no-underline transition-colors hover:border-ink"
                    >
                      {t.name}
                    </Link>
                  );
                })}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
