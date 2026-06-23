import { describe, it, expect } from 'vitest'
import {
  formatEffect,
  abilitySummary,
  cooldownSeconds,
  abilityImpact,
} from '~~/shared/abilityFormat'
import type { AbilityDef, AbilityEffect } from '~~/shared/types/hero'

const effect = (e: Partial<AbilityEffect>): AbilityEffect => ({ type: 'damage', value: 0, ...e })

describe('formatEffect', () => {
  it('formats damage with its damage type', () => {
    expect(formatEffect(effect({ type: 'damage', value: 40, damageType: 'magical' }))).toBe(
      '40 magical dmg',
    )
  })
  it('defaults damage type to physical', () => {
    expect(formatEffect(effect({ type: 'damage', value: 25 }))).toBe('25 physical dmg')
  })
  it('formats durations in ticks', () => {
    expect(formatEffect(effect({ type: 'slow', value: 30, duration: 2 }))).toBe('30% slow for 2t')
    expect(formatEffect(effect({ type: 'stun', duration: 1 }))).toBe('stun 1t')
    expect(formatEffect(effect({ type: 'stun' }))).toBe('stun 1t')
  })
  it('formats heal / shield / dot / execute', () => {
    expect(formatEffect(effect({ type: 'heal', value: 50 }))).toBe('heal 50')
    expect(formatEffect(effect({ type: 'shield', value: 100 }))).toBe('shield 100')
    expect(formatEffect(effect({ type: 'dot', value: 10, duration: 3 }))).toBe('10 dmg/t for 3t')
    expect(formatEffect(effect({ type: 'execute', value: 15 }))).toBe('execute < 15% hp')
  })
  it('prefers an authored description for buffs', () => {
    expect(formatEffect(effect({ type: 'buff', value: 8, description: 'amp per stack' }))).toBe(
      'amp per stack',
    )
  })
})

describe('abilitySummary', () => {
  const ability = (effects: AbilityEffect[]): AbilityDef => ({
    id: 'x',
    name: 'X',
    description: '',
    manaCost: 0,
    cooldownTicks: 0,
    targetType: 'none',
    effects,
  })
  it('joins multiple effects with a separator', () => {
    expect(
      abilitySummary(
        ability([
          effect({ type: 'damage', value: 40, damageType: 'magical' }),
          effect({ type: 'slow', value: 30, duration: 2 }),
        ]),
      ),
    ).toBe('40 magical dmg · 30% slow for 2t')
  })
  it('falls back to "utility" when there are no effects', () => {
    expect(abilitySummary(ability([]))).toBe('utility')
  })
})

describe('cooldownSeconds', () => {
  it('converts cooldown ticks to seconds at the 4s tick', () => {
    const a = { cooldownTicks: 3 } as AbilityDef
    expect(cooldownSeconds(a, 4000)).toBe(12)
  })
})

describe('abilityImpact', () => {
  const ability = (effects: AbilityEffect[]): AbilityDef => ({
    id: 'x',
    name: 'X',
    description: '',
    manaCost: 0,
    cooldownTicks: 0,
    targetType: 'none',
    effects,
  })

  it('sums immediate damage effects into burst', () => {
    const i = abilityImpact(
      ability([
        effect({ type: 'damage', value: 40, damageType: 'magical' }),
        effect({ type: 'damage', value: 25 }),
      ]),
    )
    expect(i.burst).toBe(65)
    expect(i.dotPerTick).toBe(0)
    expect(i.total).toBe(65)
  })

  it('aggregates DoT per-tick and takes the longest duration', () => {
    const i = abilityImpact(
      ability([
        effect({ type: 'dot', value: 10, duration: 3 }),
        effect({ type: 'dot', value: 5, duration: 5 }),
      ]),
    )
    expect(i.dotPerTick).toBe(15)
    expect(i.dotDuration).toBe(5)
    // total = dotPerTick (15) × longest duration (5) = 75
    expect(i.total).toBe(75)
  })

  it('combines burst + DoT into total over the full duration', () => {
    const i = abilityImpact(
      ability([
        effect({ type: 'damage', value: 50 }),
        effect({ type: 'dot', value: 20, duration: 2 }),
      ]),
    )
    expect(i.total).toBe(50 + 20 * 2) // 90
  })

  it('captures heal and shield sustain', () => {
    const i = abilityImpact(
      ability([effect({ type: 'heal', value: 60 }), effect({ type: 'shield', value: 100 })]),
    )
    expect(i.heal).toBe(60)
    expect(i.shield).toBe(100)
    expect(i.total).toBe(0)
  })

  it('is all-zero for a pure-utility ability', () => {
    const i = abilityImpact(ability([effect({ type: 'slow', value: 30, duration: 2 })]))
    expect(i).toEqual({ burst: 0, dotPerTick: 0, dotDuration: 0, total: 0, heal: 0, shield: 0 })
  })
})
