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
          zone: 'mid-river',
          items: ['observer_ward', null, null, null, null, null],
        },
      },
    }))

    game.submit({ type: 'ward', zone: 'mid-river' })
    await game.tick()

    // The ward is logged, the charge is spent, and a team ward now sits in the zone.
    expect(
      game.lastEvents.some(
        (e) => e._tag === 'ward_placed' && e.playerId === HUMAN && e.zone === 'mid-river',
      ),
    ).toBe(true)
    expect((await game.me()).items).not.toContain('observer_ward')
    const zoneWards = (await game.state()).zones['mid-river']?.wards ?? []
    expect(zoneWards.some((w) => w.team === me0.team && w.type === 'observer')).toBe(true)
  })

  it('a ward cannot be placed in a non-adjacent zone — rejected with feedback', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          zone: 'mid-river',
          items: ['observer_ward', null, null, null, null, null],
        },
      },
    }))

    // dire-base is across the map from mid-river — out of warding reach.
    game.submit({ type: 'ward', zone: 'dire-base' })
    await game.tick()

    // No ward placed, the charge is NOT spent, and the player is told why.
    expect((await game.state()).zones['dire-base']?.wards ?? []).toHaveLength(0)
    expect((await game.me()).items).toContain('observer_ward') // not consumed
    expect(
      game.lastRejected.some(
        (r) => r.playerId === HUMAN && r.reason.includes('current or adjacent'),
      ),
    ).toBe(true)
  })
})
