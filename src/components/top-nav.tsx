"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function TopNav({ latestRunId, latestRunNumber, demo }: { latestRunId: string | null; latestRunNumber: number | null; demo: boolean }) {
  const pathname = usePathname();
  const m = pathname.match(/^\/runs\/([^/]+)/);
  const runId = m?.[1] ?? latestRunId;
  const isLive = /\/live$/.test(pathname);
  const isOpp = /\/opportunities\//.test(pathname);
  const isDash = Boolean(m) && !isLive && !isOpp;
  const isHome = pathname === "/";

  const items: { label: string; href: string; active: boolean }[] = [
    { label: "New run", href: "/", active: isHome },
    { label: "Live run", href: runId ? `/runs/${runId}/live` : "/", active: isLive },
    { label: "Dashboard", href: runId ? `/runs/${runId}` : "/", active: isDash },
    { label: "Opportunity", href: runId ? `/runs/${runId}/opportunities/first` : "/", active: isOpp },
  ];

  return (
    <div className="flex h-[52px] flex-none items-center gap-4 border-b border-line bg-paper px-5">
      <Link href="/" className="flex items-baseline gap-2 no-underline">
        <span className="font-serif text-[21px] font-semibold tracking-[-0.01em] text-ink">Distill</span>
        <span className="font-mono text-[11px] text-ink-dim">v0.1</span>
      </Link>
      <nav className="ml-3 flex gap-0.5">
        {items.map((it) => (
          <Link
            key={it.label}
            href={it.href}
            className="flex flex-col items-center gap-[3px] rounded-md px-2.5 pb-1 pt-1.5 font-sans text-[13px] font-medium no-underline transition-colors hover:bg-surface"
            style={{ color: it.active ? "var(--ink)" : "var(--ink-dim)" }}
          >
            {it.label}
            <svg width="4" height="4" className="block">
              <circle cx="2" cy="2" r="2" fill={it.active ? "var(--signal)" : "transparent"} />
            </svg>
          </Link>
        ))}
      </nav>
      <div className="flex-1" />
      {demo && (
        <span className="inline-flex items-center gap-[7px] rounded-full border border-line bg-surface px-2.5 py-1 font-mono text-[11px] text-ink-dim">
          <svg width="6" height="6" className="block">
            <circle cx="3" cy="3" r="3" fill="var(--signal)" />
          </svg>
          Demo · pre-computed run
        </span>
      )}
      {latestRunNumber !== null && <span className="font-mono text-[12px] text-ink-dim">Run #{latestRunNumber}</span>}
      <div className="h-7 w-7 rounded-full border border-line bg-line" aria-hidden />
    </div>
  );
}
