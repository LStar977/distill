/**
 * Deterministic generation plan for the fitness dataset. Pure: no I/O, no
 * network. `buildPlan(seed)` always returns the same rows, so the generator
 * can resume and the golden set is stable.
 */
import type { DatasetMeta, Sentiment, Severity } from "../../src/lib/types";
import { createRng, type Rng } from "../../src/lib/prng";
import { normalizeDate } from "../../src/pipeline/ingest";
import type { GoldenSet } from "../../src/pipeline/eval";

export const DATASET_ID = "fitness";
export const TOTAL_ITEMS = 3214;
export const DEFAULT_SEED = "distill-fitness-v1";
/** Calendar months covered, oldest first: 14 months ending 2026-09-09. */
export const MONTHS: string[] = [
  "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02",
  "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09",
];
export const LAST_DAY_OF_FINAL_MONTH = 9;

export const APPS = ["IronLog", "SetCount", "LiftLab"] as const;
export type App = (typeof APPS)[number];

export const PERSONAS = ["New user", "Paid subscriber", "Apple Watch owner", "Commercial gym member", "Coach"] as const;
export type Persona = (typeof PERSONAS)[number];

export type ThemeKey =
  | "rest-timer" | "watch-sync" | "subscription" | "import" | "plate-calc" | "supersets" | "library"
  | "charts" | "crashes" | "dark-mode" | "onboarding" | "coach-sharing" | "widgets" | "other";

export interface ThemeSpec {
  key: ThemeKey;
  name: string;
  short: string;
  quota: number;
  /** Sentiment of the theme itself (drives tone with the rating). */
  polarity: "positive" | "negative" | "neutral" | "mixed";
  severity: Severity;
  /** Weights for ratings 1..5. */
  ratingWeights: [number, number, number, number, number];
  /** 8-bucket trend shape from the design; interpolated to 14 months. */
  trend: number[];
  /** Explicit 14-month weights override the trend when set. */
  monthWeights?: number[];
  appWeights: [number, number, number];
  personaWeights: [number, number, number, number, number];
  /** Compatible secondary themes. */
  secondary: ThemeKey[];
  /** What the review must say — fed to the writer. */
  hint: string;
  other?: boolean;
}

