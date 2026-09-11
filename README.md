# Distill — Review Intelligence Agent

**Thousands of reviews in. Six decisions out. Every one of them cites its sources.**

Distill is an AI research agent that turns a pile of unstructured customer feedback
(app-store reviews, support tickets, survey verbatims) into a ranked list of product
opportunities, each backed by traceable evidence and written up as a brief a team could
act on tomorrow. You watch the agent work in real time, then explore the results.

> Portfolio project #1 of 6. Built brief → Claude Design → code, same pipeline as
> [TITAN](https://github.com/LStar977/titan). Design source is in `design/handoff`.

![Live run](docs/screenshots/02-live-run-mid.png)

## The case study

**Problem.** Reading 3,000 reviews takes a week. Skimming 50 gives a biased picture.
Asking a chatbot to "summarize" gives a paragraph nobody trusts, because it can't show
its work.

**What I built.** A five-stage agent pipeline (Ingest → Extract → Cluster → Rank →
Brief) on the Claude API, with a web app that streams the pipeline's events while it
runs and lets you drill from a ranked opportunity down to the exact review that
supports it.

**How AI is used.**

- **Structured extraction.** Every item is extracted in batches of 20 with structured
  outputs: sentiment, severity, theme labels, pain points, feature requests, verbatim
  quote spans, and segments. Quotes are verified in code to be real substrings of the
  source; anything that isn't is dropped.
- **Taxonomy first, then consolidation.** A 200-item sample drafts a taxonomy so the
  extractor labels consistently. Labels proposed outside it are kept as raw and merged
  in a consolidation pass with a stated similarity.
- **Scoring is arithmetic, not vibes.** Opportunity score = frequency × severity ×
  recency × strategic fit, where fit is judged against the product context you typed
  in. Every factor is shown with its value and the reason.
- **The brief cites item IDs.** Each claim maps to a source item, so the evidence
  appendix is generated from the data, not from the model's memory.
- **A built-in eval.** A 50-item golden set per dataset reports precision and recall on
  theme assignment. The number sits in the dashboard header.
- **Cost-aware.** A cheaper current-generation model for bulk extraction, a stronger
  one for taxonomy, consolidation and the brief. The taxonomy prompt is cached; the
  live counters show tokens, cost and cache hit rate as the run happens.

**Result.** On the flagship dataset (3,214 reviews across three fictional fitness
trackers): 14 themes, 6 opportunities, 91% extraction precision, 41 seconds, $1.87.

## Screens

| New run | Live run | Dashboard | Opportunity |
| --- | --- | --- | --- |
| ![](docs/screenshots/01-new-run.png) | ![](docs/screenshots/03-live-run-done.png) | ![](docs/screenshots/05-dashboard-drawer.png) | ![](docs/screenshots/06-opportunity.png) |

## Running it

```bash
pnpm install
pnpm dev            # http://localhost:3000, replays the bundled demo run
```

The public demo replays pre-computed runs from `data/runs`, so it costs nothing to
host. To run the pipeline for real:

```bash
cp .env.example .env         # add DISTILL_API_KEY
pnpm data:generate           # builds data/datasets/fitness.json (+ golden set), ~$1.50
pnpm pipeline --dataset fitness --limit 100 --depth fast --out data/runs/fitness-sample.json   # smoke test, ~$0.10
pnpm pipeline --dataset fitness --depth fast --out data/runs/fitness.json                      # full run, ~$1.50
```

Every script has a hard spend cap (`--max-cost`, default $3.00) and stops itself
before the call that would cross it. The dataset generator saves progress after each
batch, so a stopped run resumes without re-spending. `--depth fast` extracts with
Haiku 4.5 and keeps Opus 5 for the taxonomy, consolidation, opportunities and brief,
which is where the writing quality shows. The whole flagship dataset plus a real run
costs about $3 in total, and the hosted demo then costs nothing to serve.

Other scripts:

```bash
pnpm test                    # vitest: pipeline pure functions, replay reducer, layout
pnpm typecheck && pnpm lint
pnpm tsx scripts/build-demo-fixture.ts   # regenerate the design-derived demo run
pnpm tsx scripts/screenshots.ts          # 1440×900 captures from a running dev server
```

## How it's put together

```
src/
├── app/                    Next.js App Router pages and the SSE replay route
│   ├── page.tsx            New run
│   ├── runs/[id]/live      Live run (streams /api/runs/[id]/stream)
│   ├── runs/[id]           Dashboard + evidence drawer (?theme=t01)
│   └── runs/[id]/opportunities/[oppId]
├── components/             Screens and the shared pieces (evidence quote, chips, bars)
│   └── live/               Stage rail, extraction stream, constellation map, counters, log
├── lib/
│   ├── types.ts            Domain types and the PipelineEvent timeline schema
│   ├── replay.ts           Pure reducer: events → live-run state
│   ├── constellation.ts    Deterministic layout for the theme map
│   └── runs.ts             Loads RunFiles from data/runs
└── pipeline/               The agent: ingest, taxonomy, extract, cluster, rank, brief, eval
data/
├── datasets/               Bundled datasets and golden sets
└── runs/                   Pre-computed runs (final Run + event timeline)
design/handoff/             Claude Design prototypes this was built from
```

A pre-computed run and a live run share one wire format: an ordered list of
`PipelineEvent`s with a `t` in seconds. The live screen doesn't know or care which it is
watching.

## Honest notes

- The flagship dataset is **synthetic**: reviews for three fictional apps generated to
  a planned theme distribution, so the demo can show a full run with clean labels. The
  golden set's labels are planted by construction and spot-checked. Upload your own
  data to run on real feedback.
- The demo run bundled today (`fitness-demo`) is derived from the design's mock data
  and shows the intended output shape end to end. It gets replaced by a real pipeline
  run once the dataset is generated.
- Filters on the dashboard are static in this round. The Brief and Trust screens are
  designed in round two.

## Stack

Next.js 16, TypeScript, Tailwind v4, the official Anthropic TypeScript SDK with
structured outputs and prompt caching, Vitest, Playwright for captures, Vercel for
hosting. Fonts: Source Serif 4, IBM Plex Sans, IBM Plex Mono (OFL, self-hosted).
