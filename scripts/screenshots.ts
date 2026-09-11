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

const SHOTS: { name: string; path: string; settle?: number; action?: (page: import("playwright").Page) => Promise<void> }[] = [
  { name: "01-new-run", path: "/" },
  { name: "02-live-run-mid", path: `/runs/${RUN}/live?paused=1&at=24`, settle: 1200 },
  {
    name: "03-live-run-done",
    path: `/runs/${RUN}/live?paused=1&at=41`,
    settle: 1200,
    action: async (page) => {
      await page.getByRole("button", { name: /log/ }).click();
      await page.waitForTimeout(400);
    },
  },
  { name: "04-dashboard", path: `/runs/${RUN}` },
  { name: "05-dashboard-drawer", path: `/runs/${RUN}?theme=t01`, settle: 600 },
  { name: "06-opportunity", path: `/runs/${RUN}/opportunities/o01` },
];

async function main() {
  mkdirSync(out, { recursive: true });
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
