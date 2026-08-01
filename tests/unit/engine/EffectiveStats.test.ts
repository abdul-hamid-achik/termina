import { describe, it, expect } from 'vitest'
import { getEffectiveAttack, getEffectivePlate } from '~~/server/game/engine/EffectiveStats'
import type { BuffState, PlayerState } from '~~/shared/types/game'

// heroId null → getEffectiveAttack uses its 50 fallback and getEffectivePlate
// uses player.plate, so the buff math is isolated from hero growth tables.
function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'Test',
    team: 'chaff',
    heroId: null,
    zone: 'coldstore-cross',
    integ: 500,
    maxInteg: 500,
    bw: 200,
    maxBw: 200,
    level: 1,
    xp: 0,
    scrip: 0,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnCycle: null,
    plate: 10,
    ice: 15,
    kills: 0,
    deaths: 0,
    assists: 0,
    damageDealt: 0,
    iceDamageDealt: 0,
    killStreak: 0,
    ...overrides,
  }
}

const buff = (id: string, stacks: number): BuffState => ({
  id,
  stacks,
  cyclesRemaining: 3,
  source: 'x',
})

describe('EffectiveStats — revived stat modifiers', () => {
  describe('getEffectiveAttack: ping Timeout attackReduction', () => {
    it('reduces effective attack by the buff percent', () => {
      const base = getEffectiveAttack(makePlayer()) // 50 fallback
      const reduced = getEffectiveAttack(makePlayer({ buffs: [buff('attackReduction', 20)] }))
      expect(reduced).toBe(Math.round(base * 0.8))
      expect(reduced).toBeLessThan(base)
    })

    it('caps the reduction at 100% (never negative attack)', () => {
      expect(getEffectiveAttack(makePlayer({ buffs: [buff('attackReduction', 150)] }))).toBe(0)
    })

    it('does nothing without the buff', () => {
      expect(getEffectiveAttack(makePlayer())).toBe(50)
    })

    it('adds Hurricane Pike’s post-thrust attack steroid (was dead — no reader)', () => {
      const base = getEffectiveAttack(makePlayer()) // 50 fallback
      const boosted = getEffectiveAttack(
        makePlayer({ buffs: [buff('kickback_splice_attacks', 30)] }),
      )
      expect(boosted).toBe(base + 30)
    })
  })

  describe('getEffectivePlate: cipher Encryption Key shred + sentry Overwatch', () => {
    it('subtracts 2 plate per Encryption Key stack', () => {
      const base = getEffectivePlate(makePlayer({ plate: 10 }))
      const shredded = getEffectivePlate(
        makePlayer({ plate: 10, buffs: [buff('encryptionKey', 3)] }),
      )
      expect(base - shredded).toBe(6) // 3 stacks * 2
    })

    it('adds the Overwatch aura plate', () => {
      const base = getEffectivePlate(makePlayer({ plate: 10 }))
      const aura = getEffectivePlate(makePlayer({ plate: 10, buffs: [buff('overwatch', 5)] }))
      expect(aura - base).toBe(5)
    })

    it('floors effective plate at 0 under heavy shred', () => {
      expect(getEffectivePlate(makePlayer({ plate: 2, buffs: [buff('encryptionKey', 10)] }))).toBe(
        0,
      )
    })
  })
})
