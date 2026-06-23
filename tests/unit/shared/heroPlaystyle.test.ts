import { describe, it, expect } from 'vitest'
import { heroPlaystyleTags, type PlaystyleTag } from '../../../shared/heroPlaystyle'
import { HEROES } from '../../../shared/constants/heroes'
import type { AbilityDef, AbilityEffect, HeroDef } from '../../../shared/types/hero'

const ability = (effects: AbilityEffect[]): AbilityDef => ({
  id: 'x',
  name: 'X',
  description: '',
  manaCost: 0,
  cooldownTicks: 0,
  targetType: 'none',
  effects,
})

const dmg = (value = 50): AbilityEffect => ({ type: 'damage', value })

function makeHero(q: AbilityDef, w: AbilityDef, e: AbilityDef, r: AbilityDef): HeroDef {
  return {
    id: 't',
    name: 'Tester',
    role: 'mage',
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
    abilities: { q, w, e, r },
  }
}

describe('heroPlaystyleTags', () => {
  it('tags Burst when 2+ abilities deal direct damage', () => {
    const hero = makeHero(ability([dmg()]), ability([dmg()]), ability([]), ability([]))
    expect(heroPlaystyleTags(hero)).toContain('Burst')
  })

  it('tags Damage over time when 2+ abilities apply a DoT', () => {
    const dot = ability([{ type: 'dot', value: 60, duration: 3 }])
    expect(heroPlaystyleTags(makeHero(dot, dot, ability([]), ability([])))).toContain(
      'Damage over time',
    )
  })

  it('tags Control when 2+ abilities apply a disable', () => {
    const stun = ability([{ type: 'stun', value: 0, duration: 2 }])
    const slow = ability([{ type: 'slow', value: 30, duration: 3 }])
    expect(heroPlaystyleTags(makeHero(stun, slow, ability([]), ability([])))).toContain('Control')
  })

  it('tags Sustain for any heal or shield', () => {
    const heal = ability([{ type: 'heal', value: 80 }])
    expect(heroPlaystyleTags(makeHero(heal, ability([]), ability([]), ability([])))).toContain(
      'Sustain',
    )
    const shield = ability([{ type: 'shield', value: 100 }])
    expect(heroPlaystyleTags(makeHero(shield, ability([]), ability([]), ability([])))).toContain(
      'Sustain',
    )
  })

  it('tags Mobility for any teleport', () => {
    const tp = ability([{ type: 'teleport', value: 0 }])
    expect(heroPlaystyleTags(makeHero(tp, ability([]), ability([]), ability([])))).toContain(
      'Mobility',
    )
  })

  it('can carry multiple tags and emits them in canonical order', () => {
    const hero = makeHero(
      ability([dmg(), { type: 'stun', value: 0, duration: 1 }]),
      ability([dmg(), { type: 'slow', value: 20, duration: 2 }]),
      ability([{ type: 'heal', value: 50 }]),
      ability([]),
    )
    const tags = heroPlaystyleTags(hero)
    expect(tags).toEqual(['Burst', 'Control', 'Sustain'])
  })

  it('never returns an empty list — a damage-light kit still falls back', () => {
    const oneDamage = makeHero(ability([dmg()]), ability([]), ability([]), ability([]))
    expect(heroPlaystyleTags(oneDamage)).toEqual(['Burst'])
    const oneDot = makeHero(
      ability([{ type: 'dot', value: 30, duration: 2 }]),
      ability([]),
      ability([]),
      ability([]),
    )
    expect(heroPlaystyleTags(oneDot)).toEqual(['Damage over time'])
  })

  it('gives every real hero at least one tag from the known set', () => {
    const known: PlaystyleTag[] = ['Burst', 'Damage over time', 'Control', 'Sustain', 'Mobility']
    for (const hero of Object.values(HEROES)) {
      const tags = heroPlaystyleTags(hero)
      expect(tags.length, `${hero.id} should have ≥1 tag`).toBeGreaterThanOrEqual(1)
      for (const t of tags) expect(known).toContain(t)
    }
  })
})
