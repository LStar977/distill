/**
 * Builds design/fixture/fitness-demo.json from the numbers in the design handoff
 * (design/handoff/project/DistillApp.dc.html, THEMES / TRANS / REVIEWS / OPPS /
 * LOG / PROC). The output is a RunFile on the same event schema the real
 * pipeline emits. It was the demo until the real run landed; it stays as a
 * reference for the design's intended shape and as a replay-reducer fixture.
 *
 *   pnpm tsx scripts/build-demo-fixture.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Evidence,
  Extraction,
  Item,
  Opportunity,
  OpportunityFactor,
  PipelineEvent,
  Run,
  RunFile,
  Sentiment,
  Severity,
  Theme,
} from "../src/lib/types";

const here = dirname(fileURLToPath(import.meta.url));
// Kept under design/ as the design-derived reference; the app serves real runs from data/runs.
const OUT = join(here, "..", "design", "fixture", "fitness-demo.json");

const TOTAL = 3214;
const BATCH = 20;
const BATCHES = Math.ceil(TOTAL / BATCH); // 161

// ---------------------------------------------------------------------------
// Source data, transcribed from the handoff.
// ---------------------------------------------------------------------------

interface ThemeSeed {
  n: string;
  sh: string;
  desc: string;
  c: number;
  s: Sentiment;
  sa: number;
  /** Processed-count at which the theme first appears in the stream. */
  disc: number;
  sp: [number, number, number];
  tr: number[];
  other?: boolean;
}

const THEMES: ThemeSeed[] = [
  { n: "Rest timer unreliable in background", sh: "Rest timer", desc: "The rest timer stops, resets, or fails to notify once the phone locks or another app comes to the foreground.", c: 412, s: "negative", sa: 4.1, disc: 40, sp: [6, 12, 82], tr: [3, 3, 4, 4, 5, 6, 7, 8] },
  { n: "Apple Watch sync drops sets", sh: "Watch sync", desc: "Sets logged on the Watch arrive on the phone late, duplicated, or never.", c: 388, s: "negative", sa: 3.9, disc: 60, sp: [5, 10, 85], tr: [2, 3, 3, 5, 6, 6, 7, 7] },
  { n: "Subscription price vs. value", sh: "Subscription", desc: "Users question the annual price against what the free tier already does; some defend it.", c: 351, s: "mixed", sa: 3.0, disc: 120, sp: [34, 22, 44], tr: [4, 4, 5, 5, 6, 6, 6, 7] },
  { n: "Import from other trackers is missing", sh: "Import", desc: "Switchers cannot bring years of history from competing apps.", c: 297, s: "negative", sa: 3.2, disc: 150, sp: [4, 18, 78], tr: [5, 5, 5, 5, 5, 6, 5, 6] },
  { n: "Plate calculator loved", sh: "Plate calc", desc: "The plate calculator is called out as a favourite feature.", c: 240, s: "positive", sa: 1.3, disc: 200, sp: [88, 9, 3], tr: [3, 4, 4, 5, 5, 5, 6, 6] },
  { n: "Wants superset / circuit support", sh: "Supersets", desc: "No way to group exercises; users log separate blocks and fight the rest timer.", c: 221, s: "negative", sa: 2.2, disc: 260, sp: [10, 30, 60], tr: [3, 3, 4, 4, 4, 5, 5, 5] },
  { n: "Exercise library gaps (cables, machines)", sh: "Library gaps", desc: "Common gym machines and cable variants are missing, forcing custom entries.", c: 198, s: "negative", sa: 2.9, disc: 330, sp: [8, 32, 60], tr: [4, 4, 4, 4, 5, 5, 5, 5] },
  { n: "Progress charts praised", sh: "Charts", desc: "Trend and volume charts are praised for making plateaus visible.", c: 176, s: "positive", sa: 1.2, disc: 1950, sp: [84, 12, 4], tr: [3, 3, 4, 4, 4, 5, 5, 5] },
  { n: "Crashes on iOS 18 beta", sh: "iOS 18 crashes", desc: "Crash on launch for users on the iOS 18 beta; sharp rise in the last two months.", c: 143, s: "negative", sa: 4.8, disc: 2000, sp: [1, 4, 95], tr: [0, 0, 0, 0, 1, 2, 6, 9] },
  { n: "Dark mode requests", sh: "Dark mode", desc: "Requests for a dark theme, usually from early-morning lifters.", c: 120, s: "neutral", sa: 1.9, disc: 2100, sp: [20, 60, 20], tr: [2, 2, 3, 3, 3, 3, 4, 4] },
  { n: "Onboarding too long", sh: "Onboarding", desc: "Too many screens before the first set can be logged.", c: 97, s: "negative", sa: 2.4, disc: 2300, sp: [5, 25, 70], tr: [3, 3, 3, 3, 3, 3, 3, 3] },
  { n: "Wants coach / program sharing", sh: "Coach sharing", desc: "Users want a coach or partner to push a program into the app.", c: 88, s: "neutral", sa: 2.1, disc: 2500, sp: [30, 55, 15], tr: [2, 2, 2, 3, 3, 3, 3, 4] },
  { n: "Widget requests", sh: "Widgets", desc: "Requests for lock-screen and home-screen widgets.", c: 61, s: "neutral", sa: 1.5, disc: 2800, sp: [25, 60, 15], tr: [1, 1, 2, 2, 2, 2, 3, 3] },
  { n: "Other / uncategorized", sh: "Other", desc: "Feedback that did not map to a theme with enough support.", c: 422, s: "neutral", sa: 2.0, disc: 30, sp: [40, 40, 20], tr: [5, 5, 5, 5, 5, 5, 5, 5], other: true },
];

