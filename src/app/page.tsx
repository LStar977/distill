import { DATASETS } from "@/lib/datasets";
import { listRuns } from "@/lib/runs";
import { NewRun } from "@/components/new-run";

export default async function HomePage() {
  const runs = await listRuns();
  const recent = runs.map((r) => ({
    id: r.id,
    number: r.number,
    datasetName: r.datasetName,
    date: r.finishedAt ?? "",
    themes: r.stats.themes,
    opportunities: r.stats.opportunities,
    precision: r.eval?.themePrecision ?? null,
    costUsd: r.stats.costUsd,
    durationMs: r.stats.durationMs,
  }));
  return <NewRun datasets={DATASETS} recent={recent} demo={!process.env.ANTHROPIC_API_KEY} />;
}