export const THEME_SPECS: ThemeSpec[] = [
  { key: "rest-timer", name: "Rest timer unreliable in background", short: "Rest timer", quota: 412, polarity: "negative", severity: 4, ratingWeights: [24, 30, 20, 18, 8], trend: [3, 3, 4, 4, 5, 6, 7, 8], appWeights: [40, 32, 28], personaWeights: [15, 35, 25, 20, 5], secondary: ["supersets", "subscription", "watch-sync"], hint: "the rest timer stops, resets or never notifies once the phone locks, the app goes to the background, or another app (music, messages) comes to the front" },
  { key: "watch-sync", name: "Apple Watch sync drops sets", short: "Watch sync", quota: 388, polarity: "negative", severity: 4, ratingWeights: [24, 30, 20, 18, 8], trend: [2, 3, 3, 5, 6, 6, 7, 7], appWeights: [20, 42, 38], personaWeights: [5, 30, 55, 8, 2], secondary: ["subscription", "rest-timer"], hint: "sets logged on the Apple Watch arrive on the phone late, duplicated or never; the Watch app loses connection mid-session; a workout is partly or wholly lost" },
  { key: "subscription", name: "Subscription price vs. value", short: "Subscription", quota: 351, polarity: "mixed", severity: 3, ratingWeights: [14, 18, 22, 20, 26], trend: [4, 4, 5, 5, 6, 6, 6, 7], appWeights: [40, 32, 28], personaWeights: [25, 45, 10, 15, 5], secondary: ["plate-calc", "charts", "import", "rest-timer"], hint: "the annual price (IronLog $79/yr, LiftLab $59/yr, SetCount Pro $49/yr) versus what the free tier already does; low ratings think it is steep or cancelled, 3-star are torn, high ratings defend it as worth it" },
  { key: "import", name: "Import from other trackers is missing", short: "Import", quota: 297, polarity: "negative", severity: 3, ratingWeights: [10, 22, 28, 28, 12], trend: [5, 5, 5, 5, 5, 6, 5, 6], appWeights: [40, 32, 28], personaWeights: [60, 15, 5, 15, 5], secondary: ["subscription", "onboarding"], hint: "no way to import workout history from another tracker (Strong, Hevy, Fitbod, JEFIT, a spreadsheet); CSV import is missing, fails or maps columns wrong; years of data left behind" },
  { key: "plate-calc", name: "Plate calculator loved", short: "Plate calc", quota: 240, polarity: "positive", severity: 1, ratingWeights: [0, 0, 1, 9, 90], trend: [3, 4, 4, 5, 5, 5, 6, 6], appWeights: [40, 32, 28], personaWeights: [20, 25, 10, 40, 5], secondary: ["charts", "subscription"], hint: "praise for the plate calculator / plate math: which plates to load per side, warm-up sets, kg/lb, saves mental arithmetic between sets" },
  { key: "supersets", name: "Wants superset / circuit support", short: "Supersets", quota: 221, polarity: "negative", severity: 2, ratingWeights: [2, 6, 22, 42, 28], trend: [3, 3, 4, 4, 4, 5, 5, 5], appWeights: [40, 32, 28], personaWeights: [10, 30, 15, 35, 10], secondary: ["rest-timer", "library"], hint: "wants to group exercises into a superset or circuit; today they log separate blocks and the rest timer fires between every movement; giant sets, EMOMs, conditioning circuits" },
  { key: "library", name: "Exercise library gaps (cables, machines)", short: "Library gaps", quota: 198, polarity: "negative", severity: 3, ratingWeights: [2, 10, 28, 40, 20], trend: [4, 4, 4, 4, 5, 5, 5, 5], appWeights: [40, 32, 28], personaWeights: [10, 20, 10, 55, 5], secondary: ["supersets", "charts"], hint: "exercises missing from the library: cable variants, Smith machine, pec deck, hack squat, specific leg press or row machines; forced to create custom entries that clutter the list or break history" },
  { key: "charts", name: "Progress charts praised", short: "Charts", quota: 176, polarity: "positive", severity: 1, ratingWeights: [0, 0, 1, 9, 90], trend: [3, 3, 4, 4, 4, 5, 5, 5], appWeights: [40, 32, 28], personaWeights: [10, 45, 15, 20, 10], secondary: ["plate-calc", "subscription"], hint: "praise for the progress charts: trend lines, estimated 1RM graphs, volume per muscle group, seeing a plateau or PR history clearly" },
  { key: "crashes", name: "Crashes on iOS 18 beta", short: "iOS 18 crashes", quota: 143, polarity: "negative", severity: 5, ratingWeights: [65, 22, 8, 4, 1], trend: [0, 0, 0, 0, 1, 2, 6, 9], monthWeights: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 4, 9, 4], appWeights: [40, 32, 28], personaWeights: [15, 40, 25, 15, 5], secondary: ["subscription", "watch-sync"], hint: "the app crashes on launch or mid-workout since installing the iOS 18 beta; sometimes every single time; lost the session; reinstall did not help" },
  { key: "dark-mode", name: "Dark mode requests", short: "Dark mode", quota: 120, polarity: "neutral", severity: 2, ratingWeights: [0, 2, 12, 40, 46], trend: [2, 2, 3, 3, 3, 3, 4, 4], appWeights: [40, 32, 28], personaWeights: [15, 35, 15, 30, 5], secondary: ["widgets", "charts"], hint: "asks for a dark theme / dark mode; bright white screen in an early-morning or dimly lit gym; wants it to follow the system setting" },
  { key: "onboarding", name: "Onboarding too long", short: "Onboarding", quota: 97, polarity: "negative", severity: 2, ratingWeights: [4, 14, 32, 34, 16], trend: [3, 3, 3, 3, 3, 3, 3, 3], appWeights: [40, 32, 28], personaWeights: [80, 5, 5, 8, 2], secondary: ["import", "subscription"], hint: "too many onboarding screens, questions, goals quizzes or permission prompts before they could log a first set; wanted to skip" },
  { key: "coach-sharing", name: "Wants coach / program sharing", short: "Coach sharing", quota: 88, polarity: "neutral", severity: 2, ratingWeights: [0, 2, 12, 40, 46], trend: [2, 2, 2, 3, 3, 3, 3, 4], appWeights: [40, 32, 28], personaWeights: [10, 25, 5, 15, 45], secondary: ["supersets", "subscription"], hint: "wants a coach or training partner to push or share a program into the app, or to share their own program or log with a coach; today it is screenshots and spreadsheets" },
  { key: "widgets", name: "Widget requests", short: "Widgets", quota: 61, polarity: "neutral", severity: 1, ratingWeights: [0, 2, 10, 38, 50], trend: [1, 1, 2, 2, 2, 2, 3, 3], appWeights: [40, 32, 28], personaWeights: [10, 40, 30, 15, 5], secondary: ["dark-mode", "rest-timer"], hint: "asks for a home-screen or lock-screen widget: current set, next workout, rest timer countdown, weekly volume; also Live Activities or Dynamic Island" },
  { key: "other", name: "Other / uncategorized", short: "Other", quota: 422, polarity: "neutral", severity: 2, ratingWeights: [3, 3, 4, 10, 80], trend: [5, 5, 5, 5, 5, 5, 5, 5], appWeights: [40, 32, 28], personaWeights: [30, 25, 15, 20, 10], secondary: [], hint: "benign, varied feedback that touches NONE of the other themes", other: true },
];