/** Raw labels the extractor proposed outside the taxonomy; merged away in Cluster. */
const TRANS = [
  { n: "timer bugs", c: 60, parent: 0, disc: 540, mergeT: 31.2, sim: 0.91 },
  { n: "watch disconnects", c: 45, parent: 1, disc: 820, mergeT: 32.0, sim: 0.88 },
  { n: "too expensive", c: 50, parent: 2, disc: 1040, mergeT: 33.1, sim: 0.86 },
];

type ReviewSeed = [app: string, rating: number, date: string, pre: string, quote: string, post: string, s: Sentiment, themes: number[], sev: Severity];
const REVIEWS: ReviewSeed[] = [
  ["IronLog", 2, "14 Mar 2026", "Great logging but ", "the rest timer just stops counting the second I lock my phone", ". Missed my 3-minute rest twice.", "negative", [0], 4],
  ["SetCount", 1, "2 Jun 2026", "", "Lost an entire leg day because the Watch dropped half my sets on sync", ". Not the first time.", "negative", [1], 4],
  ["LiftLab", 3, "21 Nov 2025", "Solid app. ", "$79 a year feels steep when the free version already does 80% of what I need", ".", "mixed", [2], 3],
  ["IronLog", 2, "8 Jan 2026", "", "Two years of Strong data and no way to import it", ". Starting from zero is a dealbreaker.", "negative", [3], 3],
  ["SetCount", 5, "30 Aug 2026", "", "The plate calculator alone is worth the download", ", saves me doing math between sets.", "positive", [4], 1],
  ["LiftLab", 3, "17 Feb 2026", "Wish I could ", "group exercises into a superset instead of logging them as separate blocks", ".", "negative", [5], 2],
  ["IronLog", 3, "5 Oct 2025", "", "Half the cable machines at my gym aren’t in the library", " so I end up with a dozen custom entries.", "negative", [6], 3],
  ["SetCount", 5, "12 Jul 2026", "", "The progress charts finally made my plateau obvious", ". Deloaded, back to PRs.", "positive", [7], 1],
  ["LiftLab", 1, "26 Aug 2026", "", "Crashes on launch since the iOS 18 beta", ", every single time.", "negative", [8], 5],
  ["IronLog", 4, "9 Dec 2025", "Love it, but ", "please add a dark mode, the white screen at 6am is brutal", ".", "neutral", [9], 2],
  ["SetCount", 2, "3 May 2026", "", "The rest timer notification never fires when the app is in the background", ". Have to keep the screen on.", "negative", [0], 4],
  ["LiftLab", 2, "19 Apr 2026", "", "Sets logged on the Watch show up on the phone minutes later, or not at all", ".", "negative", [1], 4],
  ["IronLog", 3, "28 Sep 2025", "", "Fifteen onboarding screens before I could log a single set", " is too many.", "negative", [10], 2],
  ["SetCount", 4, "15 Jan 2026", "Would pay extra if ", "my coach could push a program straight into the app", ".", "neutral", [11], 2],
  ["LiftLab", 4, "7 Aug 2026", "", "A lock-screen widget for the current set would be perfect", ".", "neutral", [12], 1],
  ["IronLog", 1, "22 Jun 2026", "", "Paying monthly and the timer still resets itself in the background", ". Fix the basics first.", "negative", [0, 2], 4],
  ["SetCount", 5, "11 Nov 2025", "", "Plate math done for me", ", tiny feature, huge quality of life.", "positive", [4], 1],
  ["LiftLab", 2, "4 Mar 2026", "", "Import from Hevy failed on every CSV I tried", ".", "negative", [3], 3],
  ["IronLog", 3, "16 May 2026", "", "Circuits are impossible to log", " without the rest timer going off between every movement.", "negative", [5, 0], 2],
  ["SetCount", 4, "1 Feb 2026", "Good app overall. ", "Charts are clean and the trend line is honest", ".", "positive", [7], 1],
  ["LiftLab", 2, "24 Jul 2026", "", "Watch app lost connection mid-set three times today", ".", "negative", [1], 4],
  ["IronLog", 5, "13 Oct 2025", "Been using it a year. ", "Worth every cent of the subscription", ".", "positive", [2], 1],
  ["SetCount", 3, "27 Dec 2025", "", "No Smith machine variants in the exercise list", ".", "negative", [6], 3],
  ["LiftLab", 4, "18 Aug 2026", "Nice update. ", "Still no way to share a program with my training partner", ".", "neutral", [11], 2],
  ["SetCount", 2, "6 Apr 2026", "", "Timer dies if I switch to Spotify for ten seconds", ".", "negative", [0], 4],
  ["IronLog", 1, "29 Jul 2026", "", "Rest timer is the whole reason I use an app and it can’t survive a screen lock", ".", "negative", [0], 4],
];

