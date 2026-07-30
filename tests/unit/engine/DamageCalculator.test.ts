import { describe, it, expect } from 'vitest'
import {
  calculateKineticDamage,
  calculateCodeDamage,
  calculateBlackDamage,
  calculateEffectiveDamage,
  getIncomingDamageMultiplier,
  isDamageImmune,
  applyRawDamage,
  applyHeal,
  getHeroStatsAtLevel,
} from '~~/server/game/engine/DamageCalculator'
import type { BuffState, PlayerState } from '~~/shared/types/game'

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'TestPlayer',
    team: 'chaff',
    heroId: 'echo',
    zone: 'mid-t1-chaff',
    integ: 500,
    maxInteg: 500,
    bw: 200,
    maxBw: 200,
    level: 1,
    xp: 0,
    gold: 600,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnTick: null,
    plate: 3,
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

describe('DamageCalculator', () => {
  describe('calculateKineticDamage', () => {
    it('should reduce damage based on plate', () => {
      // 100 attack vs 0 plate = 100 damage
      expect(calculateKineticDamage(100, 0)).toBe(100)
    })

    it('should reduce damage with plate', () => {
      // 100 attack vs 100 plate = 50 damage
      expect(calculateKineticDamage(100, 100)).toBe(50)
    })

    it('should handle high plate', () => {
      // 100 attack vs 300 plate = 25 damage
      expect(calculateKineticDamage(100, 300)).toBe(25)
    })

    it('should handle 0 attack', () => {
      expect(calculateKineticDamage(0, 50)).toBe(0)
    })

    it('should treat negative plate as 0', () => {
      expect(calculateKineticDamage(100, -10)).toBe(100)
    })
  })

  describe('calculateCodeDamage', () => {
    it('should reduce damage based on ice', () => {
      expect(calculateCodeDamage(100, 0)).toBe(100)
    })

    it('should reduce with ice', () => {
      expect(calculateCodeDamage(100, 100)).toBe(50)
    })

    it('should handle 25 MR', () => {
      // 100 * (100 / 125) = 80
      expect(calculateCodeDamage(100, 25)).toBe(80)
    })
  })

  describe('calculateBlackDamage', () => {
    it('should not reduce black damage', () => {
      expect(calculateBlackDamage(100)).toBe(100)
    })

    it('should round to nearest integer', () => {
      expect(calculateBlackDamage(99.7)).toBe(100)
    })
  })

  describe('calculateEffectiveDamage', () => {
    it('should route kinetic damage through plate', () => {
      const result = calculateEffectiveDamage(100, 'kinetic', { plate: 100, ice: 0 })
      expect(result).toBe(50)
    })

    it('should route code damage through ice', () => {
      const result = calculateEffectiveDamage(100, 'code', { plate: 100, ice: 100 })
      expect(result).toBe(50)
    })

    it('should pass black damage through unmodified', () => {
      const result = calculateEffectiveDamage(100, 'black', { plate: 100, ice: 100 })
      expect(result).toBe(100)
    })
  })

  describe('applyRawDamage', () => {
    it('should reduce HP', () => {
      const player = makePlayer({ integ: 500 })
      const result = applyRawDamage(player, 100)
      expect(result.integ).toBe(400)
      expect(result.alive).toBe(true)
    })

    it('should not let HP go below 0', () => {
      const player = makePlayer({ integ: 50 })
      const result = applyRawDamage(player, 100)
      expect(result.integ).toBe(0)
      expect(result.alive).toBe(false)
    })

    it('should mark player as dead when HP reaches 0', () => {
      const player = makePlayer({ integ: 100 })
      const result = applyRawDamage(player, 100)
      expect(result.integ).toBe(0)
      expect(result.alive).toBe(false)
    })

    it('should handle 0 damage', () => {
      const player = makePlayer({ integ: 500 })
      const result = applyRawDamage(player, 0)
      expect(result.integ).toBe(500)
      expect(result.alive).toBe(true)
    })
  })

  describe('applyHeal', () => {
    it('should increase HP', () => {
      const player = makePlayer({ integ: 300, maxInteg: 500 })
      const result = applyHeal(player, 100)
      expect(result.integ).toBe(400)
    })

    it('should not exceed maxInteg', () => {
      const player = makePlayer({ integ: 450, maxInteg: 500 })
      const result = applyHeal(player, 100)
      expect(result.integ).toBe(500)
    })

    it('should handle healing at full HP', () => {
      const player = makePlayer({ integ: 500, maxInteg: 500 })
      const result = applyHeal(player, 100)
      expect(result.integ).toBe(500)
    })
  })

  describe('getHeroStatsAtLevel', () => {
    it('should return base stats at level 1', () => {
      // HeroBaseStats keys remain hp/mp until R4-06.
      const base = { integ: 500, bw: 200, attack: 50, plate: 3, ice: 15 }
      const growth = { integ: 50, bw: 20, attack: 5, plate: 1 }
      const result = getHeroStatsAtLevel(base, growth, 1)
      expect(result.integ).toBe(500)
      expect(result.attack).toBe(50)
    })

    it('should apply growth per level', () => {
      const base = { integ: 500, bw: 200, attack: 50, plate: 3, ice: 15 }
      const growth = { integ: 50, bw: 20, attack: 5, plate: 1 }
      const result = getHeroStatsAtLevel(base, growth, 5)
      // 4 levels of growth
      expect(result.integ).toBe(700)
      expect(result.attack).toBe(70)
      expect(result.plate).toBe(7)
      expect(result.ice).toBe(15) // no ice growth
    })
  })

  describe('getIncomingDamageMultiplier', () => {
    const vuln = (id: string, stacks: number): BuffState => ({
      id,
      stacks,
      ticksRemaining: 3,
      source: 'x',
    })

    it('is 1.0 with no vuln debuffs', () => {
      expect(getIncomingDamageMultiplier(makePlayer(), 'code')).toBe(1)
    })

    it('magic-vuln debuffs amplify CODE only (regex +15%, Veil +25%, Ethereal +40%)', () => {
      expect(
        getIncomingDamageMultiplier(
          makePlayer({ buffs: [vuln('magicVulnerability', 15)] }),
          'code',
        ),
      ).toBeCloseTo(1.15)
      expect(
        getIncomingDamageMultiplier(makePlayer({ buffs: [vuln('veil_discord', 25)] }), 'code'),
      ).toBeCloseTo(1.25)
      // ...but NOT kinetic/black
      expect(
        getIncomingDamageMultiplier(makePlayer({ buffs: [vuln('magic_vuln_40', 40)] }), 'kinetic'),
      ).toBe(1)
    })

    it('thread Yield amplifies ALL damage types (+25%)', () => {
      expect(
        getIncomingDamageMultiplier(makePlayer({ buffs: [vuln('yield', 25)] }), 'code'),
      ).toBeCloseTo(1.25)
      expect(
        getIncomingDamageMultiplier(makePlayer({ buffs: [vuln('yield', 25)] }), 'kinetic'),
      ).toBeCloseTo(1.25)
      expect(
        getIncomingDamageMultiplier(makePlayer({ buffs: [vuln('yield', 25)] }), 'black'),
      ).toBeCloseTo(1.25)
    })

    it('stacks magic-vuln + Yield additively for code damage', () => {
      const p = makePlayer({ buffs: [vuln('veil_discord', 25), vuln('yield', 25)] })
      expect(getIncomingDamageMultiplier(p, 'code')).toBeCloseTo(1.5) // 1 + (25+25)/100
    })

    it('ignores unrelated buffs', () => {
      expect(
        getIncomingDamageMultiplier(makePlayer({ buffs: [vuln('shield', 100)] }), 'code'),
      ).toBe(1)
    })
  })

  describe('isDamageImmune', () => {
    const buff = (id: string): BuffState => ({ id, stacks: 1, ticksRemaining: 2, source: 'x' })

    it('invulnerable blocks every damage type', () => {
      const p = makePlayer({ buffs: [buff('invulnerable')] })
      expect(isDamageImmune(p, 'kinetic')).toBe(true)
      expect(isDamageImmune(p, 'code')).toBe(true)
      expect(isDamageImmune(p, 'black')).toBe(true)
    })

    it('airgap (BKB) blocks code only', () => {
      const p = makePlayer({ buffs: [buff('airgap')] })
      expect(isDamageImmune(p, 'code')).toBe(true)
      expect(isDamageImmune(p, 'kinetic')).toBe(false)
    })

    it('ethereal / ghost_form block kinetic only', () => {
      expect(isDamageImmune(makePlayer({ buffs: [buff('ethereal')] }), 'kinetic')).toBe(true)
      expect(isDamageImmune(makePlayer({ buffs: [buff('ghost_form')] }), 'kinetic')).toBe(true)
      expect(isDamageImmune(makePlayer({ buffs: [buff('ethereal')] }), 'code')).toBe(false)
    })

    it('is false with no immunity buffs', () => {
      expect(isDamageImmune(makePlayer(), 'kinetic')).toBe(false)
    })
  })
})
