import { describe, expect, it } from "vitest";
import type { Extraction, Item, Theme } from "../lib/types";
import { computeSegments, ensureProblemNumbers, evidenceFor, relatedThemes, resolveEvidence, type Candidate } from "./opportunities";
import { countWords } from "../lib/text";
import { validateCitations } from "./brief";

const items: Item[] = [
  { id: "a", source: "IronLog", text: "Great logging but the rest timer just stops counting the second I lock my phone. Missed my 3-minute rest twice." },
  { id: "b", source: "SetCount", text: "Timer dies if I switch to Spotify for ten seconds." },
  { id: "c", source: "LiftLab", text: "Paying monthly and the timer still resets itself in the background. Fix the basics first." },
];
function ex(itemId: string, quote: string, segments: string[] = [], themes = ["Rest timer"]): Extraction {
  const item = items.find((i) => i.id === itemId)!;
  const start = item.text.indexOf(quote);
  return { itemId, sentiment: "negative", severity: 4, themes, painPoints: [], featureRequests: [], quotes: [{ start, end: start + quote.length, text: quote }], segments };
}
const candidates: Candidate[] = [
  { item: items[0]!, extraction: ex("a", "the rest timer just stops counting the second I lock my phone", ["Paid subscriber"]) },
  { item: items[1]!, extraction: ex("b", "Timer dies if I switch to Spotify", []) },
  { item: items[2]!, extraction: ex("c", "the timer still resets itself in the background", ["Paid subscriber"], ["Rest timer", "Subscription"]) },
];

describe("evidence", () => {
  it("builds pre/quote/post from the item text", () => {
    expect(evidenceFor(items[0]!, "the rest timer just stops counting the second I lock my phone")).toEqual({
      itemId: "a",
      pre: "Great logging but ",
      quote: "the rest timer just stops counting the second I lock my phone",
      post: ". Missed my 3-minute rest twice.",
    });
    expect(evidenceFor(items[0]!, "not present")).toBeNull();
  });

  it("drops unknown ids and non-substring quotes, then tops up from candidates", () => {
    const { evidence, dropped } = resolveEvidence(
      [
        { itemId: "b", quote: "Timer dies if I switch to Spotify" },
        { itemId: "zzz", quote: "Timer dies" },
        { itemId: "a", quote: "the timer stops when I lock my phone" },
        { itemId: "b", quote: "Spotify" },
      ],
      candidates,
    );
    expect(dropped).toBe(3);
    expect(evidence.map((e) => e.itemId)).toEqual(["b", "a", "c"]);
    for (const e of evidence) {
      const item = items.find((i) => i.id === e.itemId)!;
      expect(item.text).toBe(`${e.pre}${e.quote}${e.post}`);
    }
  });
});

describe("segments and related themes", () => {
  const theme: Theme = { id: "rest", rank: 1, name: "Rest timer", short: "Rest timer", description: "", count: 3, share: 0.5, sentiment: "negative", sentimentSplit: [0, 0, 100], severityAvg: 4, trend: [], exampleItemIds: [] };
  const extractions = new Map(candidates.map((c) => [c.item.id, c.extraction]));
  const byId = new Map(items.map((i) => [i.id, i]));
  it("computes segment shares from extraction segments", () => {
    expect(computeSegments(theme, byId, extractions)).toEqual([{ name: "Paid subscriber", share: 67 }]);
  });
  it("finds co-occurring themes by id", () => {
    const sub: Theme = { ...theme, id: "sub", name: "Subscription" };
    expect(relatedThemes(theme, [theme, sub], extractions)).toEqual(["sub"]);
  });
  it("appends count and share when the problem statement lacks them", () => {
    const t: Theme = { ...theme, count: 412, share: 0.128 };
    expect(ensureProblemNumbers("Timer stops when locked", t)).toBe("Timer stops when locked. 412 reviews (12.8%) mention it.");
    expect(ensureProblemNumbers("412 reviews (12.8%) cite it.", t)).toBe("412 reviews (12.8%) cite it.");
  });
});

describe("brief helpers", () => {
  it("strips unknown citations and counts the rest", () => {
    const r = validateCitations("Timer breaks [item:a] and [item:nope]. More [item:b].", new Set(["a", "b"]));
    expect(r.markdown).toBe("Timer breaks [item:a] and. More [item:b].");
    expect(r.citations).toBe(2);
    expect(r.unresolved).toBe(1);
  });
  it("counts words without markdown noise", () => {
    expect(countWords("## Title\n\nHello **world** — 412 reviews [item:x].\n\n| a | b |\n|---|---|")).toBe(7);
  });
});
