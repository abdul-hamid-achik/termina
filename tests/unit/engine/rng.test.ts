import { describe, it, expect } from 'vitest'
import { mix, mulberry32, hashStringToSeed } from '~~/server/game/engine/rng'

describe('rng — mulberry32', () => {
  it('same seed produces the same sequence', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    const seqA = [a(), a(), a(), a(), a()]
    const seqB = [b(), b(), b(), b(), b()]
    expect(seqA).toEqual(seqB)
  })

  it('different seeds produce different sequences', () => {
    const a = mulberry32(1)
    const b = mulberry32(2)
    const seqA = [a(), a(), a(), a()]
    const seqB = [b(), b(), b(), b()]
    expect(seqA).not.toEqual(seqB)
  })

  it('produces floats in [0, 1)', () => {
    const rng = mulberry32(9001)
    for (let i = 0; i < 1000; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('is a generator — each call advances the stream (not constant)', () => {
    const rng = mulberry32(7)
    const draws = new Set([rng(), rng(), rng(), rng(), rng()])
    expect(draws.size).toBeGreaterThan(1)
  })

  it('seed 0 does not produce a degenerate (all-zero) stream', () => {
    const rng = mulberry32(0)
    const draws = [rng(), rng(), rng()]
    expect(draws.some((v) => v !== 0)).toBe(true)
  })
})

describe('rng — mix', () => {
  it('is deterministic: same inputs -> same output', () => {
    expect(mix(123, 45)).toBe(mix(123, 45))
  })

  it('different cycles produce different mixed values for the same seed', () => {
    const values = new Set([mix(123, 1), mix(123, 2), mix(123, 3), mix(123, 4), mix(123, 5)])
    expect(values.size).toBe(5)
  })

  it('different seeds produce different mixed values for the same cycle', () => {
    expect(mix(1, 100)).not.toBe(mix(2, 100))
  })

  it('always returns a non-negative 32-bit integer', () => {
    for (const [seed, cycle] of [
      [0, 0],
      [-1, 5],
      [2 ** 31 - 1, 2 ** 20],
      [-(2 ** 31), 0],
    ]) {
      const v = mix(seed!, cycle!)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(Number.isInteger(v)).toBe(true)
    }
  })
})

describe('rng — end-to-end per-tick derivation (mix + mulberry32)', () => {
  it('same seed + same cycle -> identical derived stream', () => {
    const streamAt = (seed: number, cycle: number) => {
      const rng = mulberry32(mix(seed, cycle))
      return [rng(), rng(), rng()]
    }
    expect(streamAt(999, 10)).toEqual(streamAt(999, 10))
  })

  it('same seed, different cycle -> different derived stream', () => {
    const streamAt = (seed: number, cycle: number) => {
      const rng = mulberry32(mix(seed, cycle))
      return [rng(), rng(), rng()]
    }
    expect(streamAt(999, 10)).not.toEqual(streamAt(999, 11))
  })

  it('different seed, same cycle -> different derived stream', () => {
    const streamAt = (seed: number, cycle: number) => {
      const rng = mulberry32(mix(seed, cycle))
      return [rng(), rng(), rng()]
    }
    expect(streamAt(1, 10)).not.toEqual(streamAt(2, 10))
  })
})

describe('rng — hashStringToSeed', () => {
  it('is deterministic for the same input', () => {
    expect(hashStringToSeed('game-abc-123')).toBe(hashStringToSeed('game-abc-123'))
  })

  it('differs across different gameIds (in practice, not by contract)', () => {
    expect(hashStringToSeed('game-abc-123')).not.toBe(hashStringToSeed('game-xyz-789'))
  })

  it('returns a non-negative 32-bit integer', () => {
    const h = hashStringToSeed('')
    expect(h).toBeGreaterThanOrEqual(0)
    expect(h).toBeLessThan(2 ** 32)
  })

  it('handles an empty string without throwing', () => {
    expect(() => hashStringToSeed('')).not.toThrow()
  })
})
