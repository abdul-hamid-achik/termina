import { describe, it, expect } from 'vitest'
import { seedGame, HUMAN, ENEMY } from './harness'

/**
 * W3-2 — a standing attack order. Walking is free (one `move` order and the
 * engine keeps walking you), so fighting must not cost one manual input every
 * four seconds: a resolved NON-wave attack is remembered and re-issued each
 * tick until the target dies, leaves, or a new deliberate order lands.
 *
 * Last-hitting is the deliberate exception — `kind: 'wave'` never holds.
 */
describe('standing attack orders', () => {
  it('a ice breach keeps swinging with no further input', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    // Mid-match tick, not tick 0: wave escalation and the wave/cache spawners
    // are all live here, so the re-swing is exercised in a real tick, not in
    // the quiet first frame of a match.
    await game.patch((s) => ({
      ...s,
      cycle: 60,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone: 'mid-t1-audit' } },
    }))

    const iceHits = () =>
      game.lastEvents.filter(
        (e) => e._tag === 'damage' && e.sourceId === HUMAN && e.targetId === 'ice_mid-t1-audit',
      ).length

    game.submit({ type: 'attack', target: { kind: 'ice', zone: 'mid-t1-audit' } })
    await game.tick()
    expect(iceHits()).toBe(1)
    expect((await game.me()).attackTarget).toEqual({ kind: 'ice', zone: 'mid-t1-audit' })

    // Nothing submitted this cycle — the order carries itself.
    await game.tick()
    expect(iceHits()).toBe(1)
    expect((await game.me()).attackTarget).toEqual({ kind: 'ice', zone: 'mid-t1-audit' })
  })

  it('last-hitting stays manual — a wave attack sets no standing order', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      waves: [
        {
          id: 'creep_hold_1',
          team: 'audit' as const,
          zone: 'mid-river',
          integ: 500,
          maxInteg: 500,
          type: 'line' as const,
        },
      ],
    }))

    game.submit({ type: 'attack', target: { kind: 'wave', index: 0 } })
    await game.tick()

    const hit = game.lastEvents.some(
      (e) => e._tag === 'damage' && e.sourceId === HUMAN && e.targetId === 'creep_hold_1',
    )
    expect(hit).toBe(true)
    expect((await game.me()).attackTarget ?? null).toBeNull()
  })

  it('a new deliberate order replaces the standing attack', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })

    game.attackHero(ENEMY)
    await game.tick()
    expect((await game.me()).attackTarget).toEqual({ kind: 'hero', name: ENEMY })

    game.submit({ type: 'move', zone: 'mid-t1-chaff' })
    await game.tick()
    expect((await game.me()).attackTarget ?? null).toBeNull()
  })

  it('the order retires silently once the target leaves the zone', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })

    game.attackHero(ENEMY)
    await game.tick()
    expect((await game.me()).attackTarget).toEqual({ kind: 'hero', name: ENEMY })

    // The enemy walks out. The re-swing is an order the player typed a tick ago,
    // so its failure must not surface as a rejection they have to read.
    game.submit({ type: 'move', zone: 'mid-t1-audit' }, ENEMY)
    await game.tick()

    expect((await game.me()).attackTarget ?? null).toBeNull()
    expect(game.lastRejected.filter((r) => r.playerId === HUMAN)).toEqual([])
  })

  it('survives a disable, then retires — without being read as a cheat', async () => {
    // The nastiest path: a disable stops the continuation at validation (the
    // order deliberately outlives a stun, like the walk does), and the target
    // leaves meanwhile. The re-swing then names a hero who is provably NOT in
    // the zone — which is exactly the shape of the VISION_BYPASS anti-cheat
    // hunts for. Judged as a cheat it would be dropped before the attack phase,
    // so the order could never retire: a permanent per-cycle violation log.
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })

    game.attackHero(ENEMY)
    await game.tick()
    expect((await game.me()).attackTarget).toEqual({ kind: 'hero', name: ENEMY })

    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          buffs: [{ id: 'stun', stacks: 1, cyclesRemaining: 3, source: ENEMY }],
        },
        [ENEMY]: { ...s.players[ENEMY]!, zone: 'mid-t1-audit' },
      },
    }))

    // Stunned: the order waits, exactly as a walk waits out a root.
    await game.tick(3)
    expect((await game.me()).attackTarget).toEqual({ kind: 'hero', name: ENEMY })

    // Free again — the swing resolves against an empty zone and the order ends.
    await game.tick()
    expect((await game.me()).attackTarget ?? null).toBeNull()
    expect(game.lastRejected.filter((r) => r.playerId === HUMAN)).toEqual([])
  })

  it('death cancels the standing attack', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })

    game.attackHero(ENEMY)
    await game.tick()
    expect((await game.me()).attackTarget).toEqual({ kind: 'hero', name: ENEMY })

    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, integ: 0, alive: false, respawnCycle: null },
      },
    }))
    await game.tick()

    const me = await game.me()
    expect(me.alive).toBe(false)
    expect(me.attackTarget ?? null).toBeNull()
  })
})