/** Sub-topics for the Other bucket, with weights. Must not overlap any real theme. */
export const OTHER_SUBTOPICS: { key: string; weight: number; hint: string }[] = [
  { key: "generic-praise", weight: 22, hint: "generic praise: 'great app', 'does what it says', 'best tracker I've used', no specific feature named" },
  { key: "onboarding-praise", weight: 8, hint: "praise for how quick and easy setup and the first workout were" },
  { key: "one-word", weight: 14, hint: "a one- or two-word review: 'Good', 'Solid.', 'ok', 'Love it', 'meh', 'fine'" },
  { key: "shipping-question", weight: 5, hint: "a confused customer asking about a physical order, shipping, or a barbell/plates delivery, as if this were a store" },
  { key: "unrelated", weight: 8, hint: "unrelated: complaining about their gym, asking for nutrition or calorie tracking, a running/cardio app comparison, weather" },
  { key: "login-account", weight: 7, hint: "a question about signing in, password reset, or restoring purchases on a new phone; resolved or neutral, not a crash" },
  { key: "localization", weight: 6, hint: "asks for another language, kg/lb labels in a specific locale, or European date format" },
  { key: "android", weight: 7, hint: "asks whether an Android or iPad version is coming; friend can't use it" },
  { key: "ui-compliment", weight: 9, hint: "compliments the clean design, big buttons, easy logging with sweaty hands, haptics" },
  { key: "battery", weight: 4, hint: "a mild note about battery use during a long session on the phone, without mentioning the Watch" },
  { key: "update-note", weight: 5, hint: "a short remark about the latest update: icon changed, new colours, faster, or 'what changed?'" },
  { key: "support-thanks", weight: 5, hint: "thanks the support team for a quick email reply about a billing or account question" },
];

export const APP_NOTES: Record<App, string> = {
  IronLog: "IronLog — paid iOS + Apple Watch tracker for strength athletes, $79/year after a 14-day trial, known for its plate calculator and charts.",
  SetCount: "SetCount — freemium iOS tracker with a strong Apple Watch app; SetCount Pro is $49/year and unlocks charts and cloud sync.",
  LiftLab: "LiftLab — newer, program-first iOS tracker, $59/year, popular with people following structured programs.",
};

export interface HandoffReview {
  app: App;
  rating: number;
  date: string;
  pre: string;
  quote: string;
  post: string;
  sentiment: Sentiment;
  themes: number[];
  severity: Severity;
}

const R = (app: App, rating: number, date: string, pre: string, quote: string, post: string, sentiment: Sentiment, themes: number[], severity: Severity): HandoffReview => ({
  app, rating, date, pre, quote, post, sentiment, themes, severity,
});

