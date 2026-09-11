/**
 * Captures the hero screens at 1440×900 from a running dev server.
 *
 *   pnpm dev            # in another terminal
 *   pnpm tsx scripts/screenshots.ts [baseUrl] [outDir]
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3000";
const out = process.argv[3] ?? join(process.cwd(), "screenshots");
const RUN = process.env.DISTILL_RUN_ID ?? "fitness-demo";

type Shot = { name: string; path: string; settle?: number; action?: (page: import("playwright").Page) => Promise<void> };

/** Mid-run and finished frames are placed relative to the run's real duration. */
async function shotsFor(durationSeconds: number): Promise<Shot[]> {
  const mid = Math.round(durationSeconds * 0.55);
  const done = Math.ceil(durationSeconds);
  return [
  { name: "01-new-run", path: "/" },
  { name: "02-live-run-mid", path: `/runs/${RUN}/live?paused=1&at=${mid}`, settle: 1200 },
  {
    name: "03-live-run-done",
    path: `/runs/${RUN}/live?paused=1&at=${done}`,
    settle: 1200,
    action: async (page) => {
      await page.getByRole("button", { name: /log/ }).click();
      await page.waitForTimeout(400);
    },
  },
  { name: "04-dashboard", path: `/runs/${RUN}` },
  { name: "05-dashboard-drawer", path: `/runs/${RUN}?theme=t01`, settle: 600 },
  { name: "06-opportunity", path: `/runs/${RUN}/opportunities/first` },
  ];
}

async function main() {
  mkdirSync(out, { recursive: true });
  const runRes = await fetch(`${base}/api/runs/${RUN}`);
  if (!runRes.ok) throw new Error(`run ${RUN} not found at ${base}`);
  const run = (await runRes.json()) as { stats: { durationMs: number } };
  const SHOTS = await shotsFor(run.stats.durationMs / 1000);
  // PLAYWRIGHT_CHROMIUM_PATH lets a sandbox with a pre-installed Chromium skip the download.
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
  const browser = await chromium.launch({ executablePath });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  for (const s of SHOTS) {
    await page.goto(base + s.path, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(s.settle ?? 300);
    if (s.action) await s.action(page);
    const file = join(out, `${s.name}.png`);
    await page.screenshot({ path: file });
    console.log("wrote", file);
  }
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
