# DISTILL — Review Intelligence Agent: Design Brief

This is the source-of-truth brief for Distill. The **PROMPT** section at the bottom is
what gets pasted into Claude Design. When the design comes back, the app gets built to
match it, using this document for scope, pipeline, and data model.

Working name: **Distill** (thousands of reviews in, a handful of decisions out).
Alternatives if the name doesn't land: Sift, Verdict, Lodestar, Groundtruth.

---

## 1. What it is

Distill is a web app where you drop in a large pile of unstructured customer feedback
(app-store reviews, support tickets, survey responses, sales-call notes) and an AI agent
turns it into a ranked list of product opportunities, each backed by traceable evidence
and written up as a brief a team could act on tomorrow.

**The one-line pitch:** *"3,000 reviews in. Six decisions out. Every one of them cites
its sources."*

## 2. Who it's for and why it exists

- **User:** a product manager, founder, or consultant who has more feedback than time.
- **Problem:** reading 3,000 reviews takes a week. Skimming 50 gives you a biased picture.
  Asking a chatbot to "summarize" gives you a paragraph nobody trusts because it can't
  show its work.
- **What Distill does differently:**
  1. **Traceable.** Every theme and opportunity links to the exact source quotes.
  2. **Visible.** You watch the agent work: extraction streaming in, themes forming,
     cost ticking up. Not a spinner.
  3. **Measured.** A built-in eval against a hand-labelled golden set shows how accurate
     the extraction is on this dataset. The number is on the dashboard.
  4. **Actionable.** Output is a ranked opportunity list and a PRD-style brief, not a
     word cloud.

## 3. Portfolio purpose (why we're building it)

This is portfolio project #1. It has to prove: *give Lance a business problem and he can
turn it into a working AI system.* Specifically for AI-lab product / solutions /
forward-deployed roles it demonstrates structured extraction, LLM pipeline design,
evidence traceability, evals, cost awareness, and a polished UI. It is a prototype, not
a startup. Scope accordingly.

**The five deliverables this design must set up:**

1. Hosted demo (Vercel) that a recruiter can click through with zero setup.
2. A 45-second demo video (Remotion, same pipeline as TITAN / Acorn).
3. Three hero screenshots: **live run mid-flight**, **insights dashboard**, **opportunity
   detail with evidence**.
4. Case study README: Problem → what I built → how AI was used → result.
5. Public repo.

## 4. Demo storyboard (design backwards from this)

| Time | Beat | Screen |
|---|---|---|
| 0–5s | Title card: "3,214 reviews. 41 seconds." | — |
| 5–12s | Pick the "Fitness tracker reviews" dataset, type the product context, hit **Run** | New run |
| 12–25s | The agent works: extractions stream past, theme map grows, counters climb, cost ticks | Live run |
| 25–35s | Dashboard: ranked themes; click the #1 opportunity; evidence quotes highlighted | Dashboard → Opportunity |
| 35–42s | Generated brief appears; export | Brief |
| 42–45s | Closing stats: 14 themes · 6 opportunities · 91% extraction precision · $1.87 | Eval panel / end card |

If a screen doesn't earn a beat in this storyboard, it's a supporting state, not a hero.

## 5. Screens

Desktop-first web app (1440×900 primary). Responsive down to tablet; phone gets a
read-only view of results.

### 5.1 New run (home)
- **Dataset picker.** Three bundled demo datasets as large cards, plus "Upload your own"
  (CSV / paste text):
  - *Fitness tracker app reviews* — 3,214 App Store reviews across 3 fictional tracker apps
    (the flagship demo; ties to the TITAN case study).
  - *SaaS support tickets* — 1,800 tickets from a fictional B2B tool.
  - *NPS survey responses* — 950 verbatims with scores.
- **Context panel.** "What's the product?" (2–3 sentences) and "What are you trying to
  decide?" (optional). This context feeds the strategic-fit score.
- **Run settings** (collapsed by default): depth (Fast / Thorough), sample size cap,
  estimated cost and time shown live before you hit Run.
- Primary CTA: **Run analysis**. Demo mode shows a "pre-computed run, replays instantly"
  note; live mode shows the cost estimate.
- Recent runs list below.

### 5.2 Live run (the magic moment)
This is the hero. It should feel like an instrument panel, not a progress bar.
- **Pipeline rail** across the top: Ingest → Extract → Cluster → Rank → Brief, each
  stage with state (queued / running / done), item counts, elapsed time.
