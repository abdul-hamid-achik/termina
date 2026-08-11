import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import { createInMemoryStateManager } from '~~/server/game/engine/StateManager'
import { processCycle, submitReplayAction } from '~~/server/game/engine/GameLoop'
import { resetWaveIdCounter } from '~~/server/game/map/spawner'
import {
  buildReplayArtifact,
  reconstructReplay,
  finalSummaryHash,
  REPLAY_RULESET_VERSION,
} from '~~/server/game/engine/replayArtifact'
import type { LoggedAction } from '~~/server/game/engine/ActionLog'
import type { SnapshotMeta } from '~~/server/game/engine/StateSnapshot'
import type { GameState } from '~~/shared/types/game'

/**
 * The durable-replay contract: a finished game is fully reproducible from
 * (roster meta, action log, rngSeed) — the exact triple the match_replays
 * archive stores. This test IS that guarantee: it plays a "live" game through
 * the same primitives production uses, records the action stream, then hands
 * only the artifact triple to reconstructReplay and demands the SAME final
 * summary hash the live game produced. If any engine path regains
 * non-determinism (a bare Math.random, an arrival-order dependence), this is
 * the test that starts failing.
 */

const META: SnapshotMeta = {
  players: [
    // echo: its double-cast passive rolls the rng stream on every cast, and a
    // proc doubles the damage — real random RESOLUTION inside a short window.
    // (Crit chance lives on items, which this roster doesn't carry.)
    { playerId: 'human', team: 'chaff', heroId: 'echo', mmr: 1000 },
    { playerId: 'rival', team: 'audit', heroId: 'daemon', mmr: 1000 },
  ],
  // The FULL map, deliberately: one_lane has no Silt zones, and without camp
  // spawn rolls an item-less, talent-less game consumes no randomness at all —
  // the wrong-seed test would have nothing to diverge on.
  mapId: undefined,
  mode: 'normal',
}

const SEED = 424242
// Past cycle 60 so the Silt camp spawn rolls (size + type per camp) have
// fired — the first guaranteed random RESOLUTION in an item-less, talent-less
// game, and what the wrong-seed test diverges on.
const CYCLES = 65

/** A scripted action stream with real resolution in it (moves + swings). */
const SCRIPT: LoggedAction[] = [
  { cycle: 1, playerId: 'human', command: { type: 'move', zone: 'coldstore-t1-chaff' } },
  { cycle: 1, playerId: 'rival', command: { type: 'move', zone: 'coldstore-t1-audit' } },
  { cycle: 4, playerId: 'human', command: { type: 'move', zone: 'coldstore-cross' } },
  { cycle: 5, playerId: 'rival', command: { type: 'move', zone: 'coldstore-cross' } },
  {
    cycle: 6,
    playerId: 'human',
    command: { type: 'cast', ability: 'q', target: { kind: 'hero', name: 'daemon' } },
  },
  {
    cycle: 7,
    playerId: 'human',
    command: { type: 'attack', target: { kind: 'hero', name: 'daemon' } },
  },
  {
    cycle: 8,
    playerId: 'rival',
    command: { type: 'attack', target: { kind: 'hero', name: 'echo' } },
  },
  {
    cycle: 9,
    playerId: 'human',
    command: { type: 'cast', ability: 'q', target: { kind: 'hero', name: 'daemon' } },
  },
  {
    cycle: 11,
    playerId: 'human',
    command: { type: 'cast', ability: 'q', target: { kind: 'hero', name: 'daemon' } },
  },
]

/** Drive a "live" game exactly the way reconstructReplay does its re-run. */
async function playLive(seed: number): Promise<GameState> {
  resetWaveIdCounter()
  const gameId = `live_replay_src_${seed}`
  const sm = createInMemoryStateManager()
  const setup = META.players.map((p) => ({
    id: p.playerId,
    name: p.playerId,
    team: p.team,
    heroId: p.heroId,
  }))
  await Effect.runPromise(sm.createGame(gameId, setup, { mapId: META.mapId, mode: META.mode }))
  await Effect.runPromise(
    sm.updateState(gameId, (s) => ({ ...s, phase: 'playing' as const, rngSeed: seed })),
  )
  let current = await Effect.runPromise(sm.getState(gameId))
  for (let t = 1; t <= CYCLES; t++) {
    for (const a of SCRIPT.filter((x) => x.cycle === t)) {
      submitReplayAction(gameId, a.playerId, a.command, a.synthesized)
    }
    const result = await Effect.runPromise(processCycle(gameId, current))
    current = result.state
    await Effect.runPromise(sm.updateState(gameId, () => current))
  }
  return current
}

describe('the durable replay artifact', () => {
  it('reconstructs the SAME game from (meta, actions, seed) — hash-verified', async () => {
    const live = await playLive(SEED)
    const liveHash = finalSummaryHash(live)

    resetWaveIdCounter()
    const { finalState } = await reconstructReplay(META, SCRIPT, SEED, CYCLES)
    expect(finalSummaryHash(finalState)).toBe(liveHash)
  })

  it('a wrong seed is DETECTED, not papered over (verified=false semantics)', async () => {
    // Reconstructing under a different seed rolls a different resolution
    // stream — the run is plausible but not the recorded game. The hash
    // comparison is what lets the frames endpoint say so instead of serving
    // it as history. Fixed alternate seeds keep this fully deterministic:
    // null_ref's crit rolls make at least one of them land differently.
    const live = await playLive(SEED)
    const liveHash = finalSummaryHash(live)

    let diverged = false
    for (const alt of [1, 2, 3, 4, 5, 6, 7, 8]) {
      resetWaveIdCounter()
      const { finalState } = await reconstructReplay(META, SCRIPT, SEED + alt, CYCLES)
      if (finalSummaryHash(finalState) !== liveHash) {
        diverged = true
        break
      }
    }
    expect(diverged, 'no alternate seed diverged — randomness never reached resolution').toBe(true)
  })

  it('buildReplayArtifact captures the full reproduction triple', async () => {
    const live = await playLive(SEED)
    const artifact = buildReplayArtifact('game_x', live, META, SCRIPT)
    expect(artifact.matchId).toBe('game_x')
    expect(artifact.rulesetVersion).toBe(REPLAY_RULESET_VERSION)
    expect(artifact.rngSeed).toBe(SEED)
    expect(artifact.meta).toEqual(META)
    expect(artifact.actions).toEqual(SCRIPT)
    expect(artifact.finalSummaryHash).toBe(finalSummaryHash(live))
    // Sets must already be transport-safe in the stored final state.
    const stored = artifact.finalState as { surrenderVotes: { chaff: unknown } }
    expect(Array.isArray(stored.surrenderVotes.chaff)).toBe(true)
  })

  it('finalSummaryHash is insertion-order independent for players', async () => {
    const live = await playLive(SEED)
    const reordered: GameState = {
      ...live,
      players: Object.fromEntries(Object.entries(live.players).reverse()),
    }
    expect(finalSummaryHash(reordered)).toBe(finalSummaryHash(live))
  })
})
