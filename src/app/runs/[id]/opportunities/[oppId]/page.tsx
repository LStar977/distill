import { notFound } from "next/navigation";
import { getRun } from "@/lib/runs";
import { OpportunityView } from "@/components/opportunity";

export default async function OpportunityPage({ params }: { params: Promise<{ id: string; oppId: string }> }) {
  const { id, oppId } = await params;
  const run = await getRun(id);
  if (!run) notFound();
  const opp = run.opportunities.find((o) => o.id === oppId);
  if (!opp) notFound();
  return <OpportunityView run={run} opp={opp} />;
}
