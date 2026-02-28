import { describe, it, expect } from 'vitest'
import {
  calculatePhysicalDamage,
  calculateMagicalDamage,
  calculatePureDamage,
  calculateEffectiveDamage,
  applyRawDamage,
  applyHeal,
  getHeroStatsAtLevel,
} from '../../../server/game/engine/DamageCalculator'
import type { PlayerState } from '../../../shared/types/game'

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'TestPlayer',
    team: 'radiant',
    heroId: 'echo',
    zone: 'mid-t1-rad',
    hp: 500,
    maxHp: 500,
    mp: 200,
    maxMp: 200,
    level: 1,
    xp: 0,
    gold: 600,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnTick: null,
    defense: 3,
    magicResist: 15,
    kills: 0,
    deaths: 0,
    assists: 0,
    damageDealt: 0,
    towerDamageDealt: 0,
    ...overrides,
  }
}

describe('DamageCalculator', () => {
  describe('calculatePhysicalDamage', () => {
    it('should reduce damage based on defense', () => {
      // 100 attack vs 0 defense = 100 damage
      expect(calculatePhysicalDamage(100, 0)).toBe(100)
    })

    it('should reduce damage with defense', () => {
      // 100 attack vs 100 defense = 50 damage
      expect(calculatePhysicalDamage(100, 100)).toBe(50)
    })

    it('should handle high defense', () => {
      // 100 attack vs 300 defense = 25 damage
      expect(calculatePhysicalDamage(100, 300)).toBe(25)
    })

    it('should handle 0 attack', () => {
      expect(calculatePhysicalDamage(0, 50)).toBe(0)
    })

    it('should treat negative defense as 0', () => {
      expect(calculatePhysicalDamage(100, -10)).toBe(100)
    })
  })

  describe('calculateMagicalDamage', () => {
    it('should reduce damage based on magic resist', () => {
      expect(calculateMagicalDamage(100, 0)).toBe(100)
    })

    it('should reduce with magic resist', () => {
      expect(calculateMagicalDamage(100, 100)).toBe(50)
    })

    it('should handle 25 MR', () => {
      // 100 * (100 / 125) = 80
      expect(calculateMagicalDamage(100, 25)).toBe(80)
    })
  })

  describe('calculatePureDamage', () => {
    it('should not reduce pure damage', () => {
      expect(calculatePureDamage(100)).toBe(100)
    })

    it('should round to nearest integer', () => {
      expect(calculatePureDamage(99.7)).toBe(100)
    })
  })

  describe('calculateEffectiveDamage', () => {
    it('should route physical damage through defense', () => {
      const result = calculateEffectiveDamage(100, 'physical', { defense: 100, magicResist: 0 })
      expect(result).toBe(50)
    })

    it('should route magical damage through magic resist', () => {
      const result = calculateEffectiveDamage(100, 'magical', { defense: 100, magicResist: 100 })
      expect(result).toBe(50)
    })

    it('should pass pure damage through unmodified', () => {
      const result = calculateEffectiveDamage(100, 'pure', { defense: 100, magicResist: 100 })
      expect(result).toBe(100)
    })
  })

  describe('applyRawDamage', () => {
    it('should reduce HP', () => {
      const player = makePlayer({ hp: 500 })
      const result = applyRawDamage(player, 100)
      expect(result.hp).toBe(400)
      expect(result.alive).toBe(true)
    })

    it('should not let HP go below 0', () => {
      const player = makePlayer({ hp: 50 })
      const result = applyRawDamage(player, 100)
      expect(result.hp).toBe(0)
      expect(result.alive).toBe(false)
    })

    it('should mark player as dead when HP reaches 0', () => {
      const player = makePlayer({ hp: 100 })
      const result = applyRawDamage(player, 100)
      expect(result.hp).toBe(0)
      expect(result.alive).toBe(false)
    })

    it('should handle 0 damage', () => {
      const player = makePlayer({ hp: 500 })
      const result = applyRawDamage(player, 0)
      expect(result.hp).toBe(500)
      expect(result.alive).toBe(true)
    })
  })

  describe('applyHeal', () => {
    it('should increase HP', () => {
      const player = makePlayer({ hp: 300, maxHp: 500 })
      const result = applyHeal(player, 100)
      expect(result.hp).toBe(400)
    })

    it('should not exceed maxHp', () => {
      const player = makePlayer({ hp: 450, maxHp: 500 })
      const result = applyHeal(player, 100)
      expect(result.hp).toBe(500)
    })

    it('should handle healing at full HP', () => {
      const player = makePlayer({ hp: 500, maxHp: 500 })
      const result = applyHeal(player, 100)
      expect(result.hp).toBe(500)
    })
  })

  describe('getHeroStatsAtLevel', () => {
    it('should return base stats at level 1', () => {
      const base = { hp: 500, mp: 200, attack: 50, defense: 3, magicResist: 15 }
      const growth = { hp: 50, mp: 20, attack: 5, defense: 1 }
      const result = getHeroStatsAtLevel(base, growth, 1)
      expect(result.hp).toBe(500)
      expect(result.attack).toBe(50)
    })

    it('should apply growth per level', () => {
      const base = { hp: 500, mp: 200, attack: 50, defense: 3, magicResist: 15 }
      const growth = { hp: 50, mp: 20, attack: 5, defense: 1 }
      const result = getHeroStatsAtLevel(base, growth, 5)
      // 4 levels of growth
      expect(result.hp).toBe(700)
      expect(result.attack).toBe(70)
      expect(result.defense).toBe(7)
      expect(result.magicResist).toBe(15) // no MR growth
    })
  })
})
