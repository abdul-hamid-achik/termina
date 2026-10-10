import { describe, it, expect, afterAll } from 'vitest'
import { Effect } from 'effect'
import type { GameState, PlayerState } from '~~/shared/types/game'
import { resolveAbility, registerHero, applyBuff, updatePlayer } from '~~/server/game/heroes/_base'

/**
 * A fizzled hard control is reported through a per-cast trace. The trace used
 * to live in a module-level slot that a resolver's Effect filled lazily — so if
 * that Effect ever yielded, a second cast running meanwhile overwrote/cleared
 * the slot and the first cast lost (or stole) fizzles. The resolver now runs to
 * completion synchronously inside its own trace, whatever the caller does.
 *
 * A test-only hero whose ability yields between two fizzling stuns makes the
 * interleaving deterministic.
 */
const YIELDER = 'test_trace_yielder'

registerHero(
  YIELDER,
  (state, player) =>
    Effect.gen(function* () {
      let s = state
      for (const foeId of Object.keys(state.players)
        .filter((id) => id !== player.id)
        .sort()) {
        s = updatePlayer(
          s,
          applyBuff(s.players[foeId]!, {
            id: 'stun',
            stacks: 1,
            cyclesRemaining: 2,
            source: player.id,
          }),
        )
        yield* Effect.yieldNow()
      }
      return { state: s, events: [] }
    }),
  (s) => s,
)
afterAll(() => {
  // Leave no fake hero behind for other suites in this worker.
  registerHero(
    YIELDER,
    () => Effect.succeed({ state: {} as GameState, events: [] }),
    (s) => s,
  )
})

function p(id: string, team: 'chaff' | 'audit', heroId: string): PlayerState {
  return {
    id,
    name: id,
    team,
    heroId,
    zone: 'coldstore-cross',
    integ: 500,
    maxInteg: 500,
    bw: 500,
    maxBw: 500,
    level: 10,
    xp: 0,
    scrip: 0,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnCycle: null,
    plate: 0,
    ice: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    damageDealt: 0,
    iceDamageDealt: 0,
    killStreak: 0,
  } as PlayerState
}

function state(casterId: string, foes: string[]): GameState {
  const players: Record<string, PlayerState> = { [casterId]: p(casterId, 'chaff', YIELDER) }
  for (const f of foes) players[f] = p(f, 'audit', 'echo')
  return {
    cycle: 77,
    phase: 'playing',
    players,
    zones: {},
    waves: [],
    ice: [],
    events: [],
  } as unknown as GameState
}

const resistedIds = (r: { events: Array<{ type: string; payload: Record<string, unknown> }> }) =>
  r.events
    .filter((e) => e.type === 'control_resisted')
    .map((e) => String(e.payload['targetId']))
    .sort()

describe('control_resisted trace is per cast', () => {
  it('two casts resolved concurrently each report exactly their own fizzles', async () => {
    const a = resolveAbility(state('a', ['a_foe1', 'a_foe2']), 'a', 'q')
    const b = resolveAbility(state('b', ['b_foe1', 'b_foe2']), 'b', 'q')
    const [ra, rb] = await Effect.runPromise(Effect.all([a, b], { concurrency: 'unbounded' }))
    expect(resistedIds(ra)).toEqual(['a_foe1', 'a_foe2'])
    expect(resistedIds(rb)).toEqual(['b_foe1', 'b_foe2'])
  })
})
