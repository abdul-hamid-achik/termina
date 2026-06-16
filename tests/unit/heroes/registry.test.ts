import { describe, it, expect } from 'vitest'
import { registerAllHeroes, getHeroResolver } from '../../../server/game/heroes'
import { HEROES } from '../../../shared/constants/heroes'

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
