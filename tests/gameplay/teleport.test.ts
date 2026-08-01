import { describe, it, expect } from 'vitest'
import { seedGame, HUMAN, ENEMY } from './harness'

/**
 * Channeled teleport (town portal scroll) — the rotation backbone. Using a TP
 * scroll starts a multi-tick channel (tp_channeling) toward the hero's fountain;
 * it only moves the hero once the channel finishes, and any incoming damage
 * interrupts it. Both run through the real processCycle (buff-tick completion in
 * _base, damage cancel in the attack phase).
 */
describe('teleport (town portal scroll)', () => {
  it('a town portal scroll moves the hero home only after the channel completes', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    const me0 = await game.me()
    const fountain = me0.team === 'chaff' ? 'rookery-anchor' : 'landing-anchor'
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          zone: 'coldstore-cross',
          items: ['recall_token', null, null, null, null, null],
          buffs: [],
        },
        [ENEMY]: { ...s.players[ENEMY]!, zone: 'landing-terminal' }, // far off — can't interrupt
      },
      waves: [], // nothing to chip the channel and cancel it
    }))

    game.submit({ type: 'use', item: 'recall_token' })
    await game.tick()

    // The TP is not instant — mid-channel the hero is still at the origin.
    expect((await game.me()).zone).toBe('coldstore-cross')

    // Once the channel resolves, the hero is home at the fountain.
    await game.tick(4)
    expect((await game.me()).zone).toBe(fountain)
  })

  it('a completed teleport emits a teleport_complete event on the client-bound channel', async () => {
    // The completion must reach the SAME _tag event channel the client reads
    // (allEvents → onEvents), so the combat log can narrate "teleported to …".
    // cycleAllBuffs authors it as a wire-format event on state.events, which the
    // client never reads — processCycle bridges it into the _tag channel.
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    const me0 = await game.me()
    const fountain = me0.team === 'chaff' ? 'rookery-anchor' : 'landing-anchor'
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          zone: 'coldstore-cross',
          items: ['recall_token', null, null, null, null, null],
          buffs: [],
        },
        [ENEMY]: { ...s.players[ENEMY]!, zone: 'landing-terminal' },
      },
      waves: [],
    }))

    game.submit({ type: 'use', item: 'recall_token' })
    await game.tick(5)

    expect((await game.me()).zone).toBe(fountain) // teleport landed
    expect(game.allEvents.some((e) => e._tag === 'teleport_complete' && e.playerId === HUMAN)).toBe(
      true,
    )
  })

  it('a return-shadow teleport (Next Hop) is delivered tagged with its source', async () => {
    // The return-shadow variant (Traceroute Next Hop / Lambda Return) snaps the
    // hero back when the shadow buff expires. The bridge must preserve `source`
    // so the feed narrates "return shadow snapped them back", not a plain TP.
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          zone: 'coldstore-cross',
          // Shadow expires this cycle (cyclesRemaining 1) and its zone differs from
          // the current one, so cycleAllBuffs snaps the hero to it.
          buffs: [
            {
              id: 'nextHopShadow',
              stacks: 1,
              cyclesRemaining: 1,
              source: HUMAN,
              destination: 'coldstore-t1-chaff',
            },
          ],
        },
      },
    }))

    await game.tick()

    expect((await game.me()).zone).toBe('coldstore-t1-chaff') // snapped back
    expect(
      game.allEvents.some(
        (e) => e._tag === 'teleport_complete' && e.playerId === HUMAN && e.source === 'next_hop',
      ),
    ).toBe(true)
  })

  it('taking damage during the channel cancels the teleport — the hero stays put', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo', heroEnemy: 'daemon' })
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          zone: 'coldstore-cross',
          items: ['recall_token', null, null, null, null, null],
          buffs: [],
        },
        [ENEMY]: { ...s.players[ENEMY]!, zone: 'coldstore-cross' }, // co-located — can interrupt
      },
    }))

    game.submit({ type: 'use', item: 'recall_token' })
    await game.tick() // channel starts

    // The enemy hits the channeling hero — that breaks the teleport.
    game.attackHero(HUMAN, ENEMY)
    await game.tick(4)

    // Cancelled: the hero never left, and the channel buff is gone (not stuck).
    expect((await game.me()).zone).toBe('coldstore-cross')
    expect((await game.me()).buffs.some((b) => b.id === 'tp_channeling')).toBe(false)
  })
})
