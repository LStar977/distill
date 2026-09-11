import { describe, expect, it } from "vitest";
import type { Extraction } from "../lib/types";
import { alignLabels, evaluate } from "./eval";

function ex(itemId: string, themes: string[], sentiment: Extraction["sentiment"]): [string, Extraction] {
  return [itemId, { itemId, sentiment, severity: 3, themes, painPoints: [], featureRequests: [], quotes: [], segments: [] }];
}

describe("evaluate", () => {
  it("computes micro precision/recall and sentiment accuracy on a tiny hand-built case", () => {
    // gold: 1:{A}, 2:{A,B}, 3:{B}, 4:{C}  → 5 gold labels
    // pred: 1:{A}, 2:{A}, 3:{B,C}, 4:{D}  → 5 predicted labels, 3 true positives
    const extractions = new Map([ex("1", ["A"], "negative"), ex("2", ["A"], "mixed"), ex("3", ["B", "C"], "negative"), ex("4", ["D"], "positive"), ex("9", ["A"], "negative")]);
    const golden = {
      items: [
        { itemId: "1", themes: ["A"], sentiment: "negative" as const },
        { itemId: "2", themes: ["A", "B"], sentiment: "negative" as const },
        { itemId: "3", themes: ["B"], sentiment: "negative" as const },
        { itemId: "4", themes: ["C"], sentiment: "positive" as const },
        { itemId: "missing", themes: ["A"], sentiment: "negative" as const },
      ],
    };
    const r = evaluate({ extractions, golden, alignment: "exact" });
    expect(r.n).toBe(4);
    expect(r.themePrecision).toBeCloseTo(3 / 5, 3);
    expect(r.themeRecall).toBeCloseTo(3 / 5, 3);
    expect(r.sentimentAccuracy).toBeCloseTo(3 / 4, 3);
  });

  it("aligns renamed labels greedily by co-occurrence", () => {
    const extractions = new Map([ex("1", ["Background timer failures"], "negative"), ex("2", ["Background timer failures"], "negative"), ex("3", ["Watch loses sets"], "negative")]);
    const golden = {
      items: [
        { itemId: "1", themes: ["Rest timer unreliable in background"], sentiment: "negative" as const },
        { itemId: "2", themes: ["Rest timer unreliable in background"], sentiment: "negative" as const },
        { itemId: "3", themes: ["Apple Watch sync drops sets"], sentiment: "negative" as const },
      ],
    };
    expect(evaluate({ extractions, golden, alignment: "exact" }).themePrecision).toBe(0);
    const r = evaluate({ extractions, golden });
    expect(r.themePrecision).toBe(1);
    expect(r.themeRecall).toBe(1);
  });

  it("alignLabels pins exact matches and never maps two gold labels to one prediction", () => {
    const m = alignLabels([
      { gold: ["a"], pred: ["a"] },
      { gold: ["b"], pred: ["a"] },
      { gold: ["c"], pred: ["x"] },
      { gold: ["c"], pred: ["x"] },
    ]);
    expect(m.get("a")).toBe("a");
    expect(m.get("b")).toBe("b");
    expect(m.get("c")).toBe("x");
  });

  it("treats Other as the absence of a label", () => {
    const extractions = new Map([ex("1", ["Other / uncategorized"], "neutral")]);
    const golden = { items: [{ itemId: "1", themes: ["Other / uncategorized"], sentiment: "neutral" as const }] };
    const r = evaluate({ extractions, golden });
    expect(r.themePrecision).toBe(1);
    expect(r.themeRecall).toBe(1);
  });
});