interface OppSeed {
  title: string;
  problem: string;
  score: number;
  th: number;
  f: [OpportunityFactor["name"], string, string][];
  conf: Opportunity["confidence"];
  segs: [string, number][];
  direction: string;
  validate: string[];
  effort: Opportunity["effort"];
  impact: Opportunity["impact"];
  related: number[];
  ev: number[];
}

const OPPS: OppSeed[] = [
  { title: "Make the rest timer bulletproof in the background", problem: "Paying users lose rest-timer accuracy the moment the phone locks or another app comes to the foreground. 412 reviews (12.8%) cite it, average severity 4.1, and the share is rising.", score: 92, th: 0, f: [["Frequency", "0.94", "412 mentions · ranked #1 of 14"], ["Severity", "0.80", "avg. 4.1 / 5"], ["Recency", "0.88", "rising in 3 of the last 4 months"], ["Strategic fit", "0.92", "matches “fix before the annual-pricing push”"]], conf: "High", segs: [["iOS", 71], ["Paid subscribers", 63], ["Apple Watch owners", 44]], direction: "Move the timer off the foreground process: schedule a local notification at set start and reconcile on resume instead of counting in-app. Surface the remaining time on the lock screen as a Live Activity so users stop keeping the screen on.", validate: ["Share of timer complaints that are background-specific vs. notification-permission issues", "Whether Live Activities are viable on the minimum supported iOS version", "Effect on battery complaints, currently 1.1% of reviews"], effort: "M", impact: "XL", related: [5, 1, 2], ev: [0, 10, 15, 18, 24, 25] },
  { title: "Fix Watch set-sync reliability", problem: "Sets logged on Apple Watch arrive on the phone late or never. 388 reviews (12.1%), average severity 3.9, concentrated in SetCount and LiftLab.", score: 89, th: 1, f: [["Frequency", "0.90", "388 mentions · ranked #2 of 14"], ["Severity", "0.78", "avg. 3.9 / 5"], ["Recency", "0.84", "steady over 14 months"], ["Strategic fit", "0.90", "Watch is the paid differentiator"]], conf: "High", segs: [["Apple Watch owners", 100], ["Paid subscribers", 58], ["iOS 17+", 82]], direction: "Make the Watch the source of truth during a session and reconcile to the phone with an explicit sync state, so a dropped connection queues sets instead of losing them.", validate: ["Whether drops correlate with watchOS version or with phone-locked state", "How many affected users are on the paid tier"], effort: "L", impact: "L", related: [0, 8], ev: [1, 11, 20] },
  { title: "One-tap import from competitors", problem: "Switchers arrive with years of history and no way to bring it. 297 reviews (9.2%), severity 3.2, most common in 1–2 star reviews.", score: 81, th: 3, f: [["Frequency", "0.82", "297 mentions · ranked #4 of 14"], ["Severity", "0.64", "avg. 3.2 / 5"], ["Recency", "0.72", "flat"], ["Strategic fit", "0.95", "blocks new paid sign-ups"]], conf: "High", segs: [["New users (< 30 days)", 68], ["Named a competitor", 54], ["Paid subscribers", 22]], direction: "Ship CSV import mapped from the three most-named trackers, with a preview step that shows how many workouts were matched before committing.", validate: ["Which competitors are named most often", "Whether their export formats are stable enough to maintain"], effort: "M", impact: "L", related: [2], ev: [3, 17] },
  { title: "Supersets and circuits", problem: "Users can’t log grouped movements; they log separate blocks and fight the rest timer. 221 reviews (6.9%), severity 2.2.", score: 74, th: 5, f: [["Frequency", "0.62", "221 mentions · ranked #6 of 14"], ["Severity", "0.44", "avg. 2.2 / 5"], ["Recency", "0.70", "rising slowly"], ["Strategic fit", "0.80", "retention feature for intermediate lifters"]], conf: "Medium", segs: [["Intermediate+ lifters", 61], ["iOS", 74], ["Paid subscribers", 49]], direction: "Add a grouping primitive at set level (superset / circuit) with a shared rest timer. The logging UI stays the same; the timer just knows which set is next.", validate: ["Whether users want a shared rest timer or per-exercise timers", "Overlap with the rest-timer opportunity"], effort: "M", impact: "M", related: [0, 6], ev: [5, 18] },
  { title: "Re-tier the subscription", problem: "Price is questioned more than the product. 351 reviews (10.9%) mention it, split 34% positive / 44% negative.", score: 70, th: 2, f: [["Frequency", "0.86", "351 mentions · ranked #3 of 14"], ["Severity", "0.60", "avg. 3.0 / 5"], ["Recency", "0.66", "spikes at renewal months"], ["Strategic fit", "0.70", "direct input to the pricing push"]], conf: "Medium", segs: [["Free-tier users", 58], ["3-star reviews", 47], ["Paid subscribers", 42]], direction: "Move plate calculator and charts into the free tier, keep Watch sync and import paid, and test a monthly price point below the current one.", validate: ["Which features free-tier users mention as blocked", "Churn timing relative to the annual renewal"], effort: "S", impact: "L", related: [4, 7, 3], ev: [2, 21, 15] },
  { title: "Cable and machine library expansion", problem: "Gym equipment isn’t in the library, so users create custom entries that break their charts. 198 reviews (6.2%), severity 2.9.", score: 58, th: 6, f: [["Frequency", "0.55", "198 mentions · ranked #7 of 14"], ["Severity", "0.58", "avg. 2.9 / 5"], ["Recency", "0.52", "flat"], ["Strategic fit", "0.65", "quality-of-life, not a driver"]], conf: "Medium", segs: [["Commercial gym members", 77], ["iOS", 69], ["Paid subscribers", 51]], direction: "Add the top 60 missing cable and machine variants and merge existing custom entries into them by name.", validate: ["Which custom entries recur across users", "Whether charts survive the merge"], effort: "S", impact: "M", related: [7, 5], ev: [6, 22] },
];

