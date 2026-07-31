import { describe, it, expect } from 'vitest'
import { seedGame, HUMAN, ENEMY } from './harness'

/**
 * Engine-truth coverage for the surrender vote, driven through the real
 * processCycle — the one player-facing mechanic that previously had only
 * unit-level coverage (SurrenderSystem), never an end-to-end run. Surrender is
 * special-cased before validation in the tick pipeline: a vote tallies against
 * the team's ALIVE HUMAN electorate, and once the 60% threshold is met the game
 * ends for the OTHER team with a `surrendered` event.
 *
 * A two-human chaff team makes the threshold meaningful: ceil(2 × 0.6) = 2,
 * so one vote tallies and the second ends it. Tick is patched into the
 * surrender window (≥ SURRENDER_MIN_CYCLE = 225) rather than advanced 225× —
 * which also sidesteps the 60-tick AFK-takeover sweep.
 */
const roster = [
  { id: HUMAN, name: 'One', team: 'chaff' as const, heroId: 'echo' as const },
  { id: 'r2', name: 'Two', team: 'chaff' as const, heroId: 'sentry' as const },
  { id: ENEMY, name: 'Foe', team: 'audit' as const, heroId: 'daemon' as const },
]

describe('surrender', () => {
  it('rejects a surrender vote before the minimum tick', async () => {
    const run = await seedGame('laning', { players: roster })
    run.submit({ type: 'surrender', vote: 'yes' }, HUMAN)
    await run.tick()

    expect((await run.state()).phase).toBe('playing')
    expect(run.lastRejected.some((r) => r.playerId === HUMAN && /surrender/i.test(r.reason))).toBe(
      true,
    )
  })

  it('tallies one vote, then ends the game for the other team once the threshold is met', async () => {
    const run = await seedGame('laning', { players: roster })
    // Jump into the surrender window without running the 60-tick AFK sweeps.
    await run.patch((s) => ({ ...s, cycle: 224 }))

    // First vote: recorded, but 60% of a 2-human team needs 2 votes.
    run.submit({ type: 'surrender', vote: 'yes' }, HUMAN)
    await run.tick()
    expect((await run.state()).phase).toBe('playing')
    const vote = run.allEvents.find((e) => e._tag === 'surrender_vote')
    expect(vote).toBeTruthy()
    expect((vote as { votesNeeded: number }).votesNeeded).toBe(2)

    // Second vote: threshold met → game ends, the OTHER team wins.
    run.submit({ type: 'surrender', vote: 'yes' }, 'r2')
    await run.tick()
    const s = await run.state()
    expect(s.phase).toBe('ended')
    expect(s.winner).toBe('audit') // chaff surrendered
    expect(run.allEvents.some((e) => e._tag === 'surrendered' && e.team === 'chaff')).toBe(true)
  })

  it("an AFK-converted player's vote is not clobbered by the bot driver and still concedes", async () => {
    // The exact lockout the owner hit live: takeover fired, then SURRENDER was
    // dead. The WS gate now forwards the vote, and the bot driver must skip its
    // decision for a slot with a queued surrender (latest-wins queue would
    // otherwise overwrite the vote every cycle).
    const { convertToBot, cleanupGame } = await import('~~/server/game/ai/BotManager')
    const run = await seedGame('laning', { players: roster })
    await run.patch((s) => ({ ...s, cycle: 224 }))
    try {
      // Both chaff humans got converted (the electorate stays human-id based).
      convertToBot(run.gameId, HUMAN)
      convertToBot(run.gameId, 'r2')
      await run.patch((s) => ({
        ...s,
        players: {
          ...s.players,
          [HUMAN]: { ...s.players[HUMAN]!, aiControlled: true },
          r2: { ...s.players['r2']!, aiControlled: true },
        },
      }))

      run.submit({ type: 'surrender', vote: 'yes' }, HUMAN)
      await run.tick()
      expect(run.allEvents.some((e) => e._tag === 'surrender_vote')).toBe(true)

      run.submit({ type: 'surrender', vote: 'yes' }, 'r2')
      await run.tick()
      const s = await run.state()
      expect(s.phase).toBe('ended')
      expect(s.winner).toBe('audit')
    } finally {
      cleanupGame(run.gameId)
    }
  })

  it('lets a player retract their vote, keeping the team below threshold', async () => {
    const run = await seedGame('laning', { players: roster })
    await run.patch((s) => ({ ...s, cycle: 224 }))

    run.submit({ type: 'surrender', vote: 'yes' }, HUMAN)
    await run.tick()
    // Retract before the ally also votes.
    run.submit({ type: 'surrender', vote: 'no' }, HUMAN)
    await run.tick()

    // Ally votes — but with HUMAN's vote retracted that's only 1 of 2 needed.
    run.submit({ type: 'surrender', vote: 'yes' }, 'r2')
    await run.tick()
    expect((await run.state()).phase).toBe('playing')
  })
})
