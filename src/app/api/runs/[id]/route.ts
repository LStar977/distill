import { NextResponse } from "next/server";
import { getRunFile } from "@/lib/runs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const file = await getRunFile(id);
  if (!file) return NextResponse.json({ error: "run not found" }, { status: 404 });
  const url = new URL(_req.url);
  if (url.searchParams.get("events") === "1") return NextResponse.json(file);
  return NextResponse.json(file.run);
}
