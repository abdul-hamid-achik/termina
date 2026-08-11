/**
 * Deterministic PRNG for tick resolution — the batch clock commits every
 * cycle's instructions at once, so replaying the same actions against the
 * same state must always produce the same crit rolls, procs, and NPC spawn
 * choices. Pure, allocation-light, no module-level mutable RNG state (game
 * fibers interleave — see GameLoop.processCycle, which derives a fresh `rng`
 * per tick from `state.rngSeed` and passes it down explicitly).
 */

/**
 * Combine a per-game seed with the current cycle number into one 32-bit
 * integer, so every tick draws from an independent deterministic stream.
 * A murmur3-style avalanche finalizer — cheap, well-distributed, no
 * allocation.
 */
export function mix(seed: number, cycle: number): number {
  let h = (seed ^ cycle) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  h = (h ^ (h >>> 16)) >>> 0
  return h
}

/**
 * mulberry32: a small, fast 32-bit PRNG. Given a seed, returns a `() =>
 * number` generator of floats in `[0, 1)` — a drop-in replacement for
 * `Math.random()` with a deterministic, seedable stream. Same seed always
 * produces the same sequence; different seeds diverge immediately.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function rng(): number {
    a = (a + 0x6d2b79f5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Stable 32-bit hash (FNV-1a) of a string — the fallback seed source for
 * `GameState`s created before `rngSeed` existed (old snapshots, older
 * fixtures). Deterministic per gameId, so resolution stays reproducible even
 * without a stamped seed.
 */
export function hashStringToSeed(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