const LOG: [number, string][] = [
  [0.4, "Parsed 3,214 rows from fitness-tracker-reviews.csv · 3 apps · 14 months"],
  [1.2, "Normalized dates and ratings · 0 rows dropped"],
  [1.9, "Sampling 200 reviews to draft a taxonomy…"],
  [3.6, "Drafted taxonomy: 9 candidate themes + other"],
  [4.2, "Extracting in batches of 20 · 161 batches · taxonomy prompt cached"],
  [6.8, "Cache warm · hit rate 41% and climbing"],
  [9.9, "Batch 27 proposed a label outside the taxonomy: 'timer bugs' · keeping as raw"],
  [12.9, "Batch 41 proposed 'watch disconnects' · keeping as raw"],
  [15.3, "Batch 52 proposed 'too expensive' · keeping as raw"],
  [20.3, "1,500 processed · 11 raw themes · $0.91 so far"],
  [23.7, "Batch 92 done · cache hit rate 78%"],
  [24.5, "New theme from batch 98: 'Progress charts praised'"],
  [24.9, "New theme from batch 100: 'Crashes on iOS 18 beta' · severity 5 flagged"],
  [25.2, "New theme: 'Dark mode requests'"],
  [26.1, "New theme: 'Onboarding too long'"],
  [27.0, "New theme: 'Wants coach / program sharing'"],
  [28.3, "New theme: 'Widget requests'"],
  [30.0, "Extraction complete · 3,214 / 3,214 · 0 failures · 2 retries"],
  [30.5, "Consolidating 17 raw themes…"],
  [31.2, "Merged 'timer bugs' into 'Rest timer unreliable in background' (0.91 similarity)"],
  [32.0, "Merged 'watch disconnects' into 'Apple Watch sync drops sets' (0.88)"],
  [33.1, "Merged 'too expensive' into 'Subscription price vs. value' (0.86)"],
  [35.2, "14 themes final · writing names and descriptions"],
  [36.3, "Scoring: frequency × severity × recency × strategic fit (from your product context)"],
  [37.6, "6 opportunities above threshold (score ≥ 55) · top: 92, 89, 81"],
  [38.4, "Writing brief · every claim mapped to source item IDs…"],
  [40.2, "Eval against 50-item golden set: precision 0.91 · recall 0.87"],
  [41.0, "Done · 14 themes · 6 opportunities · 41s · $1.87"],
];

