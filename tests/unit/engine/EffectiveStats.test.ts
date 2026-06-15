import { describe, it, expect } from 'vitest'
import { getEffectiveAttack, getEffectiveDefense } from '../../../server/game/engine/EffectiveStats'
import type { BuffState, PlayerState } from '../../../shared/types/game'

// heroId null → getEffectiveAttack uses its 50 fallback and getEffectiveDefense
// uses player.defense, so the buff math is isolated from hero growth tables.
function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'Test',
    team: 'radiant',
    heroId: null,
    zone: 'mid-river',
    hp: 500,
    maxHp: 500,
    mp: 200,
    maxMp: 200,
    level: 1,
    xp: 0,
    gold: 0,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnTick: null,
    defense: 10,
    magicResist: 15,
    kills: 0,
    deaths: 0,
    assists: 0,
    damageDealt: 0,
    towerDamageDealt: 0,
    killStreak: 0,
    ...overrides,
  }
}

const buff = (id: string, stacks: number): BuffState => ({
  id,
  stacks,
  ticksRemaining: 3,
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
  })

  describe('getEffectiveDefense: cipher Encryption Key shred + sentry Overwatch', () => {
    it('subtracts 2 defense per Encryption Key stack', () => {
      const base = getEffectiveDefense(makePlayer({ defense: 10 }))
      const shredded = getEffectiveDefense(
        makePlayer({ defense: 10, buffs: [buff('encryptionKey', 3)] }),
      )
      expect(base - shredded).toBe(6) // 3 stacks * 2
    })

    it('adds the Overwatch aura defense', () => {
      const base = getEffectiveDefense(makePlayer({ defense: 10 }))
      const aura = getEffectiveDefense(makePlayer({ defense: 10, buffs: [buff('overwatch', 5)] }))
      expect(aura - base).toBe(5)
    })

    it('floors effective defense at 0 under heavy shred', () => {
      expect(
        getEffectiveDefense(makePlayer({ defense: 2, buffs: [buff('encryptionKey', 10)] })),
      ).toBe(0)
    })
  })
})
