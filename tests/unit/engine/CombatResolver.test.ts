import { describe, it, expect } from 'vitest'
import {
  resolvePhysicalHit,
  computeBladeMailReflect,
} from '../../../server/game/engine/CombatResolver'
import type { PlayerState } from '../../../shared/types/game'
import { HEROES } from '../../../shared/constants/heroes'
import { calculatePhysicalDamage } from '../../../server/game/engine/DamageCalculator'
import { getEffectiveDefense } from '../../../server/game/engine/EffectiveStats'

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  const echo = HEROES.echo!
  return {
    id: 'p1',
    name: 'Player1',
    team: 'radiant',
    heroId: 'echo',
    zone: 'mid-river',
    hp: echo.baseStats.hp,
    maxHp: echo.baseStats.hp,
    mp: echo.baseStats.mp,
    maxMp: echo.baseStats.mp,
    level: 1,
    xp: 0,
    gold: 600,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnTick: null,
    defense: echo.baseStats.defense,
    magicResist: echo.baseStats.magicResist,
    kills: 0,
    deaths: 0,
    assists: 0,
    damageDealt: 0,
    towerDamageDealt: 0,
    killStreak: 0,
    ...overrides,
  }
}

describe('CombatResolver', () => {
  describe('resolvePhysicalHit', () => {
    it('applies full mitigation (effective defense) and reports the HP lost', () => {
      const player = makePlayer({ hp: 500 })
      const raw = 100

      const hit = resolvePhysicalHit(player, raw)

      const expected = calculatePhysicalDamage(raw, getEffectiveDefense(player))
      expect(hit.immune).toBe(false)
      expect(hit.dodged).toBe(false)
      expect(hit.damageDealt).toBe(expected)
      expect(hit.player.hp).toBe(500 - expected)
      expect(hit.player.alive).toBe(true)
    })

    it('honors physical immunity (Ghost/Ethereal/invulnerable) — no HP lost', () => {
      for (const id of ['ghost_form', 'ethereal', 'invulnerable']) {
        const player = makePlayer({
          hp: 500,
          buffs: [{ id, stacks: 1, ticksRemaining: 2, source: 'x' }],
        })
        const hit = resolvePhysicalHit(player, 100)
        expect(hit.immune).toBe(true)
        expect(hit.damageDealt).toBe(0)
        expect(hit.player.hp).toBe(500)
      }
    })

    it('reports a phaseShift dodge and consumes the buff (no HP lost)', () => {
      const player = makePlayer({
        hp: 500,
        buffs: [{ id: 'phaseShift', stacks: 1, ticksRemaining: 1, source: 'echo' }],
      })
      const hit = resolvePhysicalHit(player, 100)
      expect(hit.dodged).toBe(true)
      expect(hit.damageDealt).toBe(0)
      expect(hit.player.hp).toBe(500)
      expect(hit.player.buffs.some((b) => b.id === 'phaseShift')).toBe(false)
    })

    it('absorbs damage through a shield buff, reporting only the unabsorbed HP loss', () => {
      const player = makePlayer({
        hp: 500,
        buffs: [{ id: 'shield', stacks: 40, ticksRemaining: 3, source: 'x' }],
      })
      const raw = 100
      const hit = resolvePhysicalHit(player, raw)

      const mitigated = calculatePhysicalDamage(raw, getEffectiveDefense(player))
      const expectedHpLoss = Math.max(0, mitigated - 40)
      expect(hit.damageDealt).toBe(expectedHpLoss)
      expect(hit.player.hp).toBe(500 - expectedHpLoss)
    })

    it('applies Kernel hardened 10% reduction before shield', () => {
      const hardened = makePlayer({
        hp: 500,
        buffs: [{ id: 'hardened', stacks: 1, ticksRemaining: 99, source: 'kernel' }],
      })
      const plain = makePlayer({ hp: 500 })
      const raw = 100

      const hardenedHit = resolvePhysicalHit(hardened, raw)
      const plainHit = resolvePhysicalHit(plain, raw)

      expect(hardenedHit.damageDealt).toBe(Math.round(plainHit.damageDealt * 0.9))
    })

    it('floors HP at 0 and marks the target dead on a lethal hit', () => {
      const player = makePlayer({ hp: 1 })
      const hit = resolvePhysicalHit(player, 200)
      expect(hit.player.hp).toBe(0)
      expect(hit.player.alive).toBe(false)
      expect(hit.damageDealt).toBe(1)
    })

    it('respects item defense (an armor item reduces damage vs a bare hero)', () => {
      const bare = makePlayer({ hp: 500 })
      const armored = makePlayer({ hp: 500, items: ['chainmail', null, null, null, null, null] })
      const raw = 100

      const bareHit = resolvePhysicalHit(bare, raw)
      const armoredHit = resolvePhysicalHit(armored, raw)

      expect(armoredHit.damageDealt).toBeLessThan(bareHit.damageDealt)
    })
  })

  describe('computeBladeMailReflect', () => {
    it('returns the rounded HP loss as the reflect amount', () => {
      expect(computeBladeMailReflect(0)).toBe(0)
      expect(computeBladeMailReflect(47)).toBe(47)
      expect(computeBladeMailReflect(47.6)).toBe(48)
    })

    it('floors negative input at 0 (never heals the attacker)', () => {
      expect(computeBladeMailReflect(-10)).toBe(0)
    })

    it('applies the fraction when provided', () => {
      expect(computeBladeMailReflect(100, 0.5)).toBe(50)
      expect(computeBladeMailReflect(100, 1)).toBe(100)
    })
  })
})
