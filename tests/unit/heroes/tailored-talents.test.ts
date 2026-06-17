import { describe, it, expect } from 'vitest'
import { TALENT_TREES } from '../../../shared/constants/talents'
import { HEROES } from '../../../shared/constants/heroes'

/**
 * Structural guard for the HERO-TAILORED talent trees (replacing the bland
 * generic menu, one hero per increment — see termina-talent-identity). Adding a
 * newly-tailored hero is just appending its id here; this catches the whole
 * no-op talent bug class without a bespoke per-hero behavioral test (the engine
 * application itself is proven once in malloc.test.ts + tests/gameplay/talents).
 *
 * The sharpest check: a `damage_boost` talent only fires on an ability that deals
 * INSTANT damage during the cast (applyAbilityTalents keys on hpLost that tick).
 * Put it on a self-buff / pure-disable / DoT and it silently does nothing — which
 * is exactly what the generic tree did by boosting Q on heroes whose Q isn't a
 * nuke. This asserts every tailored damage_boost sits on a real instant-damage
 * ability.
 */
const TAILORED_HEROES = ['malloc', 'cipher'] as const

describe('Tailored talent trees', () => {
  for (const heroId of TAILORED_HEROES) {
    describe(heroId, () => {
      const tree = TALENT_TREES[heroId]
      const hero = HEROES[heroId]

      it('has all four tiers with two options each', () => {
        for (const tier of [10, 15, 20, 25] as const) {
          expect(tree.tiers[tier]).toHaveLength(2)
        }
      })

      it('has no dead special / ability_boost / specialEffect talents', () => {
        for (const t of Object.values(tree.tiers).flat()) {
          expect(t.type).not.toBe('special')
          expect(t.type).not.toBe('ability_boost')
          expect((t as { specialEffect?: string }).specialEffect).toBeUndefined()
        }
      })

      it('only puts damage_boost on an ability that deals instant damage', () => {
        for (const t of Object.values(tree.tiers).flat()) {
          if (t.type !== 'damage_boost' || !t.abilityId) continue
          const ability = hero.abilities[t.abilityId]
          const dealsInstantDamage = ability.effects.some(
            (e) => e.type === 'damage' && !('duration' in e && e.duration),
          )
          expect(
            dealsInstantDamage,
            `${heroId} ${t.id} boosts ${t.abilityId} which deals no instant damage (silent no-op)`,
          ).toBe(true)
        }
      })

      it('points every ability-targeted talent at a real ability slot', () => {
        for (const t of Object.values(tree.tiers).flat()) {
          if (!t.abilityId) continue
          expect(['q', 'w', 'e', 'r']).toContain(t.abilityId)
          expect(hero.abilities[t.abilityId]).toBeDefined()
        }
      })
    })
  }
})
