// ============================================================
// Random number generation, isolated so every consumer can be
// made deterministic in tests. rules.ts already accepts an
// injectable `() => number`; this is the supply side of that seam.
// ============================================================

export type Rng = () => number;

export const systemRng: Rng = Math.random;

/**
 * Small seeded PRNG. Not cryptographic — the point is reproducible games
 * for tests and the headless script, where a failing seed can be replayed.
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
