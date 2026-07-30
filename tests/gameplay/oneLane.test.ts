import { describe, it, expect } from 'vitest'
import { seedGame, HUMAN } from './harness'

/**
 * One-lane map (slice 1): a self-contained mid-lane subgraph of the full 5v5
 * graph, selected via `mapId: 'one_lane'` at the createGame seam. Proves the map
 * initializes the right zones + ice and that movement is correctly contained
 * to the lane — all through the in-process gameplay harness, no server/DB.
 */
describe('one-lane map', () => {
  it('initializes only the 11 mid-lane zones and 6 ice (3 per team)', async () => {
    const game = await seedGame('fresh', { mapId: 'one_lane' })
    const s = await game.state()

    expect(s.mapId).toBe('one_lane')
    expect(Object.keys(s.zones).length).toBe(11)
    expect(s.zones['top-t3-chaff']).toBeUndefined() // dropped lanes don't exist
    expect(s.zones['hollow']).toBeUndefined()

    expect(s.ice.length).toBe(6)
    expect(s.ice.every((t) => t.zone.startsWith('mid-'))).toBe(true)
  })

  it('spawns the human in its fountain and walks the lane one zone per tick', async () => {
    const game = await seedGame('fresh', { mapId: 'one_lane' })
    expect((await game.me()).zone).toBe('chaff-fountain')

    // fountain → base → down the mid lane to the river, one hop per tick.
    for (const zone of [
      'chaff-base',
      'mid-t3-chaff',
      'mid-t2-chaff',
      'mid-t1-chaff',
      'mid-river',
    ]) {
      game.submit({ type: 'move', zone })
      await game.tick()
      expect((await game.me()).zone).toBe(zone)
    }
  })

  it('refuses a move to a zone that is not on this map (a dropped lane)', async () => {
    const game = await seedGame('fresh', { mapId: 'one_lane' })
    game.submit({ type: 'move', zone: 'chaff-base' })
    await game.tick()

    // chaff-base is globally adjacent to top-t3-chaff, but that zone isn't on the
    // one-lane map — no path exists inside this map's zone set, so the move must
    // be refused (auto-path included), not step into an uninitialized zone.
    game.submit({ type: 'move', zone: 'top-t3-chaff' })
    await game.tick()

    expect((await game.me()).zone).toBe('chaff-base') // stayed put
    expect(
      game.lastRejected.some((r) => r.playerId === HUMAN && r.reason.includes('No path')),
    ).toBe(true)
  })

  it('spawns wave waves only on the mid lane (no top/bot leakage into dead zones)', async () => {
    const game = await seedGame('fresh', { mapId: 'one_lane' })
    await game.tick(8) // WAVE_INTERVAL_TICKS — the first wave spawns
    const s = await game.state()

    expect(s.waves.length).toBeGreaterThan(0)
    // Every wave is in a zone that exists on THIS map (never a dropped top/bot zone).
    expect(s.waves.every((c) => s.zones[c.zone] !== undefined)).toBe(true)
    expect(s.waves.some((c) => c.zone.startsWith('top-') || c.zone.startsWith('bot-'))).toBe(false)
  })

  it('has no jungle neutrals or river caches, and ticks cleanly past their interval', async () => {
    const game = await seedGame('fresh', { mapId: 'one_lane' })
    await game.tick(64) // past the 60-tick neutral + cache interval — they must no-op
    const s = await game.state()

    expect(s.neutrals.length).toBe(0)
    expect(s.caches.length).toBe(0)
    // And waves stayed contained to the map the whole time.
    expect(s.waves.every((c) => s.zones[c.zone] !== undefined)).toBe(true)
  })
})
