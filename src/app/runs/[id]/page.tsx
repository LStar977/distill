import { notFound } from "next/navigation";
import { getRun } from "@/lib/runs";
import { Dashboard } from "@/components/dashboard";

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const run = await getRun(id);
  if (!run) notFound();
  const theme = typeof sp.theme === "string" ? sp.theme : null;
  return <Dashboard run={run} initialTheme={theme} />;
}
