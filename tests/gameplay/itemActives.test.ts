import { describe, it, expect } from 'vitest'
import { seedGame, HUMAN, ENEMY } from './harness'

/**
 * Engine-truth coverage for item-active DAMAGE through the real processCycle.
 * Item nukes (Burnout, Cryo Routine) change INTEG inside useItem but historically
 * emitted no `damage` event, so an item kill credited no one — no kill count,
 * no bounty, no `kill` event, and the damage-taken passives never fired. This
 * locks in that item damage is now a first-class damage source (same path as
 * casts/attacks): it emits a `damage` event and feeds kill/bounty credit.
 */
describe('item-active combat credit', () => {
  it('a Burnout kill credits the user — kill count, a kill event, and a damage event', async () => {
    const game = await seedGame('laning', { heroSelf: 'echo', heroEnemy: 'daemon' })

    // Put both heroes in one zone, arm Burnout, and leave the enemy lethally low.
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          zone: 'coldstore-cross',
          items: ['burnout', null, null, null, null, null],
        },
        [ENEMY]: { ...s.players[ENEMY]!, zone: 'coldstore-cross', integ: 40, alive: true },
      },
    }))

    game.submit({ type: 'use', item: 'burnout', target: { kind: 'hero', name: 'daemon' } })
    await game.tick()

    const enemy = await game.player(ENEMY)
    const me = await game.me()

    expect(enemy.alive).toBe(false)
    // The fix: the item kill now credits the user (was 0 — killerId was null).
    expect(me.kills).toBe(1)
    expect(
      game.allEvents.some(
        (e) => e._tag === 'damage' && e.sourceId === HUMAN && e.targetId === ENEMY,
      ),
    ).toBe(true)
    expect(
      game.allEvents.some((e) => e._tag === 'kill' && e.killerId === HUMAN && e.victimId === ENEMY),
    ).toBe(true)
  })

  it('a Scythe hex announces the disable — an item active with no INTEG delta was silent', async () => {
    // Hex and Cyclone change nothing but the target's buff list, so the HP-diff
    // synthesis above never saw them: the most decisive 5000sc play in the game
    // produced not one line of feedback.
    const game = await seedGame('laning', { heroSelf: 'echo', heroEnemy: 'daemon' })

    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          zone: 'coldstore-cross',
          items: ['lockout_shunt', null, null, null, null, null],
        },
        [ENEMY]: {
          ...s.players[ENEMY]!,
          zone: 'coldstore-cross',
          alive: true,
          // R4-09: hard control requires BREACHED.
          buffs: [{ id: 'breached', stacks: 1, cyclesRemaining: 5, source: 'test' }],
        },
      },
    }))

    game.submit({ type: 'use', item: 'lockout_shunt', target: { kind: 'hero', name: 'daemon' } })
    await game.tick()

    const statuses = game.lastEvents.filter((e) => e._tag === 'status_applied')
    expect(statuses.map((e) => e.status).sort()).toEqual(['hex', 'silence'])
    expect(statuses[0]).toMatchObject({ sourceId: HUMAN, targetId: ENEMY })
  })
})