// ---------------------------------------------------------------------------
// Curves (piecewise linear, from the handoff's PROC and counter interpolation).
// ---------------------------------------------------------------------------

type PW = [number, number][];
const lerp = (a: number, b: number, x: number) => a + (b - a) * x;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const pw = (t: number, p: PW) => {
  if (t <= p[0][0]) return p[0][1];
  for (let i = 1; i < p.length; i++) {
    if (t <= p[i][0]) {
      const [t0, v0] = p[i - 1];
      const [t1, v1] = p[i];
      return lerp(v0, v1, (t - t0) / (t1 - t0));
    }
  }
  return p[p.length - 1][1];
};
const TIN: PW = [[2, 0], [24, 1.2e6], [30, 1.72e6], [41, 1.9e6]];
const TOUT: PW = [[2, 0], [24, 121e3], [30, 168e3], [41, 210e3]];
const COST: PW = [[2, 0], [24, 1.12], [30, 1.55], [41, 1.87]];
const CACHE: PW = [[2, 0], [5, 41], [12, 66], [24, 78], [41, 78]];
/** Inverse of PROC: the time at which `n` items have been processed. */
const timeAtProcessed = (n: number) => (n <= 1847 ? 4 + (n / 1847) * 20 : 24 + ((n - 1847) / 1367) * 6);

const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;

// ---------------------------------------------------------------------------
// Items and extractions (the 26 verbatim reviews).
// ---------------------------------------------------------------------------

const MONTHS: Record<string, string> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
const isoDate = (d: string) => {
  const [day, mon, year] = d.split(" ");
  return `${year}-${MONTHS[mon]}-${day.padStart(2, "0")}`;
};
const itemId = (i: number) => `fit-${String(i + 1).padStart(4, "0")}`;
const themeId = (i: number) => `t${String(i + 1).padStart(2, "0")}`;
const oppId = (i: number) => `o${String(i + 1).padStart(2, "0")}`;

