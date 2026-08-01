import { describe, it, expect } from 'vitest'
import { resolveKineticHit, computeSpitePlateReflect } from '~~/server/game/engine/CombatResolver'
import type { PlayerState } from '~~/shared/types/game'
import { HEROES } from '~~/shared/constants/heroes'
import { calculateKineticDamage } from '~~/server/game/engine/DamageCalculator'
import { getEffectivePlate } from '~~/server/game/engine/EffectiveStats'

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  const echo = HEROES.echo!
  return {
    id: 'p1',
    name: 'Player1',
    team: 'chaff',
    heroId: 'echo',
    zone: 'coldstore-cross',
    integ: echo.baseStats.integ,
    maxInteg: echo.baseStats.integ,
    bw: echo.baseStats.bw,
    maxBw: echo.baseStats.bw,
    level: 1,
    xp: 0,
    scrip: 600,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnCycle: null,
    plate: echo.baseStats.plate,
    ice: echo.baseStats.ice,
    kills: 0,
    deaths: 0,
    assists: 0,
    damageDealt: 0,
    iceDamageDealt: 0,
    killStreak: 0,
    ...overrides,
  }
}

describe('CombatResolver', () => {
  describe('resolveKineticHit', () => {
    it('applies full mitigation (effective plate) and reports the INTEG lost', () => {
      const player = makePlayer({ integ: 500 })
      const raw = 100

      const hit = resolveKineticHit(player, raw)

      const expected = calculateKineticDamage(raw, getEffectivePlate(player))
      expect(hit.immune).toBe(false)
      expect(hit.dodged).toBe(false)
      expect(hit.damageDealt).toBe(expected)
      expect(hit.player.integ).toBe(500 - expected)
      expect(hit.player.alive).toBe(true)
    })

    it('honors kinetic immunity (Ghost/Ethereal/invulnerable) — no INTEG lost', () => {
      for (const id of ['ghost_form', 'ethereal', 'invulnerable']) {
        const player = makePlayer({
          integ: 500,
          buffs: [{ id, stacks: 1, cyclesRemaining: 2, source: 'x' }],
        })
        const hit = resolveKineticHit(player, 100)
        expect(hit.immune).toBe(true)
        expect(hit.damageDealt).toBe(0)
        expect(hit.player.integ).toBe(500)
      }
    })

    it('reports a phaseShift dodge and consumes the buff (no INTEG lost)', () => {
      const player = makePlayer({
        integ: 500,
        buffs: [{ id: 'phaseShift', stacks: 1, cyclesRemaining: 1, source: 'echo' }],
      })
      const hit = resolveKineticHit(player, 100)
      expect(hit.dodged).toBe(true)
      expect(hit.damageDealt).toBe(0)
      expect(hit.player.integ).toBe(500)
      expect(hit.player.buffs.some((b) => b.id === 'phaseShift')).toBe(false)
    })

    it('absorbs damage through a shield buff, reporting only the unabsorbed INTEG loss', () => {
      const player = makePlayer({
        integ: 500,
        buffs: [{ id: 'shield', stacks: 40, cyclesRemaining: 3, source: 'x' }],
      })
      const raw = 100
      const hit = resolveKineticHit(player, raw)

      const mitigated = calculateKineticDamage(raw, getEffectivePlate(player))
      const expectedHpLoss = Math.max(0, mitigated - 40)
      expect(hit.damageDealt).toBe(expectedHpLoss)
      expect(hit.player.integ).toBe(500 - expectedHpLoss)
    })

    it('applies Kernel hardened 10% reduction before shield', () => {
      const hardened = makePlayer({
        integ: 500,
        buffs: [{ id: 'hardened', stacks: 1, cyclesRemaining: 99, source: 'kernel' }],
      })
      const plain = makePlayer({ integ: 500 })
      const raw = 100

      const hardenedHit = resolveKineticHit(hardened, raw)
      const plainHit = resolveKineticHit(plain, raw)

      expect(hardenedHit.damageDealt).toBe(Math.round(plainHit.damageDealt * 0.9))
    })

    it('floors INTEG at 0 and marks the target dead on a lethal hit', () => {
      const player = makePlayer({ integ: 1 })
      const hit = resolveKineticHit(player, 200)
      expect(hit.player.integ).toBe(0)
      expect(hit.player.alive).toBe(false)
      expect(hit.damageDealt).toBe(1)
    })

    it('respects item plate (an armor item reduces damage vs a bare hero)', () => {
      const bare = makePlayer({ integ: 500 })
      const armored = makePlayer({
        integ: 500,
        items: ['plate_weave', null, null, null, null, null],
      })
      const raw = 100

      const bareHit = resolveKineticHit(bare, raw)
      const armoredHit = resolveKineticHit(armored, raw)

      expect(armoredHit.damageDealt).toBeLessThan(bareHit.damageDealt)
    })
  })

  describe('computeSpitePlateReflect', () => {
    it('returns the rounded INTEG loss as the reflect amount', () => {
      expect(computeSpitePlateReflect(0)).toBe(0)
      expect(computeSpitePlateReflect(47)).toBe(47)
      expect(computeSpitePlateReflect(47.6)).toBe(48)
    })

    it('floors negative input at 0 (never heals the attacker)', () => {
      expect(computeSpitePlateReflect(-10)).toBe(0)
    })

    it('applies the fraction when provided', () => {
      expect(computeSpitePlateReflect(100, 0.5)).toBe(50)
      expect(computeSpitePlateReflect(100, 1)).toBe(100)
    })
  })
})
