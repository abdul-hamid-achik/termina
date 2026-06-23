import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  fastGameFactor,
  scaledTickIntervalMs,
  scaledAncientHp,
  scaledTowerHp,
  scaledRespawnTicks,
} from '../../../server/game/engine/fastGame'

/**
 * fastGame.ts is the dev/test accelerator that paces the play-to-the-end e2e
 * specs — its clamp/scale math was the only server/game/engine module without a
 * test. All five functions read env at call time, so the env is set per-case.
 */
const ENV_KEYS = ['NODE_ENV', 'TERMINA_TEST_HOOKS', 'TERMINA_TEST_FAST_GAME'] as const
let saved: Record<string, string | undefined> = {}

beforeEach(() => {
  saved = {}
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  // Default posture: not real production (vitest NODE_ENV='test'), so the factor
  // is honored; hooks on; no factor set yet.
  process.env.TERMINA_TEST_HOOKS = '1'
  delete process.env.TERMINA_TEST_FAST_GAME
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('fastGameFactor', () => {
  it('is 1 when the var is unset', () => {
    expect(fastGameFactor()).toBe(1)
  })

  it('is 1 for non-finite or <= 1 values', () => {
    process.env.TERMINA_TEST_FAST_GAME = 'abc'
    expect(fastGameFactor()).toBe(1)
    process.env.TERMINA_TEST_FAST_GAME = '1'
    expect(fastGameFactor()).toBe(1)
    process.env.TERMINA_TEST_FAST_GAME = '0.5'
    expect(fastGameFactor()).toBe(1)
  })

  it('returns the parsed factor, capped at 16', () => {
    process.env.TERMINA_TEST_FAST_GAME = '8'
    expect(fastGameFactor()).toBe(8)
    process.env.TERMINA_TEST_FAST_GAME = '999'
    expect(fastGameFactor()).toBe(16)
  })

  it('is forced to 1 in real production regardless of the var', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.TERMINA_TEST_HOOKS // hooks OFF → isRealProduction() true
    process.env.TERMINA_TEST_FAST_GAME = '8'
    expect(fastGameFactor()).toBe(1)
  })
})

describe('scaled helpers at factor 8', () => {
  beforeEach(() => {
    process.env.TERMINA_TEST_FAST_GAME = '8'
  })

  it('scaledTickIntervalMs divides by the factor with a 100ms floor', () => {
    expect(scaledTickIntervalMs(4000)).toBe(500) // 4000/8
    expect(scaledTickIntervalMs(400)).toBe(100) // 400/8=50 → floored to 100
  })

  it('scaledAncientHp divides by the full (uncapped) factor', () => {
    expect(scaledAncientHp(6400)).toBe(800) // 6400/8
  })

  it('scaledTowerHp caps the divisor at 4 (towers gate the game)', () => {
    expect(scaledTowerHp(800)).toBe(200) // 800 / min(8,4)=4
  })

  it('scaledRespawnTicks MULTIPLIES by the factor (wall-clock parity)', () => {
    expect(scaledRespawnTicks(10)).toBe(80) // 10*8
  })

  it('every scaled value floors at 1', () => {
    expect(scaledAncientHp(1)).toBe(1)
    expect(scaledTowerHp(1)).toBe(1)
  })
})

describe('scaled helpers at factor 1 (no acceleration)', () => {
  it('are identity transforms', () => {
    expect(scaledTickIntervalMs(4000)).toBe(4000)
    expect(scaledAncientHp(6400)).toBe(6400)
    expect(scaledTowerHp(800)).toBe(800)
    expect(scaledRespawnTicks(10)).toBe(10)
  })
})