const items: Record<string, Item> = {};
const extractions: Record<string, Extraction> = {};
REVIEWS.forEach((r, i) => {
  const [app, rating, date, pre, quote, post, s, th, sev] = r;
  const id = itemId(i);
  const text = pre + quote + post;
  items[id] = { id, source: app, text, rating, date: isoDate(date) };
  extractions[id] = {
    itemId: id,
    sentiment: s,
    severity: sev,
    themes: th.map((k) => THEMES[k].n),
    painPoints: s === "positive" ? [] : [THEMES[th[0]].sh.toLowerCase()],
    featureRequests: /wants|requests|missing/i.test(THEMES[th[0]].n) ? [THEMES[th[0]].sh.toLowerCase()] : [],
    quotes: [{ start: pre.length, end: pre.length + quote.length, text: quote }],
    segments: [rating <= 2 ? "detractor" : rating >= 4 ? "promoter" : "passive"],
  };
});

const evidenceFor = (i: number): Evidence => {
  const [, , , pre, quote, post] = REVIEWS[i];
  return { itemId: itemId(i), pre, quote, post };
};

// ---------------------------------------------------------------------------
// Final run.
// ---------------------------------------------------------------------------

const themes: Theme[] = THEMES.map((t, i) => {
  const oppIdx = OPPS.findIndex((o) => o.th === i);
  return {
    id: themeId(i),
    rank: i + 1,
    name: t.n,
    short: t.sh,
    description: t.desc,
    count: t.c,
    share: r2((t.c / TOTAL) * 100) / 100,
    sentiment: t.s,
    sentimentSplit: t.sp,
    severityAvg: t.sa,
    trend: t.tr,
    exampleItemIds: REVIEWS.map((r, k) => (r[7].includes(i) ? itemId(k) : null)).filter((x): x is string => x !== null),
    opportunityId: oppIdx >= 0 ? oppId(oppIdx) : undefined,
    other: t.other,
  };
});

const opportunities: Opportunity[] = OPPS.map((o, i) => ({
  id: oppId(i),
  rank: i + 1,
  title: o.title,
  problem: o.problem,
  score: o.score,
  factors: o.f.map(([name, val, note]) => ({ name, value: Number(val), note })),
  confidence: o.conf,
  segments: o.segs.map(([name, share]) => ({ name, share })),
  evidence: o.ev.map(evidenceFor),
  direction: o.direction,
  validate: o.validate,
  effort: o.effort,
  impact: o.impact,
  themeIds: [themeId(o.th)],
  relatedThemeIds: o.related.map(themeId),
}));

