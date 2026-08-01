import { describe, it, expect } from 'vitest'
import { areAdjacent } from '~~/server/game/map/topology'
import { seedGame, HUMAN, ENEMY } from './harness'

/**
 * Movement is one zone per cycle, but an order may name ANY reachable zone —
 * the hero auto-paths toward it, one hop per cycle, until arrival or a new
 * deliberate action. These exercise the rule through the full loop (not a bare
 * validateAction): single steps land next cycle, distant orders walk the BFS
 * path, and a new intent cancels the walk.
 */
describe('movement', () => {
  it('a hero can step to an adjacent zone in one cycle', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'coldstore-cross' } },
    }))

    // coldstore-cross borders coldstore-t1-chaff — a single legal step.
    expect(areAdjacent('coldstore-cross', 'coldstore-t1-chaff')).toBe(true)
    game.submit({ type: 'move', zone: 'coldstore-t1-chaff' })
    await game.tick()

    expect((await game.me()).zone).toBe('coldstore-t1-chaff')
  })

  it('a distant order auto-paths: one hop per cycle, never a teleport, arriving over N ticks', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'coldstore-cross' } },
    }))

    // landing-terminal is across the map — 4 hops down mid lane.
    expect(areAdjacent('coldstore-cross', 'landing-terminal')).toBe(false)
    game.submit({ type: 'move', zone: 'landing-terminal' })
    await game.tick()

    // First hop only, with the destination remembered.
    const afterOne = await game.me()
    expect(afterOne.zone).toBe('coldstore-t1-audit')
    expect(afterOne.moveTarget).toBe('landing-terminal')

    // No further orders — the hero keeps walking and arrives, target cleared.
    await game.tick(3)
    const arrived = await game.me()
    expect(arrived.zone).toBe('landing-terminal')
    expect(arrived.moveTarget ?? null).toBeNull()
  })

  it('a new deliberate action cancels the auto-path walk', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, zone: 'coldstore-cross' },
        [ENEMY]: { ...s.players[ENEMY]!, zone: 'coldstore-t1-audit' },
      },
    }))

    game.submit({ type: 'move', zone: 'landing-terminal' })
    await game.tick()
    expect((await game.me()).moveTarget).toBe('landing-terminal')

    // The hero walked into the enemy's zone; attacking is a new intent — the
    // remaining walk is dropped and the hero holds position.
    game.attackHero('Daemon')
    await game.tick()
    const afterAttack = await game.me()
    expect(afterAttack.moveTarget ?? null).toBeNull()
    await game.tick(2)
    expect((await game.me()).zone).toBe('coldstore-t1-audit')
  })

  it('a new move order redirects the walk (latest destination wins)', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'coldstore-t3-chaff' } },
    }))

    game.submit({ type: 'move', zone: 'coldstore-cross' })
    await game.tick()
    expect((await game.me()).moveTarget).toBe('coldstore-cross')

    // Change of plans mid-walk: head home instead (3 hops from coldstore-t2-chaff).
    game.submit({ type: 'move', zone: 'rookery-anchor' })
    await game.tick(3)
    const me = await game.me()
    expect(me.zone).toBe('rookery-anchor')
    expect(me.moveTarget ?? null).toBeNull()
  })

  it('only one action per player per cycle — a second submission overwrites the first (latest wins)', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'coldstore-cross' } },
    }))

    // coldstore-cross borders BOTH coldstore-t1-chaff and cache-seawall, so each step is legal on
    // its own. Queue them back-to-back in one cycle: the queue holds a single
    // action per player, so the later submission replaces the earlier one — the
    // hero ends up at the LAST-submitted zone, not the first.
    expect(areAdjacent('coldstore-cross', 'coldstore-t1-chaff')).toBe(true)
    expect(areAdjacent('coldstore-cross', 'cache-seawall')).toBe(true)
    game.submit({ type: 'move', zone: 'coldstore-t1-chaff' })
    game.submit({ type: 'move', zone: 'cache-seawall' })
    await game.tick()

    const zoneAfter = (await game.me()).zone
    expect(zoneAfter).toBe('cache-seawall')
    expect(zoneAfter).not.toBe('coldstore-t1-chaff')
  })

  it('a move toward an enemy-held zone is not blocked by the enemy presence (zones are not owned)', async () => {
    // Movement legality is purely topological — an enemy standing in the target
    // zone does not veto the step (contesting happens via combat, not movement).
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, zone: 'coldstore-cross' },
        [ENEMY]: { ...s.players[ENEMY]!, zone: 'coldstore-t1-chaff' },
      },
    }))

    game.submit({ type: 'move', zone: 'coldstore-t1-chaff' })
    await game.tick()

    expect((await game.me()).zone).toBe('coldstore-t1-chaff')
  })
})
