import { describe, it, expect } from 'vitest'
import { registerAllHeroes, getHeroResolver } from '../../../server/game/heroes'
import { HEROES, HERO_IDS, isHeroId, type HeroId } from '../../../shared/constants/heroes'
import { TALENT_TREES, getTalentTree } from '../../../shared/constants/talents'

/**
 * Guards the hero ability registry. The production build once tree-shook the
 * per-hero `registerHero(...)` side-effect imports out of the bundle, leaving an
 * empty registry so EVERY cast failed at runtime with "No resolver registered"
 * (abilities silently did nothing in any built server). registerAllHeroes() now
 * pins the chain; this test asserts every hero in HEROES resolves, so a hero
 * added to the data without being wired into the registry fails loudly here.
 *
 * SCOPE: this is a DATA-DRIFT guard (hero added to HEROES but not to
 * HERO_RESOLVERS), NOT a bundler guard — vitest runs unminified source and does
 * not tree-shake, so it cannot reproduce the original production bug. The real
 * build-path guard is the explicit named imports in heroes/index.ts +
 * registerAllHeroes() being called from the game-server plugin, exercised
 * end-to-end by the seeded Cairntrace e2e flows (e.g. game_talent_select,
 * smoke_full_session) against a production build. The in-process gameplay
 * harness (tests/gameplay/) covers the same ability resolution far faster but
 * does NOT reproduce the bundler/tree-shake path, so the prod-build e2e guard
 * stays.
 */
describe('hero ability registry', () => {
  it('registers an ability + passive resolver for every hero', () => {
    registerAllHeroes()
    for (const heroId of Object.keys(HEROES)) {
      const resolver = getHeroResolver(heroId)
      expect(resolver, `hero "${heroId}" has no registered resolver`).toBeDefined()
      expect(typeof resolver!.ability).toBe('function')
      expect(typeof resolver!.passive).toBe('function')
    }
  })
})

describe('HeroId literal union + helpers', () => {
  it('HERO_IDS lists every hero in the HEROES registry (no drift)', () => {
    const registryKeys = new Set(Object.keys(HEROES))
    const declaredIds = new Set<string>(HERO_IDS)
    expect([...registryKeys].sort(), 'hero in HEROES but missing from HERO_IDS').toEqual(
      [...declaredIds].sort(),
    )
  })

  it('isHeroId narrows registered IDs and rejects unknown strings', () => {
    expect(isHeroId('echo')).toBe(true)
    expect(isHeroId('cache')).toBe(true)
    expect(isHeroId('null_ref')).toBe(true)
    expect(isHeroId('unknown_hero')).toBe(false)
    expect(isHeroId('')).toBe(false)
    // A substring of a real id must NOT match (the old isInvisible-style bug class).
    expect(isHeroId('ech')).toBe(false)
    expect(isHeroId('echo_evil')).toBe(false)
  })

  it('isHeroId acts as a type guard (narrowed value indexes the registry)', () => {
    const raw: string = 'kernel'
    if (isHeroId(raw)) {
      // Inside this branch `raw` is narrowed to `HeroId`; indexing HEROES is safe.
      const def = HEROES[raw]
      expect(def?.id).toBe('kernel')
    } else {
      expect.unreachable('kernel should be a valid HeroId')
    }
  })

  it('getTalentTree returns the tree for a registered hero and undefined otherwise', () => {
    const tree = getTalentTree('echo')
    expect(tree).toBeDefined()
    expect(tree!.heroId).toBe('echo')
    expect(tree!.tiers[10]).toHaveLength(2)
    expect(tree!.tiers[25]).toHaveLength(2)

    expect(getTalentTree('not_a_hero')).toBeUndefined()
    expect(getTalentTree('')).toBeUndefined()
  })

  it('TALENT_TREES covers every HeroId (compile-time exhaustiveness is enforced by Record<HeroId, ...>)', () => {
    // Runtime mirror of the compile-time guarantee: every HeroId must have a tree.
    for (const id of HERO_IDS) {
      expect(TALENT_TREES[id as HeroId], `hero "${id}" has no TALENT_TREES entry`).toBeDefined()
      expect(TALENT_TREES[id as HeroId]!.heroId).toBe(id)
    }
  })
})