const briefMarkdown = `# Fitness tracker app reviews — decision brief

**Run #12 · 3,214 reviews · IronLog, SetCount, LiftLab · 14 months ending 9 Sep 2026**

## Executive summary

Three reliability problems account for a third of all negative feedback and all three sit squarely on the paid tier. The rest timer failing in the background (412 mentions, 12.8%) and the Apple Watch dropping sets on sync (388, 12.1%) are the two most-cited issues in the dataset, both rated severity 4 on average, and both are rising. The third, subscription price versus value (351, 10.9%), is the only theme where sentiment is genuinely split: a third of the people who mention price defend it, and most of them mention a feature they love in the same breath.

The recommendation is to fix the two reliability problems before the annual-pricing push, then re-tier rather than re-price. Import from competing trackers is the clearest acquisition blocker and should follow immediately after.

## Top opportunities

### 1. Make the rest timer bulletproof in the background · 92
Paying users lose rest-timer accuracy the moment the phone locks or another app comes to the foreground. 412 reviews cite it, average severity 4.1, share rising in three of the last four months. [item:fit-0001] [item:fit-0011] [item:fit-0016] [item:fit-0026]

Direction: move the timer off the foreground process. Schedule a local notification at set start and reconcile on resume instead of counting in-app; surface remaining time as a Live Activity so users stop keeping the screen on. Effort M, impact XL.

### 2. Fix Watch set-sync reliability · 89
Sets logged on Apple Watch arrive late or never. 388 reviews, severity 3.9, concentrated in SetCount and LiftLab. Every affected reviewer is a Watch owner and 58% are paid. [item:fit-0002] [item:fit-0012] [item:fit-0021]

Direction: make the Watch the source of truth during a session and reconcile to the phone with an explicit sync state, so a dropped connection queues sets instead of losing them. Effort L, impact L.

### 3. One-tap import from competitors · 81
Switchers arrive with years of history and no way to bring it. 297 reviews, severity 3.2, most common in 1–2 star reviews from users under 30 days old. [item:fit-0004] [item:fit-0018]

Direction: CSV import mapped from the three most-named trackers, with a preview step showing how many workouts matched before committing. Effort M, impact L.

### 4. Supersets and circuits · 74
Users cannot log grouped movements; they log separate blocks and fight the rest timer. 221 reviews, severity 2.2. [item:fit-0006] [item:fit-0019]

Direction: a grouping primitive at set level with a shared rest timer. Effort M, impact M.

### 5. Re-tier the subscription · 70
Price is questioned more than the product. 351 reviews, split 34% positive / 44% negative. [item:fit-0003] [item:fit-0022] [item:fit-0016]

Direction: move the plate calculator and charts into the free tier, keep Watch sync and import paid, and test a lower monthly price point. Effort S, impact L.

### 6. Cable and machine library expansion · 58
Gym equipment is missing from the library, so users create custom entries that fragment their charts. 198 reviews, severity 2.9. [item:fit-0007] [item:fit-0023]

Direction: add the top 60 missing cable and machine variants and merge existing custom entries by name. Effort S, impact M.

## Theme overview

Fourteen themes were found. Two are positive and should be protected: the plate calculator (240 mentions, 88% positive) and progress charts (176, 84% positive) are the features people name when defending the price. One theme is small but urgent: crashes on the iOS 18 beta (143 mentions) went from zero to the fastest-rising theme in two months and carries the highest severity in the dataset at 4.8. It did not become an opportunity because it is a defect to fix this week rather than a product decision, but it should not wait for the roadmap.

The remaining themes are feature requests with steady, modest support: dark mode (120), onboarding length (97), coach and program sharing (88), and widgets (61).

## Methodology

3,214 items were extracted in batches of 20 with a taxonomy drafted from a 200-item sample. Seventeen raw labels were consolidated to fourteen themes; three off-taxonomy labels were merged into existing themes at similarity 0.86–0.91. Opportunities were scored on frequency × severity × recency × strategic fit against the stated product context. Against a 50-item hand-labelled golden set, theme assignment scored 91% precision and 87% recall. The run took 41 seconds and cost $1.87 with a 78% prompt-cache hit rate.

## Evidence appendix

Every claim above maps to a source item id. The 26 items cited inline are reproduced in full in the run record; the remaining 3,188 are available in the dataset export.
`;

const wordCount = briefMarkdown.split(/\s+/).filter(Boolean).length;

const run: Run = {
  id: "fitness-demo",
  number: 12,
  datasetId: "fitness",
  datasetName: "Fitness tracker app reviews",
  sources: ["IronLog", "SetCount", "LiftLab"],
  context: {
    product: "IronLog is a paid workout tracker for strength athletes on iOS and Apple Watch. We're deciding what to fix before the next annual-pricing push.",
  },
  settings: { depth: "thorough", cap: TOTAL },
  status: "done",
  startedAt: "2026-09-09T16:12:04.000Z",
  finishedAt: "2026-09-09T16:12:45.000Z",
  stats: {
    items: TOTAL,
    themes: 14,
    opportunities: 6,
    tokensIn: 1_900_000,
    tokensOut: 210_000,
    costUsd: 1.87,
    cacheHitRate: 0.78,
    durationMs: 41_000,
    stageDurationsMs: { ingest: 2_000, extract: 28_000, cluster: 6_000, rank: 2_000, brief: 3_000 },
  },
  eval: { n: 50, themePrecision: 0.91, themeRecall: 0.87, sentimentAccuracy: 0.94 },
  themes,
  opportunities,
  brief: { markdown: briefMarkdown, wordCount },
  items,
  extractions,
  demo: true,
};

// ---------------------------------------------------------------------------
// Event timeline.
// ---------------------------------------------------------------------------

const events: PipelineEvent[] = [];
const push = (e: PipelineEvent) => events.push(e);

const counters = (t: number, processed: number) =>
  push({
    t: r1(t),
    type: "counters",
    processed,
    tokensIn: Math.round(pw(t, TIN)),
    tokensOut: Math.round(pw(t, TOUT)),
    costUsd: r2(pw(t, COST)),
    cacheHitRate: r2(pw(t, CACHE) / 100),
  });

