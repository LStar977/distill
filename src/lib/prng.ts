/**
 * Small seeded PRNG helpers. Deterministic output for a given seed so that
 * sampling (taxonomy draft) and dataset generation are reproducible.
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
  /** Pick one element uniformly. Throws on an empty array. */
  pick<T>(arr: readonly T[]): T;
  /** Pick an index according to non-negative weights. */
  weighted(weights: readonly number[]): number;
  /** Fisher–Yates shuffle, returns a new array. */
  shuffle<T>(arr: readonly T[]): T[];
}

/** Hash a string to a 32-bit seed (FNV-1a). */
export function hashSeed(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — tiny, fast, good enough for sampling. */
export function createRng(seed: number | string): Rng {
  let a = typeof seed === "string" ? hashSeed(seed) : seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    int(n) {
      return Math.floor(next() * n);
    },
    pick(arr) {
      if (arr.length === 0) throw new Error("pick() on an empty array");
      return arr[Math.floor(next() * arr.length)] as (typeof arr)[number];
    },
    weighted(weights) {
      let total = 0;
      for (const w of weights) total += Math.max(0, w);
      if (total <= 0) return 0;
      let r = next() * total;
      for (let i = 0; i < weights.length; i++) {
        r -= Math.max(0, weights[i] ?? 0);
        if (r < 0) return i;
      }
      return weights.length - 1;
    },
    shuffle(arr) {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = out[i] as (typeof out)[number];
        out[i] = out[j] as (typeof out)[number];
        out[j] = tmp;
      }
      return out;
    },
  };
  return rng;
}

/** Deterministic sample of `n` distinct elements. */
export function sample<T>(arr: readonly T[], n: number, seed: number | string): T[] {
  if (n >= arr.length) return arr.slice();
  return createRng(seed).shuffle(arr).slice(0, n);
}
