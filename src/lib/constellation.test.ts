import { describe, expect, it } from "vitest";
import { MAP_H, MAP_W, radiusFor, solveLayout } from "./constellation";

const counts = [412, 388, 351, 297, 240, 221, 198, 176, 143, 120, 97, 88, 61, 422];

describe("constellation layout", () => {
  const nodes = [
    ...counts.map((c, i) => ({ id: `t${i}`, r: radiusFor(c) })),
    { id: "x1", r: radiusFor(60), parentId: "t0" },
    { id: "x2", r: radiusFor(45), parentId: "t1" },
    { id: "x3", r: radiusFor(50), parentId: "t2" },
  ];
  const pos = solveLayout(nodes);

  it("places every node inside the map", () => {
    for (const n of nodes) {
      const p = pos.get(n.id)!;
      expect(p.x - n.r).toBeGreaterThanOrEqual(0);
      expect(p.x + n.r).toBeLessThanOrEqual(MAP_W);
      expect(p.y - n.r).toBeGreaterThanOrEqual(0);
      expect(p.y + n.r).toBeLessThanOrEqual(MAP_H);
    }
  });

  it("keeps nodes from overlapping", () => {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = pos.get(nodes[i].id)!;
        const b = pos.get(nodes[j].id)!;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        expect(d, `${nodes[i].id} vs ${nodes[j].id}`).toBeGreaterThanOrEqual(nodes[i].r + nodes[j].r - 1);
      }
    }
  });

  it("is deterministic", () => {
    const again = solveLayout(nodes);
    for (const n of nodes) expect(again.get(n.id)).toEqual(pos.get(n.id));
  });

  it("places a transient near its parent", () => {
    const p = pos.get("t0")!;
    const x = pos.get("x1")!;
    expect(Math.hypot(p.x - x.x, p.y - x.y)).toBeLessThan(160);
  });
});