// Count of a theme at a given processed count, before any merges.
const growth = (base: number, disc: number, processed: number) =>
  processed > disc ? Math.round(base * Math.min(1, (processed - disc) / (TOTAL - disc))) : 0;

const lastCount = new Map<string, number>();
const themeEvent = (t: number, id: string, seed: { n: string; sh: string; s: Sentiment; sa: number; other?: boolean }, count: number, transient?: { parentId: string }) => {
  if (count <= 0 || lastCount.get(id) === count) return;
  lastCount.set(id, count);
  push({
    t: r1(t),
    type: "theme",
    themeId: id,
    name: seed.n,
    short: seed.sh,
    count,
    sentiment: seed.s,
    severityAvg: seed.sa,
    ...(seed.other ? { other: true } : {}),
    ...(transient ? { transient: true, parentId: transient.parentId } : {}),
  });
};

const emitThemesAt = (t: number, processed: number) => {
  THEMES.forEach((th, i) => {
    const tr = TRANS.find((x) => x.parent === i);
    const base = th.c - (tr ? tr.c : 0);
    themeEvent(t, themeId(i), th, growth(base, th.disc, processed));
  });
  TRANS.forEach((x, k) => {
    const p = THEMES[x.parent];
    themeEvent(t, `x${k + 1}`, { n: x.n, sh: x.n, s: p.s, sa: p.sa }, growth(x.c, x.disc, processed), { parentId: themeId(x.parent) });
  });
};

// Stage: ingest
push({ t: 0, type: "stage", stage: "ingest", status: "running" });
push({ t: 2.0, type: "stage", stage: "ingest", status: "done", note: "3,214 items · 2.0s" });
push({ t: 2.0, type: "stage", stage: "extract", status: "running" });
counters(2.0, 0);

// Stage: extract, one event group per batch
for (let b = 1; b <= BATCHES; b++) {
  const processed = Math.min(TOTAL, b * BATCH);
  const t = clamp(timeAtProcessed(processed), 4, 30);
  const rv = REVIEWS[(b * 7) % REVIEWS.length];
  const id = itemId((b * 7) % REVIEWS.length);
  push({
    t: r1(t),
    type: "batch",
    batch: b,
    totalBatches: BATCHES,
    processed,
    row: { batch: b, itemId: id, extraction: extractions[id] },
  });
  void rv;
  emitThemesAt(t, processed);
  counters(t, processed);
}
push({ t: 30.0, type: "stage", stage: "extract", status: "done", note: "3,214 items · 28.0s" });
push({ t: 30.0, type: "stage", stage: "cluster", status: "running" });

// Stage: cluster, merges
TRANS.forEach((x, k) => {
  push({ t: x.mergeT, type: "merge", fromId: `x${k + 1}`, intoId: themeId(x.parent), similarity: x.sim });
  const parent = THEMES[x.parent];
  themeEvent(x.mergeT, themeId(x.parent), parent, parent.c);
  counters(x.mergeT, TOTAL);
});
push({ t: 36.0, type: "stage", stage: "cluster", status: "done", note: "14 themes · 6.0s" });
push({ t: 36.0, type: "stage", stage: "rank", status: "running" });
push({ t: 38.0, type: "stage", stage: "rank", status: "done", note: "6 opportunities · 2.0s" });
push({ t: 38.0, type: "stage", stage: "brief", status: "running" });
counters(38.0, TOTAL);
push({ t: 41.0, type: "stage", stage: "brief", status: "done", note: `${wordCount.toLocaleString("en-US")} words · 3.0s` });
counters(41.0, TOTAL);
push({ t: 41.0, type: "done" });

// Log lines
LOG.forEach(([t, message]) => push({ t, type: "log", message }));

// Stable order: by time, then stage → theme/merge → batch → counters → log → done.
const ORDER: Record<PipelineEvent["type"], number> = { stage: 0, merge: 1, theme: 2, batch: 3, counters: 4, log: 5, done: 6, error: 7 };
events.sort((a, b) => a.t - b.t || ORDER[a.type] - ORDER[b.type]);

const file: RunFile = { run, events };
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(file, null, 0) + "\n");
const themeEvents = events.filter((e) => e.type === "theme").length;
console.log(`wrote ${OUT}: ${events.length} events (${themeEvents} theme updates), brief ${wordCount} words`);
