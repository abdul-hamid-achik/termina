import { describe, it, expect } from 'vitest'
import {
  damageMixForHeroes,
  counterItemsFor,
  recommendedItemsForRole,
  COUNTER_SKEW_THRESHOLD,
} from '~~/shared/constants/itemBuilds'
import { HERO_IDS, HEROES } from '~~/shared/constants/heroes'
import { getItem } from '~~/shared/constants/items'

describe('damageMixForHeroes', () => {
  it('reads a pure-kinetic and a pure-code hero as opposites', () => {
    // Echo right-clicks; Lambda is all code. If these two ever read the same
    // the mix is measuring nothing.
    const echo = damageMixForHeroes(['echo'])
    const lambda = damageMixForHeroes(['lambda'])
    expect(echo.codeShare).toBe(0)
    expect(lambda.codeShare).toBe(1)
  })

  it('has no opinion about a team that deals no mitigable damage', () => {
    // `null` and `0` are different answers: 0 means "all kinetic, buy plate",
    // null means "nothing to go on". Collapsing them would make an empty
    // lobby look like a kinetic draft.
    expect(damageMixForHeroes([]).codeShare).toBeNull()
    expect(damageMixForHeroes([null, undefined, 'not_a_hero']).codeShare).toBeNull()
  })

  it('ignores ids that are not heroes rather than throwing', () => {
    const mix = damageMixForHeroes(['echo', 'not_a_hero', null])
    expect(mix.codeShare).toBe(0)
    expect(mix.kinetic).toBeGreaterThan(0)
  })

  it('counts the basic attack, not only abilities', () => {
    // A hero's right-click lands every cycle it is in range, so leaving it out
    // would misread every carry as whatever its abilities happen to be.
    const withAttack = damageMixForHeroes(['echo'])
    const abilityDamageEffects = Object.values(HEROES.echo!.abilities).flatMap((a) =>
      (a.effects ?? []).filter((e) => e.type === 'damage'),
    ).length
    expect(withAttack.kinetic).toBe(abilityDamageEffects + 1)
  })

  it('scales with the number of heroes', () => {
    const one = damageMixForHeroes(['lambda'])
    const two = damageMixForHeroes(['lambda', 'lambda'])
    expect(two.code).toBe(one.code * 2)
  })
})

describe('counterItemsFor', () => {
  it('recommends ice against code and plate against kinetic', () => {
    const ice = counterItemsFor(damageMixForHeroes(['lambda', 'regex', 'ping', 'null_ref']))
    const plate = counterItemsFor(damageMixForHeroes(['echo', 'malloc', 'mutex', 'cron']))
    expect(ice.length).toBeGreaterThan(0)
    expect(plate.length).toBeGreaterThan(0)
    expect(ice[0]).not.toBe(plate[0])
  })

  it('recommends nothing when the draft is balanced', () => {
    expect(counterItemsFor({ kinetic: 5, code: 5, codeShare: 0.5 })).toEqual([])
  })

  it('recommends nothing when there is no signal', () => {
    expect(counterItemsFor({ kinetic: 0, code: 0, codeShare: null })).toEqual([])
  })

  it('switches exactly at the threshold, in both directions', () => {
    const justOver = COUNTER_SKEW_THRESHOLD + 0.01
    const justUnder = COUNTER_SKEW_THRESHOLD - 0.01
    expect(counterItemsFor({ kinetic: 0, code: 0, codeShare: justOver }).length).toBeGreaterThan(0)
    expect(counterItemsFor({ kinetic: 0, code: 0, codeShare: justUnder })).toEqual([])
    expect(
      counterItemsFor({ kinetic: 0, code: 0, codeShare: 1 - justOver }).length,
    ).toBeGreaterThan(0)
    expect(counterItemsFor({ kinetic: 0, code: 0, codeShare: 1 - justUnder })).toEqual([])
  })

  it('every counter item exists and actually grants the mitigation it is picked for', () => {
    // The lists are hand-authored strings. A typo, or an item rebalanced to
    // drop its plate/ice, would leave a bot buying something that does not
    // counter anything — and nothing else in the codebase would notice.
    const ice = counterItemsFor({ kinetic: 0, code: 10, codeShare: 1 })
    const plate = counterItemsFor({ kinetic: 10, code: 0, codeShare: 0 })
    for (const id of ice) {
      const item = getItem(id)
      expect(item, `${id} is not a real item`).toBeDefined()
      expect(item?.stats?.ice, `${id} grants no ice`).toBeGreaterThan(0)
    }
    for (const id of plate) {
      const item = getItem(id)
      expect(item, `${id} is not a real item`).toBeDefined()
      expect(item?.stats?.plate, `${id} grants no plate`).toBeGreaterThan(0)
    }
  })

  it('lists counters cheapest-first, so a bot buys the one it can reach', () => {
    for (const mix of [
      { kinetic: 0, code: 10, codeShare: 1 },
      { kinetic: 10, code: 0, codeShare: 0 },
    ]) {
      const costs = counterItemsFor(mix).map((id) => getItem(id)?.cost ?? 0)
      expect(costs, 'a bot would skip the affordable counter').toEqual(
        [...costs].sort((a, b) => a - b),
      )
    }
  })
})

describe('recommendedItemsForRole', () => {
  it('gives every hero in the roster a build made of real items', () => {
    for (const id of HERO_IDS) {
      const build = recommendedItemsForRole(HEROES[id]!.role)
      expect(build.length, `${id} has an empty build`).toBeGreaterThan(0)
      for (const itemId of build) {
        expect(getItem(itemId), `${id}'s build names a nonexistent item: ${itemId}`).toBeDefined()
      }
    }
  })
})
