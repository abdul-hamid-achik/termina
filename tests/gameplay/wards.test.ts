import { describe, it, expect } from 'vitest'
import { seedGame, HUMAN } from './harness'

/**
 * Ward placement — the action half of vision control (the vision a ward then
 * grants is unit-tested in VisionCalculator). Placing a ward consumes the ward
 * item, drops a team ward into the zone's runtime state, and emits ward_placed;
 * it must be the current or an adjacent zone (you can't ward what you can't reach).
 */
describe('wards', () => {
  it('placing an observer ward consumes the item and drops a team ward in the zone', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    const me0 = await game.me()
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          zone: 'coldstore-cross',
          items: ['camtap', null, null, null, null, null],
        },
      },
    }))

    game.submit({ type: 'ward', zone: 'coldstore-cross' })
    await game.tick()

    // The ward is logged, the charge is spent, and a team ward now sits in the zone.
    expect(
      game.lastEvents.some(
        (e) => e._tag === 'ward_placed' && e.playerId === HUMAN && e.zone === 'coldstore-cross',
      ),
    ).toBe(true)
    expect((await game.me()).items).not.toContain('camtap')
    const zoneWards = (await game.state()).zones['coldstore-cross']?.wards ?? []
    expect(zoneWards.some((w) => w.team === me0.team && w.type === 'camtap')).toBe(true)
  })

  it('a ward cannot be placed in a non-adjacent zone — rejected with feedback', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          zone: 'coldstore-cross',
          items: ['camtap', null, null, null, null, null],
        },
      },
    }))

    // landing-terminal is across the map from coldstore-cross — out of warding reach.
    game.submit({ type: 'ward', zone: 'landing-terminal' })
    await game.tick()

    // No ward placed, the charge is NOT spent, and the player is told why.
    expect((await game.state()).zones['landing-terminal']?.wards ?? []).toHaveLength(0)
    expect((await game.me()).items).toContain('camtap') // not consumed
    expect(
      game.lastRejected.some(
        (r) => r.playerId === HUMAN && r.reason.includes('current or adjacent'),
      ),
    ).toBe(true)
  })
})
