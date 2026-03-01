import { describe, it, expect } from 'vitest'
import { HEROES, HERO_IDS } from '../../../shared/constants/heroes'
import type { HeroDef } from '../../../shared/types/hero'

describe('Hero Definitions', () => {
  it('should have exactly 18 heroes', () => {
    expect(HERO_IDS.length).toBe(18)
  })

  it('should have all expected hero IDs', () => {
    const expected = [
      'echo', 'sentry', 'daemon', 'kernel', 'regex', 'socket',
      'proxy', 'malloc', 'cipher', 'firewall',
      'null_ref', 'lambda', 'mutex', 'ping', 'cron', 'traceroute',
      'thread', 'cache',
    ]
    for (const id of expected) {
      expect(HERO_IDS).toContain(id)
    }
  })

  it('should have unique hero IDs matching their keys', () => {
    for (const [key, hero] of Object.entries(HEROES)) {
      expect(hero.id).toBe(key)
    }
  })

  const VALID_ROLES = ['carry', 'support', 'assassin', 'tank', 'mage', 'offlaner'] as const

  for (const [heroId, hero] of Object.entries(HEROES)) {
    describe(`${hero.name} (${heroId})`, () => {
      it('has a valid role', () => {
        expect(VALID_ROLES).toContain(hero.role)
      })

      it('has non-empty lore', () => {
        expect(hero.lore.length).toBeGreaterThan(0)
      })

      it('has valid base stats', () => {
        const s = hero.baseStats
        expect(s.hp).toBeGreaterThanOrEqual(400)
        expect(s.hp).toBeLessThanOrEqual(800)
        expect(s.mp).toBeGreaterThanOrEqual(200)
        expect(s.mp).toBeLessThanOrEqual(450)
        expect(s.attack).toBeGreaterThanOrEqual(30)
        expect(s.attack).toBeLessThanOrEqual(70)
        expect(s.defense).toBeGreaterThanOrEqual(1)
        expect(s.defense).toBeLessThanOrEqual(10)
        expect(s.magicResist).toBeGreaterThanOrEqual(10)
        expect(s.magicResist).toBeLessThanOrEqual(30)
        expect(s.moveSpeed).toBeGreaterThanOrEqual(1)
        expect(s.moveSpeed).toBeLessThanOrEqual(3)
        expect(['melee', 'ranged']).toContain(s.attackRange)
      })

      it('has growth per level stats', () => {
        const g = hero.growthPerLevel
        expect(g.hp).toBeGreaterThan(0)
        expect(g.attack).toBeGreaterThan(0)
      })

      it('has a valid passive ability', () => {
        const p = hero.passive
        expect(p.id).toBeTruthy()
        expect(p.name).toBeTruthy()
        expect(p.description.length).toBeGreaterThan(0)
        expect(p.manaCost).toBe(0)
        expect(p.cooldownTicks).toBe(0)
        expect(p.targetType).toBe('none')
        expect(p.effects.length).toBeGreaterThan(0)
      })

      it('has all 4 abilities (q, w, e, r)', () => {
        const a = hero.abilities
        expect(a.q).toBeDefined()
        expect(a.w).toBeDefined()
        expect(a.e).toBeDefined()
        expect(a.r).toBeDefined()
      })

      for (const [slot, ability] of Object.entries(hero.abilities)) {
        it(`${slot.toUpperCase()}: ${ability.name} — has valid structure`, () => {
          expect(ability.id).toBeTruthy()
          expect(ability.name).toBeTruthy()
          expect(ability.description.length).toBeGreaterThan(0)
          expect(ability.manaCost).toBeGreaterThan(0)
          expect(ability.cooldownTicks).toBeGreaterThan(0)
          expect(ability.effects.length).toBeGreaterThan(0)
        })
      }
    })
  }

  it('covers all roles with at least one hero', () => {
    const roleSet = new Set(Object.values(HEROES).map((h: HeroDef) => h.role))
    for (const role of VALID_ROLES) {
      expect(roleSet.has(role)).toBe(true)
    }
  })

  it('has at least 5 melee and 3 ranged heroes for team diversity', () => {
    const melee = Object.values(HEROES).filter((h: HeroDef) => h.baseStats.attackRange === 'melee')
    const ranged = Object.values(HEROES).filter((h: HeroDef) => h.baseStats.attackRange === 'ranged')
    expect(melee.length).toBeGreaterThanOrEqual(5)
    expect(ranged.length).toBeGreaterThanOrEqual(3)
  })
})
