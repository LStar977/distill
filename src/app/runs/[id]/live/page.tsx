import { notFound } from "next/navigation";
import { getRunFile } from "@/lib/runs";
import { LiveRun } from "@/components/live/live-run";

export default async function LivePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const file = await getRunFile(id);
  if (!file) notFound();

  const at = Math.max(0, Number(sp.at ?? 0) || 0);
  const speed = [1, 2, 4].includes(Number(sp.speed)) ? Number(sp.speed) : 1;
  const paused = sp.paused === "1";

  return (
    <LiveRun
      run={file.run}
      initialAt={at}
      initialSpeed={speed}
      paused={paused}
      initialEvents={paused ? file.events : undefined}
    />
  );
}
