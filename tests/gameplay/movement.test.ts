import { describe, it, expect } from 'vitest'
import { areAdjacent } from '~~/server/game/map/topology'
import { seedGame, HUMAN, ENEMY } from './harness'

/**
 * The one-zone-per-tick adjacency rule is the foundation of the whole map: a hero
 * may only step to a zone that borders its current one. These exercise that rule
 * through the full loop (not a bare validateAction) — the positive case lands the
 * move, the negative case is rejected with feedback and the hero stays put.
 */
describe('movement', () => {
  it('a hero can step to an adjacent zone in one tick', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'mid-river' } },
    }))

    // mid-river borders mid-t1-rad — a single legal step.
    expect(areAdjacent('mid-river', 'mid-t1-rad')).toBe(true)
    game.submit({ type: 'move', zone: 'mid-t1-rad' })
    await game.tick()

    expect((await game.me()).zone).toBe('mid-t1-rad')
  })

  it('a hero cannot teleport across the map — a non-adjacent move is rejected with feedback', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'mid-river' } },
    }))

    // dire-base is across the map — nowhere near mid-river.
    expect(areAdjacent('mid-river', 'dire-base')).toBe(false)
    game.submit({ type: 'move', zone: 'dire-base' })
    await game.tick()

    // The hero stays put, and the rejection reason reaches the player (not a
    // silent drop) — the same feedback channel a misclick would surface.
    expect((await game.me()).zone).toBe('mid-river')
    expect(
      game.lastRejected.some((r) => r.playerId === HUMAN && r.reason.includes('non-adjacent')),
    ).toBe(true)
  })

  it('only one action per player per tick — a second submission overwrites the first (latest wins)', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'mid-river' } },
    }))

    // mid-river borders BOTH mid-t1-rad and rune-top, so each step is legal on
    // its own. Queue them back-to-back in one tick: the queue holds a single
    // action per player, so the later submission replaces the earlier one — the
    // hero ends up at the LAST-submitted zone, not the first.
    expect(areAdjacent('mid-river', 'mid-t1-rad')).toBe(true)
    expect(areAdjacent('mid-river', 'rune-top')).toBe(true)
    game.submit({ type: 'move', zone: 'mid-t1-rad' })
    game.submit({ type: 'move', zone: 'rune-top' })
    await game.tick()

    const zoneAfter = (await game.me()).zone
    expect(zoneAfter).toBe('rune-top')
    expect(zoneAfter).not.toBe('mid-t1-rad')
  })

  it('a move toward an enemy-held zone is not blocked by the enemy presence (zones are not owned)', async () => {
    // Movement legality is purely topological — an enemy standing in the target
    // zone does not veto the step (contesting happens via combat, not movement).
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, zone: 'mid-river' },
        [ENEMY]: { ...s.players[ENEMY]!, zone: 'mid-t1-rad' },
      },
    }))

    game.submit({ type: 'move', zone: 'mid-t1-rad' })
    await game.tick()

    expect((await game.me()).zone).toBe('mid-t1-rad')
  })
})
