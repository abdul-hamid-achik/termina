import { describe, it, expect } from 'vitest'
import { heroMatchesFilters, filterHeroes } from '../../../app/utils/heroFilter'
import { HEROES } from '../../../shared/constants/heroes'
import type { AbilityDef, AbilityEffect, HeroDef, HeroRole } from '../../../shared/types/hero'

const ability = (effects: AbilityEffect[]): AbilityDef => ({
  id: 'x',
  name: 'X',
  description: '',
  manaCost: 0,
  cooldownTicks: 0,
  targetType: 'none',
  effects,
})

// Synthetic heroes give the filter clean, data-independent semantics.
function makeHero(role: HeroRole, effects: AbilityEffect[][]): HeroDef {
  const [q, w, e, r] = effects.map(ability)
  return {
    id: 't',
    name: 'T',
    role,
    lore: '',
    baseStats: {
      hp: 600,
      mp: 200,
      attack: 50,
      defense: 0,
      magicResist: 0,
      moveSpeed: 1,
      attackRange: 'ranged',
    },
    growthPerLevel: {},
    passive: ability([]),
    abilities: { q: q!, w: w!, e: e!, r: r! },
  }
}

const burstCarry = makeHero('carry', [
  [{ type: 'damage', value: 100 }],
  [{ type: 'damage', value: 80 }],
  [],
  [],
])
const sustainSupport = makeHero('support', [
  [{ type: 'heal', value: 80 }],
  [{ type: 'shield', value: 100 }],
  [],
  [],
])

describe('heroMatchesFilters (synthetic, clean semantics)', () => {
  it('passes everything when both axes are "all"', () => {
    expect(heroMatchesFilters(burstCarry, 'all', 'all')).toBe(true)
    expect(heroMatchesFilters(sustainSupport, 'all', 'all')).toBe(true)
  })

  it('gates on role independently', () => {
    expect(heroMatchesFilters(burstCarry, 'carry', 'all')).toBe(true)
    expect(heroMatchesFilters(burstCarry, 'support', 'all')).toBe(false)
  })

  it('gates on playstyle independently', () => {
    expect(heroMatchesFilters(burstCarry, 'all', 'Burst')).toBe(true)
    expect(heroMatchesFilters(burstCarry, 'all', 'Sustain')).toBe(false)
    expect(heroMatchesFilters(sustainSupport, 'all', 'Sustain')).toBe(true)
  })

  it('ANDs the two axes — a sustain support is not a burst carry', () => {
    expect(heroMatchesFilters(sustainSupport, 'support', 'Burst')).toBe(false)
    expect(filterHeroes([burstCarry, sustainSupport], 'support', 'Burst')).toHaveLength(0)
  })
})

describe('filterHeroes over the real roster', () => {
  const all = Object.values(HEROES)

  it('"all"/"all" returns the whole roster', () => {
    expect(filterHeroes(all, 'all', 'all')).toHaveLength(all.length)
  })

  it('role filter returns only that role', () => {
    const supports = filterHeroes(all, 'support', 'all')
    expect(supports.length).toBeGreaterThan(0)
    for (const h of supports) expect(h.role).toBe('support')
  })

  it('playstyle filter returns only heroes carrying that tag', () => {
    const mobility = filterHeroes(all, 'all', 'Mobility')
    expect(mobility.length).toBeGreaterThan(0)
    for (const h of mobility) expect(heroMatchesFilters(h, 'all', 'Mobility')).toBe(true)
  })

  it('combined filter is a subset of each single-axis filter', () => {
    const both = filterHeroes(all, 'carry', 'Burst').map((h) => h.id)
    const roleOnly = filterHeroes(all, 'carry', 'all').map((h) => h.id)
    const playOnly = filterHeroes(all, 'all', 'Burst').map((h) => h.id)
    for (const id of both) {
      expect(roleOnly).toContain(id)
      expect(playOnly).toContain(id)
    }
  })
})
