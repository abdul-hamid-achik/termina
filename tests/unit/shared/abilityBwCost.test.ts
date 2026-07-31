import { describe, it, expect } from 'vitest'
import { abilityBwTable, getAbilityBwCost } from '~~/shared/utils/ability'
import { HEROES } from '~~/shared/constants/heroes'
import type { AbilityDef } from '~~/shared/types/hero'

const scaling: AbilityDef = {
  id: 'test-q',
  name: 'Test',
  description: '',
  bwCost: 50,
  bwCostByLevel: [50, 65, 80, 95],
  cooldownCycles: 5,
  targetType: 'hero',
  effects: [],
}

const flat: AbilityDef = { ...scaling, bwCost: 80, bwCostByLevel: undefined }

const ult: AbilityDef = {
  ...scaling,
  id: 'test-r',
  bwCost: 200,
  bwCostByLevel: [200, 300, 400],
}

describe('getAbilityBwCost', () => {
  it('returns the rank cost for the player level, not the rank-1 headline', () => {
    // Basic abilities rank up at 1/3/5/7.
    expect(getAbilityBwCost(scaling, 'q', 1)).toBe(50)
    expect(getAbilityBwCost(scaling, 'q', 2)).toBe(50)
    expect(getAbilityBwCost(scaling, 'q', 3)).toBe(65)
    expect(getAbilityBwCost(scaling, 'q', 5)).toBe(80)
    expect(getAbilityBwCost(scaling, 'q', 7)).toBe(95)
  })

  it('clamps to the last entry past max rank', () => {
    expect(getAbilityBwCost(scaling, 'q', 25)).toBe(95)
  })

  it('follows the ultimate rank schedule for R', () => {
    // R ranks up at 6/12/18 — a level-11 hero is still on rank 1.
    expect(getAbilityBwCost(ult, 'r', 11)).toBe(200)
    expect(getAbilityBwCost(ult, 'r', 12)).toBe(300)
    expect(getAbilityBwCost(ult, 'r', 18)).toBe(400)
  })

  it('quotes the rank-1 cost for an ability that is not learned yet', () => {
    // Rank 0 (R below level 6) is rejected by the level gate long before mana
    // is checked; previewing 0 would read as free.
    expect(getAbilityBwCost(ult, 'r', 1)).toBe(200)
  })

  it('returns the flat cost when the ability does not scale', () => {
    expect(getAbilityBwCost(flat, 'q', 1)).toBe(80)
    expect(getAbilityBwCost(flat, 'q', 25)).toBe(80)
  })
})

describe('abilityBwTable', () => {
  it('reads the registry table for a scaling ability', () => {
    expect(abilityBwTable('cipher', 'r')).toEqual(HEROES.cipher!.abilities.r.bwCostByLevel)
  })

  it('collapses a flat-cost ability to a single entry', () => {
    // Sentry's costs do not scale, so the registry carries no table.
    expect(abilityBwTable('sentry', 'q')).toEqual([HEROES.sentry!.abilities.q.bwCost])
  })

  it('throws on an unknown hero so a resolver typo fails at load', () => {
    expect(() => abilityBwTable('nosuchhero', 'q')).toThrow(/Unknown hero ability/)
  })
})
