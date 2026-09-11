/**
 * Records the 45-second demo video from the real app in one continuous take:
 * intro card → New run → Live run (replay) → Dashboard + drawer → Opportunity →
 * outro card. Every frame is the actual product; a synthetic cursor is drawn so
 * viewers can follow the clicks.
 *
 *   pnpm build && pnpm start -p 3100     # in another terminal
 *   pnpm tsx scripts/video/record.ts [baseUrl] [outDir]
 *
 * Writes <outDir>/distill-demo.webm (raw capture) and, when a full ffmpeg is
 * available (@ffmpeg-installer/ffmpeg), <outDir>/distill-demo.mp4 plus a poster.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, type Page } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const base = process.argv[2] ?? "http://localhost:3100";
const out = resolve(process.argv[3] ?? join(here, "..", "..", "promo"));
const RUN = process.env.DISTILL_RUN_ID ?? "fitness";
const W = 1600;
const H = 900;
const cardsUrl = pathToFileURL(join(here, "cards.html")).href;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A visible cursor: a fixed-position layer that glides to wherever we click. */
const CURSOR_JS = `
(() => {
  if (window.__cursor) return;
  const el = document.createElement('div');
  el.id = '__cursor';
  el.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:30px;z-index:2147483647;pointer-events:none;transform:translate(-3px,-2px);transition:left .55s cubic-bezier(.2,.7,.2,1),top .55s cubic-bezier(.2,.7,.2,1),opacity .3s;opacity:0;filter:drop-shadow(0 2px 4px rgba(0,0,0,.6))';
  el.innerHTML = '<svg width="22" height="30" viewBox="0 0 22 30"><path d="M2 2 L2 24 L8 18.5 L12 27 L15.5 25.5 L11.5 17 L19 17 Z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  const ring = document.createElement('div');
  ring.id = '__cursor_ring';
  ring.style.cssText = 'position:fixed;width:34px;height:34px;border-radius:50%;border:2px solid #ff6b35;z-index:2147483646;pointer-events:none;transform:translate(-50%,-50%) scale(.4);opacity:0;';
  document.documentElement.appendChild(el);
  document.documentElement.appendChild(ring);
  window.__cursor = {
    move(x, y) { el.style.opacity = '1'; el.style.left = x + 'px'; el.style.top = y + 'px'; },
    click(x, y) {
      ring.style.transition = 'none'; ring.style.left = x + 'px'; ring.style.top = y + 'px';
      ring.style.transform = 'translate(-50%,-50%) scale(.4)'; ring.style.opacity = '.9';
      requestAnimationFrame(() => { ring.style.transition = 'transform .45s ease-out, opacity .45s ease-out'; ring.style.transform = 'translate(-50%,-50%) scale(1.6)'; ring.style.opacity = '0'; });
    },
    hide() { el.style.opacity = '0'; },
  };
})();`;

async function cursorTo(page: Page, x: number, y: number, settle = 650) {
  await page.evaluate(([cx, cy]) => window.__cursor?.move(cx, cy), [x, y] as const);
  await page.mouse.move(x, y, { steps: 12 });
  await sleep(settle);
}

async function clickAt(page: Page, x: number, y: number, settle = 650) {
  await cursorTo(page, x, y, settle);
  await page.evaluate(([cx, cy]) => window.__cursor?.click(cx, cy), [x, y] as const);
  await page.mouse.click(x, y);
}

async function clickText(page: Page, text: string | RegExp, opts: { settle?: number; nth?: number } = {}) {
  const loc = page.getByText(text, { exact: typeof text === "string" }).nth(opts.nth ?? 0);
  await loc.waitFor({ state: "visible", timeout: 15000 });
  const box = await loc.boundingBox();
  if (!box) throw new Error(`no box for ${String(text)}`);
  await clickAt(page, box.x + box.width / 2, box.y + box.height / 2, opts.settle);
}