/** The 26 verbatim reviews from the design handoff (REVIEWS constant). Theme indices follow THEME_SPECS order. */
export const HANDOFF_REVIEWS: HandoffReview[] = [
  R("IronLog", 2, "14 Mar 2026", "Great logging but ", "the rest timer just stops counting the second I lock my phone", ". Missed my 3-minute rest twice.", "negative", [0], 4),
  R("SetCount", 1, "2 Jun 2026", "", "Lost an entire leg day because the Watch dropped half my sets on sync", ". Not the first time.", "negative", [1], 4),
  R("LiftLab", 3, "21 Nov 2025", "Solid app. ", "$79 a year feels steep when the free version already does 80% of what I need", ".", "mixed", [2], 3),
  R("IronLog", 2, "8 Jan 2026", "", "Two years of Strong data and no way to import it", ". Starting from zero is a dealbreaker.", "negative", [3], 3),
  R("SetCount", 5, "30 Aug 2026", "", "The plate calculator alone is worth the download", ", saves me doing math between sets.", "positive", [4], 1),
  R("LiftLab", 3, "17 Feb 2026", "Wish I could ", "group exercises into a superset instead of logging them as separate blocks", ".", "negative", [5], 2),
  R("IronLog", 3, "5 Oct 2025", "", "Half the cable machines at my gym aren’t in the library", " so I end up with a dozen custom entries.", "negative", [6], 3),
  R("SetCount", 5, "12 Jul 2026", "", "The progress charts finally made my plateau obvious", ". Deloaded, back to PRs.", "positive", [7], 1),
  R("LiftLab", 1, "26 Aug 2026", "", "Crashes on launch since the iOS 18 beta", ", every single time.", "negative", [8], 5),
  R("IronLog", 4, "9 Dec 2025", "Love it, but ", "please add a dark mode, the white screen at 6am is brutal", ".", "neutral", [9], 2),
  R("SetCount", 2, "3 May 2026", "", "The rest timer notification never fires when the app is in the background", ". Have to keep the screen on.", "negative", [0], 4),
  R("LiftLab", 2, "19 Apr 2026", "", "Sets logged on the Watch show up on the phone minutes later, or not at all", ".", "negative", [1], 4),
  R("IronLog", 3, "28 Sep 2025", "", "Fifteen onboarding screens before I could log a single set", " is too many.", "negative", [10], 2),
  R("SetCount", 4, "15 Jan 2026", "Would pay extra if ", "my coach could push a program straight into the app", ".", "neutral", [11], 2),
  R("LiftLab", 4, "7 Aug 2026", "", "A lock-screen widget for the current set would be perfect", ".", "neutral", [12], 1),
  R("IronLog", 1, "22 Jun 2026", "", "Paying monthly and the timer still resets itself in the background", ". Fix the basics first.", "negative", [0, 2], 4),
  R("SetCount", 5, "11 Nov 2025", "", "Plate math done for me", ", tiny feature, huge quality of life.", "positive", [4], 1),
  R("LiftLab", 2, "4 Mar 2026", "", "Import from Hevy failed on every CSV I tried", ".", "negative", [3], 3),
  R("IronLog", 3, "16 May 2026", "", "Circuits are impossible to log", " without the rest timer going off between every movement.", "negative", [5, 0], 2),
  R("SetCount", 4, "1 Feb 2026", "Good app overall. ", "Charts are clean and the trend line is honest", ".", "positive", [7], 1),
  R("LiftLab", 2, "24 Jul 2026", "", "Watch app lost connection mid-set three times today", ".", "negative", [1], 4),
  R("IronLog", 5, "13 Oct 2025", "Been using it a year. ", "Worth every cent of the subscription", ".", "positive", [2], 1),
  R("SetCount", 3, "27 Dec 2025", "", "No Smith machine variants in the exercise list", ".", "negative", [6], 3),
  R("LiftLab", 4, "18 Aug 2026", "Nice update. ", "Still no way to share a program with my training partner", ".", "neutral", [11], 2),
  R("SetCount", 2, "6 Apr 2026", "", "Timer dies if I switch to Spotify for ten seconds", ".", "negative", [0], 4),
  R("IronLog", 1, "29 Jul 2026", "", "Rest timer is the whole reason I use an app and it can’t survive a screen lock", ".", "negative", [0], 4),
];

export interface PlanRow {
  id: string;
  app: App;
  /** YYYY-MM-DD */
  date: string;
  rating: number;
  /** Theme keys, primary first. */
  themes: ThemeKey[];
  tone: Sentiment;
  severity: Severity;
  persona: Persona;
  /** Only for Other rows. */
  subtopic?: string;
  /** Verbatim text for the handoff reviews; synthetic rows are written by the model. */
  text?: string;
  handoff?: boolean;
}

export interface Plan {
  seed: string;
  rows: PlanRow[];
}

export const specByKey: Map<ThemeKey, ThemeSpec> = new Map(THEME_SPECS.map((s) => [s.key, s]));

