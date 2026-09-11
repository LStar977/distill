import { notFound, redirect } from "next/navigation";
import { getRun } from "@/lib/runs";
import { OpportunityView } from "@/components/opportunity";

export default async function OpportunityPage({ params }: { params: Promise<{ id: string; oppId: string }> }) {
  const { id, oppId } = await params;
  const run = await getRun(id);
  if (!run) notFound();
  if (oppId === "first") {
    const top = run.opportunities[0];
    if (!top) notFound();
    redirect(`/runs/${id}/opportunities/${top.id}`);
  }
  const opp = run.opportunities.find((o) => o.id === oppId);
  if (!opp) notFound();
  return <OpportunityView run={run} opp={opp} />;
}
