import { describe, it, expect } from 'vitest'
import {
  formatEffect,
  abilitySummary,
  cooldownSeconds,
  abilityImpact,
  abilityControls,
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
    expect(formatEffect(effect({ type: 'dot', value: 90, duration: 3 }))).toBe('90 dmg over 3t')
    expect(formatEffect(effect({ type: 'execute', value: 15 }))).toBe('execute < 15% hp')
  })
  it('prefers an authored description for buffs', () => {
    expect(formatEffect(effect({ type: 'buff', value: 8, description: 'amp per stack' }))).toBe(
      'amp per stack',
    )
  })

  it.each([
    [{ type: 'silence', duration: 2 }, 'silence 2t'],
    [{ type: 'silence' }, 'silence'],
    [{ type: 'root', duration: 2 }, 'root 2t'],
    [{ type: 'root' }, 'root'],
    [{ type: 'taunt', duration: 1 }, 'taunt 1t'],
    [{ type: 'fear', duration: 2 }, 'fear 2t'],
    [{ type: 'teleport' }, 'teleport'],
    [{ type: 'reveal' }, 'reveal'],
  ] as const)('formats %o as "%s"', (input, expected) => {
    expect(formatEffect(effect(input))).toBe(expected)
  })

  it('falls back to a generated label when buff/debuff have no description', () => {
    expect(formatEffect(effect({ type: 'buff', value: 8 }))).toBe('buff +8')
    expect(formatEffect(effect({ type: 'debuff', value: 5 }))).toBe('debuff 5')
    // whitespace-only description still falls back
    expect(formatEffect(effect({ type: 'buff', value: 3, description: '   ' }))).toBe('buff +3')
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

  it('treats DoT value as total, deriving per-tick, and takes the longest duration', () => {
    const i = abilityImpact(
      ability([
        effect({ type: 'dot', value: 60, duration: 3 }), // 20/t
        effect({ type: 'dot', value: 50, duration: 5 }), // 10/t
      ]),
    )
    expect(i.dotPerTick).toBe(30) // 20 + 10
    expect(i.dotDuration).toBe(5)
    // total = sum of DoT totals (60 + 50)
    expect(i.total).toBe(110)
  })

  it('combines burst + DoT totals', () => {
    const i = abilityImpact(
      ability([
        effect({ type: 'damage', value: 50 }),
        effect({ type: 'dot', value: 60, duration: 3 }),
      ]),
    )
    expect(i.dotPerTick).toBe(20)
    expect(i.total).toBe(50 + 60) // 110
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

describe('abilityControls', () => {
  const ability = (effects: AbilityEffect[]): AbilityDef => ({
    id: 'x',
    name: 'X',
    description: '',
    manaCost: 0,
    cooldownTicks: 0,
    targetType: 'none',
    effects,
  })

  it('extracts each control with an uppercase label + duration', () => {
    const c = abilityControls(
      ability([
        effect({ type: 'stun', duration: 2 }),
        effect({ type: 'slow', value: 30, duration: 3 }),
      ]),
    )
    expect(c).toEqual([
      { kind: 'stun', label: 'STUNNED', duration: 2 },
      { kind: 'slow', label: 'SLOW 30%', duration: 3 },
    ])
  })

  it('defaults a missing/zero duration to 1 tick', () => {
    expect(abilityControls(ability([effect({ type: 'silence' })]))).toEqual([
      { kind: 'silence', label: 'SILENCED', duration: 1 },
    ])
    expect(abilityControls(ability([effect({ type: 'root', duration: 0 })]))).toEqual([
      { kind: 'root', label: 'ROOTED', duration: 1 },
    ])
  })

  it('labels taunt + fear', () => {
    const c = abilityControls(
      ability([effect({ type: 'taunt', duration: 1 }), effect({ type: 'fear', duration: 2 })]),
    )
    expect(c.map((x) => x.label)).toEqual(['TAUNTED', 'FEARED'])
  })

  it('ignores damage/heal/shield/dot/buff effects', () => {
    expect(
      abilityControls(
        ability([
          effect({ type: 'damage', value: 50 }),
          effect({ type: 'heal', value: 20 }),
          effect({ type: 'dot', value: 60, duration: 3 }),
          effect({ type: 'buff', value: 5 }),
        ]),
      ),
    ).toEqual([])
  })
})