function daysInMonth(ym: string): number {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Interpolate an 8-bucket trend onto the 14 months; the partial final month is down-weighted. */
export function monthWeightsFor(spec: ThemeSpec): number[] {
  if (spec.monthWeights) return spec.monthWeights;
  const n = MONTHS.length;
  const tr = spec.trend;
  const out: number[] = [];
  for (let m = 0; m < n; m++) {
    const p = (m / (n - 1)) * (tr.length - 1);
    const lo = Math.floor(p);
    const hi = Math.min(tr.length - 1, Math.ceil(p));
    const frac = p - lo;
    const v = (tr[lo] ?? 0) * (1 - frac) + (tr[hi] ?? 0) * frac;
    out.push(m === n - 1 ? v * (LAST_DAY_OF_FINAL_MONTH / 30) : v);
  }
  return out;
}

function pickDate(rng: Rng, month: string): string {
  const max = month === MONTHS[MONTHS.length - 1] ? LAST_DAY_OF_FINAL_MONTH : daysInMonth(month);
  const day = 1 + rng.int(max);
  return `${month}-${String(day).padStart(2, "0")}`;
}

/** Tone from the planted themes and rating. */
export function toneFor(themes: ThemeKey[], rating: number): Sentiment {
  const primary = specByKey.get(themes[0] as ThemeKey) as ThemeSpec;
  const polarities = themes.map((k) => (specByKey.get(k) as ThemeSpec).polarity);
  const hasPos = polarities.includes("positive");
  const hasNeg = polarities.includes("negative");
  if (hasPos && hasNeg) return "mixed";
  if (primary.other) return rating >= 4 ? "positive" : rating === 3 ? "neutral" : "negative";
  if (primary.polarity === "positive") return "positive";
  if (primary.polarity === "negative") return rating >= 4 ? "mixed" : "negative";
  if (primary.polarity === "mixed") return rating <= 2 ? "negative" : rating === 3 ? "mixed" : "positive";
  // neutral (requests)
  if (rating <= 2) return "negative";
  return "neutral";
}

export function severityFor(rng: Rng, themes: ThemeKey[], rating: number): Severity {
  const primary = specByKey.get(themes[0] as ThemeKey) as ThemeSpec;
  if (primary.polarity === "positive") return 1;
  let s: number = primary.severity;
  const jitter = rng.next();
  if (jitter < 0.2) s -= 1;
  else if (jitter > 0.85) s += 1;
  if (rating >= 4 && s > 3) s = 3;
  if (primary.other) s = rating <= 2 ? 3 : rating === 3 ? 2 : 1;
  return Math.min(5, Math.max(1, s)) as Severity;
}

function handoffToRow(h: HandoffReview): Omit<PlanRow, "id"> {
  const themes = h.themes.map((i) => (THEME_SPECS[i] as ThemeSpec).key);
  const date = normalizeDate(h.date);
  if (!date) throw new Error(`bad handoff date ${h.date}`);
  const persona: Persona = themes[0] === "watch-sync" ? "Apple Watch owner" : h.quote.toLowerCase().includes("coach") ? "Coach" : h.quote.toLowerCase().includes("paying") || h.quote.toLowerCase().includes("subscription") ? "Paid subscriber" : "Commercial gym member";
  return { app: h.app, date, rating: h.rating, themes, tone: h.sentiment, severity: h.severity, persona, text: `${h.pre}${h.quote}${h.post}`, handoff: true };
}

export const SECONDARY_RATE = 0.12;

/** Build the full deterministic plan. */
export function buildPlan(seed = DEFAULT_SEED, total = TOTAL_ITEMS): Plan {
  const rng = createRng(seed);
  const scale = total / TOTAL_ITEMS;
  const handoffRows = HANDOFF_REVIEWS.map(handoffToRow);
  const handoffByTheme = new Map<ThemeKey, number>();
  for (const r of handoffRows) handoffByTheme.set(r.themes[0] as ThemeKey, (handoffByTheme.get(r.themes[0] as ThemeKey) ?? 0) + 1);

  const rows: Omit<PlanRow, "id">[] = [];
  const otherWeights = OTHER_SUBTOPICS.map((s) => s.weight);
  for (const spec of THEME_SPECS) {
    const quota = Math.max(0, Math.round(spec.quota * scale) - (scale >= 1 ? (handoffByTheme.get(spec.key) ?? 0) : 0));
    const months = monthWeightsFor(spec);
    for (let i = 0; i < quota; i++) {
      const app = APPS[rng.weighted(spec.appWeights)] as App;
      const month = MONTHS[rng.weighted(months)] as string;
      const rating = 1 + rng.weighted(spec.ratingWeights);
      const themes: ThemeKey[] = [spec.key];
      if (!spec.other && spec.secondary.length > 0 && rng.next() < SECONDARY_RATE) themes.push(rng.pick(spec.secondary));
      const persona = PERSONAS[rng.weighted(spec.personaWeights)] as Persona;
      const row: Omit<PlanRow, "id"> = {
        app,
        date: pickDate(rng, month),
        rating,
        themes,
        tone: toneFor(themes, rating),
        severity: severityFor(rng, themes, rating),
        persona,
      };
      if (spec.other) row.subtopic = (OTHER_SUBTOPICS[rng.weighted(otherWeights)] as { key: string }).key;
      rows.push(row);
    }
  }
  if (scale >= 1) rows.push(...handoffRows);
  const shuffled = rng.shuffle(rows);
  const width = String(shuffled.length).length;
  const planned: PlanRow[] = shuffled.map((r, i) => ({ id: `fit-${String(i + 1).padStart(Math.max(4, width), "0")}`, ...r }));
  planned.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
  return { seed, rows: planned };
}

/** Counts of ratings 1..5 as fractions. */
export function ratingHistogram(rows: readonly PlanRow[]): number[] {
  const counts = [0, 0, 0, 0, 0];
  for (const r of rows) counts[r.rating - 1] = (counts[r.rating - 1] ?? 0) + 1;
  return counts.map((c) => c / Math.max(1, rows.length));
}

export function themeCounts(rows: readonly PlanRow[]): Map<ThemeKey, number> {
  const m = new Map<ThemeKey, number>();
  for (const r of rows) for (const k of r.themes) m.set(k, (m.get(k) ?? 0) + 1);
  return m;
}

export const GOLDEN_SIZE = 50;

/** 50 items stratified by primary theme (min 2 each), labels = planted theme names, sentiment = planted tone. */
export function goldenFor(plan: Plan, size = GOLDEN_SIZE, seed = `${plan.seed}-golden`): GoldenSet {
  const rng = createRng(seed);
  const byTheme = new Map<ThemeKey, PlanRow[]>();
  for (const r of plan.rows) {
    const k = r.themes[0] as ThemeKey;
    const list = byTheme.get(k) ?? [];
    list.push(r);
    byTheme.set(k, list);
  }
  const specs = THEME_SPECS.filter((s) => (byTheme.get(s.key)?.length ?? 0) > 0);
  const total = plan.rows.length;
  const minEach = Math.min(2, Math.floor(size / Math.max(1, specs.length)));
  const alloc = new Map<ThemeKey, number>(specs.map((s) => [s.key, minEach]));
  let remaining = size - minEach * specs.length;
  const exact = specs.map((s) => ({ key: s.key, want: ((byTheme.get(s.key)?.length ?? 0) / total) * (size - minEach * specs.length) }));
  const floors = exact.map((e) => ({ key: e.key, n: Math.floor(e.want), frac: e.want - Math.floor(e.want) }));
  for (const f of floors) {
    alloc.set(f.key, (alloc.get(f.key) ?? 0) + f.n);
    remaining -= f.n;
  }
  floors.sort((a, b) => b.frac - a.frac);
  for (const f of floors) {
    if (remaining <= 0) break;
    alloc.set(f.key, (alloc.get(f.key) ?? 0) + 1);
    remaining--;
  }
  const items: GoldenSet["items"] = [];
  for (const spec of specs) {
    const pool = rng.shuffle(byTheme.get(spec.key) ?? []);
    const n = Math.min(alloc.get(spec.key) ?? 0, pool.length);
    for (const r of pool.slice(0, n)) {
      items.push({ itemId: r.id, themes: r.themes.map((k) => (specByKey.get(k) as ThemeSpec).name), sentiment: r.tone });
    }
  }
  items.sort((a, b) => (a.itemId < b.itemId ? -1 : 1));
  return {
    note:
      "Labels are planted by construction: each review was generated to express exactly the themes listed here (primary first, optional secondary), and the set was spot-checked by hand after generation. Sentiment is the planted tone. The 'Other / uncategorized' label means the review touches none of the 13 themes.",
    items,
  };
}

export const PRODUCT_CONTEXT =
  "IronLog is a paid workout tracker for strength athletes on iOS and Apple Watch. We're deciding what to fix before the next annual-pricing push.";

export function datasetMeta(itemCount: number, months = MONTHS.length): DatasetMeta {
  return {
    id: DATASET_ID,
    kind: "App Store reviews",
    name: "Fitness tracker reviews",
    meta: `${itemCount.toLocaleString("en-US")} items · ${APPS.length} apps · ${months} months`,
    description: "IronLog, SetCount and LiftLab. The flagship demo.",
    itemCount,
    sources: [...APPS],
    defaultContext: {
      product: PRODUCT_CONTEXT,
      decision: "Which problems to fix before the next annual-pricing push.",
    },
  };
}
