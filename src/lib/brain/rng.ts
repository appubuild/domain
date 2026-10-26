/**
 * Small deterministic PRNG (mulberry32) plus string hashing.
 *
 * Determinism matters twice over: results must be reproducible for tests and support
 * "same request → same list", and the browser worker must not produce different output
 * from the Edge Function for identical input.
 */

export function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export type Rng = {
  /** Float in [0, 1). */
  next: () => number;
  /** Integer in [0, maxExclusive). */
  int: (maxExclusive: number) => number;
  pick: <T>(items: readonly T[]) => T | undefined;
  /** Fisher–Yates, returns a new array. */
  shuffle: <T>(items: readonly T[]) => T[];
  /** True with probability p. */
  chance: (p: number) => boolean;
};

export function createRng(seed: number | string): Rng {
  let state = (typeof seed === "string" ? hashString(seed) : seed) >>> 0;
  if (state === 0) state = 0x9e3779b9;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int: (maxExclusive: number) => {
      if (maxExclusive <= 0) return 0;
      return Math.floor(next() * maxExclusive);
    },
    pick: <T>(items: readonly T[]): T | undefined => {
      if (items.length === 0) return undefined;
      return items[Math.floor(next() * items.length)];
    },
    shuffle: <T>(items: readonly T[]): T[] => {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        const a = copy[i];
        const b = copy[j];
        if (a !== undefined && b !== undefined) {
          copy[i] = b;
          copy[j] = a;
        }
      }
      return copy;
    },
    chance: (p: number) => next() < p,
  };
}
