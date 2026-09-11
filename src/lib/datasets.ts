import type { DatasetMeta } from "./types";

/**
 * Bundled demo datasets. Each ships with a pre-computed run in data/runs so the
 * public demo replays for free. `runId` is null until that run exists.
 */
export interface DemoDataset extends DatasetMeta {
  runId: string | null;
  estimate: { thorough: string; fast: string };
}

export const DATASETS: DemoDataset[] = [
  {
    id: "fitness",
    kind: "App Store reviews",
    name: "Fitness tracker app reviews",
    meta: "3,214 items · 3 apps · 14 months",
    description: "IronLog, SetCount and LiftLab. The flagship demo.",
    itemCount: 3214,
    sources: ["IronLog", "SetCount", "LiftLab"],
    defaultContext: {
      product:
        "IronLog is a paid workout tracker for strength athletes on iOS and Apple Watch. We're deciding what to fix before the next annual-pricing push.",
    },
    runId: "fitness-demo",
    estimate: { thorough: "~45s · ~$1.90", fast: "~20s · ~$0.80" },
  },
  {
    id: "saas-tickets",
    kind: "Support tickets",
    name: "SaaS support tickets",
    meta: "1,800 items · 1 product · 9 months",
    description: "A fictional B2B analytics tool.",
    itemCount: 1800,
    sources: ["Helpdesk"],
    defaultContext: {
      product: "A self-serve B2B analytics tool for product teams. We're deciding what to fix to reduce ticket volume before the enterprise launch.",
    },
    runId: null,
    estimate: { thorough: "~30s · ~$1.10", fast: "~14s · ~$0.45" },
  },
  {
    id: "nps",
    kind: "NPS verbatims",
    name: "NPS survey responses",
    meta: "950 items · scores 0–10 · 2 quarters",
    description: "Free-text answers with promoter scores.",
    itemCount: 950,
    sources: ["Q2 survey", "Q3 survey"],
    defaultContext: {
      product: "A consumer budgeting app. We're deciding which two things to fix this quarter to move detractors to passives.",
    },
    runId: null,
    estimate: { thorough: "~18s · ~$0.65", fast: "~9s · ~$0.25" },
  },
];

export const getDataset = (id: string) => DATASETS.find((d) => d.id === id);

export const LIVE_CAP = 500;
