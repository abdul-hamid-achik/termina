import { describe, it, expect } from 'vitest'
import { abilityManaTable, getAbilityManaCost } from '~~/shared/utils/ability'
import { HEROES } from '~~/shared/constants/heroes'
import type { AbilityDef } from '~~/shared/types/hero'

const scaling: AbilityDef = {
  id: 'test-q',
  name: 'Test',
  description: '',
  manaCost: 50,
  manaCostByLevel: [50, 65, 80, 95],
  cooldownTicks: 5,
  targetType: 'hero',
  effects: [],
}

const flat: AbilityDef = { ...scaling, manaCost: 80, manaCostByLevel: undefined }

const ult: AbilityDef = {
  ...scaling,
  id: 'test-r',
  manaCost: 200,
  manaCostByLevel: [200, 300, 400],
}

describe('getAbilityManaCost', () => {
  it('returns the rank cost for the player level, not the rank-1 headline', () => {
    // Basic abilities rank up at 1/3/5/7.
    expect(getAbilityManaCost(scaling, 'q', 1)).toBe(50)
    expect(getAbilityManaCost(scaling, 'q', 2)).toBe(50)
    expect(getAbilityManaCost(scaling, 'q', 3)).toBe(65)
    expect(getAbilityManaCost(scaling, 'q', 5)).toBe(80)
    expect(getAbilityManaCost(scaling, 'q', 7)).toBe(95)
  })

  it('clamps to the last entry past max rank', () => {
    expect(getAbilityManaCost(scaling, 'q', 25)).toBe(95)
  })

  it('follows the ultimate rank schedule for R', () => {
    // R ranks up at 6/12/18 — a level-11 hero is still on rank 1.
    expect(getAbilityManaCost(ult, 'r', 11)).toBe(200)
    expect(getAbilityManaCost(ult, 'r', 12)).toBe(300)
    expect(getAbilityManaCost(ult, 'r', 18)).toBe(400)
  })

  it('quotes the rank-1 cost for an ability that is not learned yet', () => {
    // Rank 0 (R below level 6) is rejected by the level gate long before mana
    // is checked; previewing 0 would read as free.
    expect(getAbilityManaCost(ult, 'r', 1)).toBe(200)
  })

  it('returns the flat cost when the ability does not scale', () => {
    expect(getAbilityManaCost(flat, 'q', 1)).toBe(80)
    expect(getAbilityManaCost(flat, 'q', 25)).toBe(80)
  })
})

describe('abilityManaTable', () => {
  it('reads the registry table for a scaling ability', () => {
    expect(abilityManaTable('cipher', 'r')).toEqual(HEROES.cipher!.abilities.r.manaCostByLevel)
  })

  it('collapses a flat-cost ability to a single entry', () => {
    // Sentry's costs do not scale, so the registry carries no table.
    expect(abilityManaTable('sentry', 'q')).toEqual([HEROES.sentry!.abilities.q.manaCost])
  })

  it('throws on an unknown hero so a resolver typo fails at load', () => {
    expect(() => abilityManaTable('nosuchhero', 'q')).toThrow(/Unknown hero ability/)
  })
})