- **Extraction stream** (left, ~50% width): a fast-scrolling feed of reviews being
  processed. Each row: the source snippet, then the structured extraction appearing
  beside it (sentiment chip, theme tags, severity dot, a highlighted quote span). Rows
  arrive in batches of ~20.
- **Theme map** (right): themes appear as nodes and grow as extractions land on them.
  Size = frequency, color = sentiment, a subtle pulse when a node gets a new hit. When
  clustering runs, nodes visibly merge.
- **Counters strip** (bottom): reviews processed / total, themes found, tokens in/out,
  cost so far, elapsed, cache hit rate. Tabular numerals, monospace.
- **Agent log** (collapsible drawer): plain-language narration of what the agent is
  doing: "Sampling 200 reviews to draft a taxonomy…", "Merged 'timer bugs' into 'rest
  timer unreliable' (0.91 similarity)…"
- On completion: a brief settle animation, then **View results**.

### 5.3 Insights dashboard
- **Header:** dataset name, run date, item count, and three big stats: themes, opportunities,
  extraction precision (from the eval, with an info tooltip).
- **Themes table** (primary): rank, theme name, mentions, % of total, sentiment split bar,
  severity, trend sparkline (by date or app version), and a "→ opportunity" marker where
  a theme rolled up into one.
- **Impact matrix** (secondary): frequency × severity scatter; each dot a theme; the
  top-right quadrant is where opportunities live.
- **Filters:** rating, date range, source app / segment, sentiment.
- **Evidence drawer:** clicking any row slides in the source reviews for that theme, each
  with the extracted quote highlighted and a link to the original.

### 5.4 Opportunity detail
One opportunity, written like the first page of a PRD:
- Title, one-line problem statement, opportunity score with its breakdown (frequency ×
  severity × recency × strategic fit), confidence.
- **Who's affected:** segments and share of feedback.
- **Evidence:** 5–8 quotes, each with rating, date, source, and a link that opens the full
  original in the drawer. This is the section that proves the tool isn't hallucinating.
- **Proposed direction:** 2–3 sentences, plus "What we'd need to validate."
- **Effort / impact** estimate as simple T-shirt sizes.
- **Related themes** chips.
- Actions: add to brief, copy as markdown, dismiss.

### 5.5 Brief and export
- Generated document: executive summary, top opportunities (ordered), theme overview,
  methodology note (how many items, model, eval score), appendix of evidence.
- Inline-editable. Export as Markdown or PDF. Share link (read-only).
- **Eval panel** (side tab): golden set size, precision / recall for theme assignment and
  sentiment, a small confusion table, and the cost/latency of this run. Framed as
  "how much should you trust this?"

### Supporting states
- Empty state (no runs yet). Error state (bad CSV, column mapper to fix it).
- Demo-mode banner: "You're viewing a pre-computed run. Sign in with a key to run live."
- Cap reached: "Live runs are limited to 500 items on the public demo."
- Loading skeletons for dashboard. Toasts for export / copy.

## 6. Agent pipeline (build reference, not for the designer)

```
Ingest   parse CSV / text → normalize → dedupe → sample for taxonomy
Extract  per item, batched ~20/call, structured outputs:
           sentiment, themes[], pain_points[], feature_requests[],
           severity 1–5, quote_spans[], segment hints
Cluster  phase 1: propose taxonomy from a 200-item sample
         phase 2: extraction uses the taxonomy as labels (+ "other")
         phase 3: consolidation pass merges near-duplicate themes, names them
Rank     opportunity score = frequency × severity × recency × strategic fit
         (strategic fit from the user's product context)
Brief    synthesis with citations; every claim maps to source item IDs
Eval     50-item hand-labelled golden set per bundled dataset;
         precision / recall on theme assignment and sentiment
```

- **Models:** a cheaper current-generation model for bulk extraction, a stronger model
  for taxonomy, consolidation, and the brief. Prompt caching on the taxonomy + system
  prompt; batches where latency doesn't matter (pre-computing demo runs).
- **Streaming:** server-sent events from the pipeline to the live-run screen.
- **Demo economics:** the three bundled datasets ship with pre-computed runs so the
  public demo costs nothing to replay. Live runs require the visitor's own API key or
  are capped.

## 7. Data model

