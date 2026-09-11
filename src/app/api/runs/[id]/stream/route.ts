import { getRunFile } from "@/lib/runs";

/**
 * Replays a run's event timeline as server-sent events, paced by each event's
 * `t` (seconds from start) divided by `speed`. `from` skips ahead: everything
 * at or before `from` is flushed immediately, then pacing resumes.
 *
 * A live pipeline run will use the same wire format, so the client has one
 * code path for demo replays and real runs.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const file = await getRunFile(id);
  if (!file) return new Response("run not found", { status: 404 });

  const url = new URL(req.url);
  const speed = Math.max(0.25, Math.min(256, Number(url.searchParams.get("speed") ?? 1) || 1));
  const from = Math.max(0, Number(url.searchParams.get("from") ?? 0) || 0);
  const events = file.events;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      const started = Date.now();
      let closed = false;
      const abort = () => {
        closed = true;
      };
      req.signal.addEventListener("abort", abort);
      try {
        send({ type: "hello", runId: file.run.id, speed, from, count: events.length });
        for (const e of events) {
          if (closed) break;
          const due = started + Math.max(0, (e.t - from) * 1000) / speed;
          const wait = due - Date.now();
          if (wait > 0) await new Promise((r) => setTimeout(r, wait));
          if (closed) break;
          send(e);
        }
      } finally {
        req.signal.removeEventListener("abort", abort);
        if (!closed) controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
