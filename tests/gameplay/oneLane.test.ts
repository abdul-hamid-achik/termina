import { describe, it, expect } from 'vitest'
import { seedGame, HUMAN } from './harness'

/**
 * One-lane map (slice 1): a self-contained mid-lane subgraph of the full 5v5
 * graph, selected via `mapId: 'one_lane'` at the createGame seam. Proves the map
 * initializes the right zones + towers and that movement is correctly contained
 * to the lane — all through the in-process gameplay harness, no server/DB.
 */
describe('one-lane map', () => {
  it('initializes only the 11 mid-lane zones and 6 towers (3 per team)', async () => {
    const game = await seedGame('fresh', { mapId: 'one_lane' })
    const s = await game.state()

    expect(s.mapId).toBe('one_lane')
    expect(Object.keys(s.zones).length).toBe(11)
    expect(s.zones['top-t3-rad']).toBeUndefined() // dropped lanes don't exist
    expect(s.zones['roshan-pit']).toBeUndefined()

    expect(s.towers.length).toBe(6)
    expect(s.towers.every((t) => t.zone.startsWith('mid-'))).toBe(true)
  })

  it('spawns the human in its fountain and walks the lane one zone per tick', async () => {
    const game = await seedGame('fresh', { mapId: 'one_lane' })
    expect((await game.me()).zone).toBe('radiant-fountain')

    // fountain → base → down the mid lane to the river, one hop per tick.
    for (const zone of ['radiant-base', 'mid-t3-rad', 'mid-t2-rad', 'mid-t1-rad', 'mid-river']) {
      game.submit({ type: 'move', zone })
      await game.tick()
      expect((await game.me()).zone).toBe(zone)
    }
  })

  it('refuses a move to a zone that is not on this map (a dropped lane)', async () => {
    const game = await seedGame('fresh', { mapId: 'one_lane' })
    game.submit({ type: 'move', zone: 'radiant-base' })
    await game.tick()

    // radiant-base is globally adjacent to top-t3-rad, but that zone isn't on the
    // one-lane map — the move must be refused, not step into an uninitialized zone.
    game.submit({ type: 'move', zone: 'top-t3-rad' })
    await game.tick()

    expect((await game.me()).zone).toBe('radiant-base') // stayed put
    expect(
      game.lastRejected.some((r) => r.playerId === HUMAN && r.reason.includes('non-adjacent')),
    ).toBe(true)
  })

  it('spawns creep waves only on the mid lane (no top/bot leakage into dead zones)', async () => {
    const game = await seedGame('fresh', { mapId: 'one_lane' })
    await game.tick(8) // CREEP_WAVE_INTERVAL_TICKS — the first wave spawns
    const s = await game.state()

    expect(s.creeps.length).toBeGreaterThan(0)
    // Every creep is in a zone that exists on THIS map (never a dropped top/bot zone).
    expect(s.creeps.every((c) => s.zones[c.zone] !== undefined)).toBe(true)
    expect(s.creeps.some((c) => c.zone.startsWith('top-') || c.zone.startsWith('bot-'))).toBe(false)
  })

  it('has no jungle neutrals or river runes, and ticks cleanly past their interval', async () => {
    const game = await seedGame('fresh', { mapId: 'one_lane' })
    await game.tick(64) // past the 60-tick neutral + rune interval — they must no-op
    const s = await game.state()

    expect(s.neutrals.length).toBe(0)
    expect(s.runes.length).toBe(0)
    // And creeps stayed contained to the map the whole time.
    expect(s.creeps.every((c) => s.zones[c.zone] !== undefined)).toBe(true)
  })
})