```
Run        id, dataset_id, context, settings, status, started_at, finished_at,
           stats { items, themes, opportunities, tokens_in, tokens_out, cost_usd,
                   cache_hit_rate, duration_ms }, eval { precision, recall, n }
Item       id, run_id, source, text, rating?, date?, segment?, meta{}
Extraction item_id, sentiment, severity, themes[], pain_points[],
           feature_requests[], quotes[{start,end,text}]
Theme      id, run_id, name, description, count, share, sentiment_split,
           severity_avg, trend[], example_item_ids[]
Opportunity id, run_id, title, problem, score, score_breakdown{}, confidence,
           segments[], evidence[{item_id, quote}], direction, validate[],
           effort, impact, theme_ids[]
Brief      run_id, markdown, sections[], updated_at
```

## 8. Stack

Next.js (App Router) + TypeScript, the official Anthropic TypeScript SDK, Postgres on
Neon (or SQLite for local), Vercel for hosting, Remotion for the promo video. Tailwind
plus a small token file mirroring the design handoff, same as TITAN's `Theme.swift`.

## 9. Brand and visual direction

Distinct from the rest of the portfolio (TITAN is purple/black, Carl is navy/blue, Acorn
is green/amber). Distill should read as **editorial meets instrument**: a calm, light,
paper-like workspace for reading results, with the live-run panel as a dark inset that
looks like lab equipment.

| Token | Hex (starting point, designer may tune) | Use |
|---|---|---|
| `paper` | `#F7F6F2` | App background |
| `surface` | `#FFFFFF` | Cards, tables |
| `ink` | `#151517` | Primary text |
| `ink-dim` | `#6B6B75` | Secondary text |
| `line` | `#E4E2DB` | Borders, dividers |
| `signal` | `#E8590C` | The one accent: CTAs, highlights, quote marks |
| `signal-soft` | `#FDE7D9` | Highlight backgrounds, selected rows |
| `instrument` | `#0E0F14` | Live-run panel background |
| `instrument-line` | `#23252E` | Grid lines inside the instrument |
| `positive` | `#2F9E6E` | Positive sentiment |
| `negative` | `#D64545` | Negative sentiment |
| `neutral` | `#8A8F9C` | Neutral sentiment |

