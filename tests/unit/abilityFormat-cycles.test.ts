import { describe, it, expect } from 'vitest'
import { formatEffect, abilitySummary } from '~~/shared/abilityFormat'
import { HEROES } from '~~/shared/constants/heroes'
import type { AbilityEffect } from '~~/shared/types/hero'

/**
 * The player-facing time word is CYCLE (1 cycle = 4 s). abilityFormat used to
 * render durations as "Nt" ticks; `tick` is not a word players are given.
 */
const effect = (e: Partial<AbilityEffect>): AbilityEffect => ({ type: 'damage', value: 0, ...e })

describe('abilityFormat renders durations in cycles', () => {
  it.each([
    [{ type: 'slow', value: 30, duration: 2 }, '30% slow for 2 cycles'],
    [{ type: 'slow', value: 30, duration: 1 }, '30% slow for 1 cycle'],
    [{ type: 'stun', duration: 1 }, 'stun 1 cycle'],
    [{ type: 'stun', duration: 3 }, 'stun 3 cycles'],
    [{ type: 'stun' }, 'stun 1 cycle'],
    [{ type: 'silence', duration: 2 }, 'silence 2 cycles'],
    [{ type: 'root', duration: 2 }, 'root 2 cycles'],
    [{ type: 'taunt', duration: 1 }, 'taunt 1 cycle'],
    [{ type: 'fear', duration: 2 }, 'fear 2 cycles'],
    [{ type: 'dot', value: 90, duration: 3 }, '90 dmg over 3 cycles'],
  ] as const)('formats %o as "%s"', (input, expected) => {
    expect(formatEffect(effect(input))).toBe(expected)
  })

  it('leaves a duration-less effect without a time suffix', () => {
    expect(formatEffect(effect({ type: 'silence' }))).toBe('silence')
    expect(formatEffect(effect({ type: 'root' }))).toBe('root')
  })

  it('never renders a tick suffix for any real hero effect or summary', () => {
    for (const hero of Object.values(HEROES)) {
      for (const slot of ['q', 'w', 'e', 'r'] as const) {
        const ability = hero.abilities[slot]
        for (const e of ability.effects) {
          // Authored descriptions pass through untouched; check generated text only.
          if (e.description?.trim() && (e.type === 'buff' || e.type === 'debuff')) continue
          expect(formatEffect(e), `${hero.id} ${slot}`).not.toMatch(/\d\s?t\b/)
        }
        expect(abilitySummary(ability), `${hero.id} ${slot}`).not.toMatch(/\d\s?t\b(?!\w)/)
      }
    }
  })

  it("states the duration as the effect's own number of cycles for every timed hero effect", () => {
    let checked = 0
    for (const hero of Object.values(HEROES)) {
      for (const slot of ['q', 'w', 'e', 'r'] as const) {
        for (const e of hero.abilities[slot].effects) {
          if (!['slow', 'stun', 'silence', 'root', 'taunt', 'fear', 'dot'].includes(e.type))
            continue
          if (!e.duration) continue
          expect(formatEffect(e), `${hero.id} ${slot} ${e.type}`).toMatch(
            new RegExp(`\\b${e.duration} ${e.duration === 1 ? 'cycle' : 'cycles'}\\b`),
          )
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(20)
  })
})
