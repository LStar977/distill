/**
 * Layout for the constellation theme map (design take 1a). Pure and
 * deterministic: golden-angle spiral for primary themes, transients tucked
 * against their parent, then a short relaxation pass so nothing overlaps.
 */
export interface LayoutNode {
  id: string;
  r: number;
  parentId?: string;
}

export interface Point {
  x: number;
  y: number;
}

export const MAP_W = 640;
export const MAP_H = 600;
export const CX = MAP_W / 2;
export const CY = MAP_H / 2;

/** Node radius from mentions. */
export const radiusFor = (count: number) => 8 + Math.sqrt(Math.max(0, count)) * 1.9;

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

export function solveLayout(nodes: LayoutNode[]): Map<string, Point> {
  const pos = new Map<string, Point>();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const primaries = nodes.filter((n) => !n.parentId || !byId.has(n.parentId)).sort((a, b) => b.r - a.r);
  const transients = nodes.filter((n) => n.parentId && byId.has(n.parentId));

  const GA = Math.PI * (3 - Math.sqrt(5));
  primaries.forEach((n, k) => {
    const rad = 64 * Math.sqrt(k);
    const a = k * GA + 0.6;
    pos.set(n.id, { x: CX + rad * Math.cos(a), y: CY + rad * 0.85 * Math.sin(a) });
  });
  transients.forEach((n, k) => {
    const p = pos.get(n.parentId!)!;
    const pr = byId.get(n.parentId!)!.r;
    const a = 1.1 + k * 2.1;
    const d = pr + n.r + 14;
    pos.set(n.id, { x: p.x + d * Math.cos(a), y: p.y + d * Math.sin(a) });
  });

  const list = nodes.map((n) => ({ n, p: pos.get(n.id)! }));
  for (let it = 0; it < 160; it++) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        let dx = b.p.x - a.p.x;
        let dy = b.p.y - a.p.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const min = a.n.r + b.n.r + 16;
        if (d < min) {
          const push = (min - d) / 2;
          dx /= d;
          dy /= d;
          a.p.x -= dx * push;
          a.p.y -= dy * push;
          b.p.x += dx * push;
          b.p.y += dy * push;
        }
      }
    }
    for (const { n, p } of list) {
      p.x += (CX - p.x) * 0.004;
      p.y += (CY - p.y) * 0.004;
      p.x = clamp(p.x, n.r + 8, MAP_W - 8 - n.r);
      p.y = clamp(p.y, n.r + 20, MAP_H - 20 - n.r);
    }
  }
  return pos;
}