- **Type:** a humanist serif for headings and the brief (reads as "a document you'd
  trust"), a clean grotesque for UI, and a monospace with tabular numerals for every
  counter, score, and cost.
- **Motion:** the live run is the only place with continuous motion. Everywhere else,
  motion is limited to row highlights, drawer slides, and the theme-node pulse.
- **Evidence quotes** are a signature element: highlighted spans in `signal-soft` with a
  small source chip. They should look the same everywhere they appear.
- Light theme only for v1.

## 10. Mock data guidance

Fictional fitness tracker apps: **IronLog**, **SetCount**, **LiftLab**. 3,214 reviews, dates spanning 14 months, ratings 1–5 skewed
positive. Themes that should appear (with plausible counts summing sensibly):

1. Rest timer unreliable in background — 412, negative, severity 4
2. Apple Watch sync drops sets — 388, negative, severity 4
3. Subscription price vs. value — 351, mixed, severity 3
4. Import from other trackers is missing — 297, negative, severity 3
5. Plate calculator loved — 240, positive
6. Wants superset / circuit support — 221, negative, severity 2
7. Exercise library gaps (cables, machines) — 198
8. Progress charts praised — 176, positive
9. Crashes on iOS 18 beta — 143, severity 5
10. Dark mode requests — 120
11. Onboarding too long — 97
12. Wants coach / program sharing — 88
13. Widget requests — 61
14. Other — remainder

Opportunities (6): e.g. "Make the rest timer bulletproof in the background" (score 92),
"Fix Watch set-sync reliability" (89), "One-tap import from competitors" (81),
"Supersets and circuits" (74), "Re-tier the subscription" (70), "Cable and machine
library expansion" (58). Eval: 91% precision, 87% recall, n = 50. Run stats: 41s,
$1.87, 1.9M tokens in, 210K out, 78% cache hit rate.

---

## PROMPT

> Paste everything below this line into Claude Design.

Design a polished, high-fidelity **desktop web app** called **Distill** — an AI research
agent that turns thousands of customer reviews into a ranked list of product
opportunities, each backed by traceable evidence. Produce interactive HTML mockups with
realistic mock data, one artboard per screen listed below, plus a shared component sheet.

**Concept.** A product manager pastes in 3,000 app reviews. Distill's agent extracts
structured signal from every one, clusters it into themes, ranks opportunities, and
writes a brief. The user watches the agent work in real time, then explores the results.
The three things that must come through in the design: **every insight is traceable to
source quotes**, **the agent is visible while it works**, and **the tool tells you how
much to trust it** (a built-in accuracy score).

**Visual direction: editorial meets instrument.** A calm, light, paper-like workspace
(off-white `#F7F6F2` background, white cards, near-black `#151517` text, warm gray
borders) with a single accent, a burnt orange `#E8590C`, used only for actions,
highlights, and evidence quotes. The live-run screen breaks the calm: it is a dark
inset panel (`#0E0F14`) that looks like laboratory equipment, with monospace tabular
counters and a glowing theme map. Typography: a humanist serif for headings and the
generated brief, a clean grotesque for UI, monospace with tabular numerals for every
number. Motion is reserved for the live run; elsewhere it's row highlights and drawer
slides. Light theme only. Primary canvas 1440×900; include a tablet layout of the
dashboard and a phone read-only results view.

**Signature element:** evidence quotes. A highlighted span (pale orange background),
the quoted sentence, and a small chip showing rating · date · source. Use the identical
treatment everywhere a quote appears.

Design these screens as a connected flow:

1. **New run (home).** Dataset picker: three large demo dataset cards (Fitness tracker
   app reviews · 3,214 items; SaaS support tickets · 1,800; NPS survey responses · 950)
   plus an "Upload your own" card (CSV or paste). A context panel with two fields:
   "What's the product?" and "What are you trying to decide?". Collapsed run settings
   (Fast / Thorough, item cap) with a live estimate: "~45s · ~$1.90". Primary CTA
   **Run analysis**. Below, a recent-runs list. Include the demo-mode banner variant.

2. **Live run — the hero screen.** Top: a pipeline rail Ingest → Extract → Cluster →
   Rank → Brief with per-stage state, counts, and elapsed time. Left half: a fast
   extraction stream, each row showing a review snippet and, beside it, the structured
   extraction landing (sentiment chip, theme tags, severity dot, highlighted quote).
   Right half: a theme map where nodes appear and grow as extractions land, sized by
   frequency, colored by sentiment, pulsing on new hits, merging during the Cluster
   stage. Bottom strip of counters: 1,847 / 3,214 processed · 11 themes · 1.2M tokens ·
   $1.12 · 00:24 · 78% cache. A collapsible agent-log drawer with plain-language
   narration ("Merged 'timer bugs' into 'rest timer unreliable'"). Show both a mid-run
   state and the completed state with a **View results** CTA.

3. **Insights dashboard.** Header with dataset, run date, and three big stats: 14 themes ·
   6 opportunities · 91% extraction precision (tooltip: measured on a 50-item labelled
   set). Themes table: rank, name, mentions, share, sentiment split bar, severity, trend
   sparkline, opportunity marker. An impact matrix (frequency × severity scatter) with
   the top-right quadrant labelled. Filters: rating, date, source app, sentiment. An
   evidence drawer sliding in from the right when a row is clicked, listing source
   reviews with highlighted quotes.

4. **Opportunity detail.** Reads like the first page of a PRD. Title ("Make the rest
   timer bulletproof in the background"), one-line problem, an opportunity score (92)
   with its breakdown (frequency × severity × recency × strategic fit) and a confidence
   indicator. Who's affected. An evidence section with 6 quotes in the signature
   treatment. Proposed direction, "what we'd need to validate", effort/impact T-shirt
   sizes, related-theme chips. Actions: Add to brief · Copy as markdown · Dismiss.

5. **Brief and export.** A generated document in the serif face: executive summary, top
   six opportunities, theme overview, methodology note, evidence appendix. Inline
   editing affordance. Export Markdown / PDF, share link. A side tab **Trust** with the
   eval panel: golden set size, precision/recall for themes and sentiment, a tiny
   confusion table, and this run's cost and latency.

Also include: empty state (no runs yet), CSV column-mapper error state, the
"live runs capped at 500 items" state, skeleton loading for the dashboard, and export /
copy toasts.

**Mock data.** Fictional fitness tracker apps IronLog, SetCount, LiftLab. Fourteen
themes led by "Rest timer unreliable in background" (412 mentions, negative, severity
4), "Apple Watch sync drops sets" (388), "Subscription price vs. value" (351, mixed),
"Import from other trackers is missing" (297), with a few positive ones ("Plate
calculator loved", 240; "Progress charts praised", 176). Six opportunities scored 92,
89, 81, 74, 70, 58. Run stats: 41s, $1.87, 1.9M tokens in, 210K out. Keep every number
self-consistent across screens.

**Deliverable.** Self-contained interactive HTML mockups, one per screen, plus a
component sheet (buttons, chips, tables, the evidence quote, sentiment bars, counters,
theme node, drawer, toasts) so the system is reusable when the real frontend is built.