async function card(page: Page, id: "intro" | "outro", holdMs: number) {
  await page.goto(`${cardsUrl}#${id}`, { waitUntil: "load" });
  await page.evaluate((which) => {
    for (const c of document.querySelectorAll<HTMLElement>(".card")) c.hidden = c.id !== which;
    document.fonts.ready.then(() => document.getElementById(`${which}-fade`)?.classList.remove("on"));
  }, id);
  await page.evaluate(() => document.fonts.ready);
  await sleep(holdMs);
  await page.evaluate((which) => document.getElementById(`${which}-fade`)?.classList.add("on"), id);
  await sleep(700);
}

async function main() {
  mkdirSync(out, { recursive: true });
  const videoDir = join(out, ".capture");
  mkdirSync(videoDir, { recursive: true });

  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    recordVideo: { dir: videoDir, size: { width: W, height: H } },
    colorScheme: "dark",
  });
  await context.addInitScript(CURSOR_JS);
  const page = await context.newPage();

  // 0. Intro card (≈4.5s)
  await card(page, "intro", 3800);

  // 1. New run (≈6s): land, glance at the dataset, run it.
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await sleep(900);
  await cursorTo(page, 330, 560, 900); // the selected dataset card
  await clickText(page, "Run analysis", { settle: 900 });

  // 2. Live run (≈15s): watch at 1×, then speed up and finish.
  await page.waitForURL(/\/live/);
  await page.getByText("EXTRACTION STREAM").waitFor();
  await sleep(9000);
  await clickText(page, "4×", { settle: 500 });
  await page.getByText("View results").waitFor({ timeout: 30000 });
  await sleep(1400);
  await clickText(page, /View results/, { settle: 700 });

  // 3. Dashboard (≈9s): take it in, open the evidence drawer, jump to the opportunity.
  await page.waitForURL(new RegExp(`/runs/${RUN}$`));
  await page.getByText("Impact matrix", { exact: false }).first().waitFor();
  await sleep(1800);
  await cursorTo(page, 520, 330, 500);
  await clickText(page, /^Apple Watch sets fail to sync$/, { settle: 500 });
  await sleep(2600);
  await clickText(page, /View opportunity/, { settle: 700 });

  // 4. Opportunity (≈8s): read the title, scroll the evidence.
  await page.waitForURL(/\/opportunities\//);
  await page.getByText("Evidence", { exact: true }).waitFor();
  await sleep(2200);
  await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>("main")?.closest<HTMLElement>(".overflow-auto") ?? null;
    el?.scrollTo({ top: 520, behavior: "smooth" });
  });
  await sleep(2600);
  await page.evaluate(() => window.__cursor?.hide());
  await sleep(600);

  // 5. Outro card (≈5s)
  await card(page, "outro", 4200);

  await context.close();
  await browser.close();

  // Playwright names the capture itself; pick the newest webm.
  const webm = readdirSync(videoDir)
    .filter((f) => f.endsWith(".webm"))
    .map((f) => join(videoDir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  if (!webm) throw new Error("no capture produced");
  const rawOut = join(out, "distill-demo.webm");
  copyFileSync(webm, rawOut);
  console.log("wrote", rawOut);

  // Transcode to H.264 MP4 when a full ffmpeg is installed.
  let ffmpeg: string | null = null;
  try {
    ffmpeg = (await import("@ffmpeg-installer/ffmpeg")).default.path;
  } catch {
    ffmpeg = null;
  }
  if (!ffmpeg || !existsSync(ffmpeg)) {
    console.log("no full ffmpeg available; skipped MP4 (pnpm add -D @ffmpeg-installer/ffmpeg)");
    return;
  }
  const mp4 = join(out, "distill-demo.mp4");
  execFileSync(ffmpeg, [
    "-y", "-i", rawOut,
    "-vf", "fps=30,format=yuv420p",
    "-c:v", "libx264", "-preset", "slow", "-crf", "19", "-movflags", "+faststart",
    "-an", mp4,
  ], { stdio: "inherit" });
  console.log("wrote", mp4);
  const poster = join(out, "distill-demo-poster.png");
  execFileSync(ffmpeg, ["-y", "-ss", "15", "-i", mp4, "-frames:v", "1", poster], { stdio: "ignore" });
  console.log("wrote", poster);
}

declare global {
  interface Window {
    __cursor?: { move(x: number, y: number): void; click(x: number, y: number): void; hide(): void };
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
