import { describe, it, expect } from 'vitest'
import { heroMatchesFilters, filterHeroes } from '~~/app/utils/heroFilter'
import { HEROES } from '~~/shared/constants/heroes'
import type { AbilityDef, AbilityEffect, HeroDef, HeroPosture } from '~~/shared/types/hero'

const ability = (effects: AbilityEffect[]): AbilityDef => ({
  id: 'x',
  name: 'X',
  description: '',
  bwCost: 0,
  cooldownCycles: 0,
  targetType: 'none',
  effects,
})

// Synthetic heroes give the filter clean, data-independent semantics.
function makeHero(posture: HeroPosture, effects: AbilityEffect[][]): HeroDef {
  const [q, w, e, r] = effects.map(ability)
  return {
    id: 't',
    name: 'T',
    role: 'carry',
    posture,
    baseStats: {
      integ: 600,
      bw: 200,
      attack: 50,
      plate: 0,
      ice: 0,
    },
    growthPerLevel: {},
    passive: ability([]),
    abilities: { q: q!, w: w!, e: e!, r: r! },
  }
}

const burstBreach = makeHero('BREACH', [
  [{ type: 'damage', value: 100 }],
  [{ type: 'damage', value: 80 }],
  [],
  [],
])
const sustainHold = makeHero('HOLD', [
  [{ type: 'heal', value: 80 }],
  [{ type: 'shield', value: 100 }],
  [],
  [],
])

describe('heroMatchesFilters (synthetic, clean semantics)', () => {
  it('passes everything when both axes are "all"', () => {
    expect(heroMatchesFilters(burstBreach, 'all', 'all')).toBe(true)
    expect(heroMatchesFilters(sustainHold, 'all', 'all')).toBe(true)
  })

  it('gates on posture independently', () => {
    expect(heroMatchesFilters(burstBreach, 'BREACH', 'all')).toBe(true)
    expect(heroMatchesFilters(burstBreach, 'HOLD', 'all')).toBe(false)
  })

  it('gates on playstyle independently', () => {
    expect(heroMatchesFilters(burstBreach, 'all', 'Burst')).toBe(true)
    expect(heroMatchesFilters(burstBreach, 'all', 'Sustain')).toBe(false)
    expect(heroMatchesFilters(sustainHold, 'all', 'Sustain')).toBe(true)
  })

  it('ANDs the two axes — a sustain HOLD is not a burst BREACH', () => {
    expect(heroMatchesFilters(sustainHold, 'HOLD', 'Burst')).toBe(false)
    expect(filterHeroes([burstBreach, sustainHold], 'HOLD', 'Burst')).toHaveLength(0)
  })
})

describe('filterHeroes over the real roster', () => {
  const all = Object.values(HEROES)

  it('"all"/"all" returns the whole roster', () => {
    expect(filterHeroes(all, 'all', 'all')).toHaveLength(all.length)
  })

  it('posture filter returns only that posture', () => {
    const holds = filterHeroes(all, 'HOLD', 'all')
    expect(holds.length).toBeGreaterThan(0)
    for (const h of holds) expect(h.posture).toBe('HOLD')
  })

  it('playstyle filter returns only heroes carrying that tag', () => {
    const mobility = filterHeroes(all, 'all', 'Mobility')
    expect(mobility.length).toBeGreaterThan(0)
    for (const h of mobility) expect(heroMatchesFilters(h, 'all', 'Mobility')).toBe(true)
  })

  it('combined filter is a subset of each single-axis filter', () => {
    const both = filterHeroes(all, 'BREACH', 'Burst').map((h) => h.id)
    const postureOnly = filterHeroes(all, 'BREACH', 'all').map((h) => h.id)
    const playOnly = filterHeroes(all, 'all', 'Burst').map((h) => h.id)
    for (const id of both) {
      expect(postureOnly).toContain(id)
      expect(playOnly).toContain(id)
    }
  })
})
