import { describe, it, expect, afterEach } from 'vitest'
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
import type { LoggedAction, SnapshotMeta } from '~~/server/game/engine/replayArtifact'
import type { GameState, TeamId } from '~~/shared/types/game'
import type { LiveGameRoster } from '~~/server/db/schema'
import { registerBots, cleanupGame } from '~~/server/game/ai/BotManager'
import { snapshotMetaFromRoster } from '~~/server/workflows/gameTickCore'

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

  it('processCycle records submitted actions onto state.actionLog', async () => {
    // Fresh gameId — playLive reuses `live_replay_src_${seed}` and the
    // in-process bot/AFK registries leak across calls on that id.
    resetWaveIdCounter()
    const gameId = `action_log_${Date.now()}`
    const sm = createInMemoryStateManager()
    const setup = META.players.map((p) => ({
      id: p.playerId,
      name: p.playerId,
      team: p.team,
      heroId: p.heroId,
    }))
    await Effect.runPromise(sm.createGame(gameId, setup, { mapId: META.mapId, mode: META.mode }))
    await Effect.runPromise(
      sm.updateState(gameId, (s) => ({ ...s, phase: 'playing' as const, rngSeed: SEED })),
    )
    let current = await Effect.runPromise(sm.getState(gameId))
    submitReplayAction(gameId, 'human', { type: 'move', zone: 'coldstore-t3-chaff' })
    const result = await Effect.runPromise(processCycle(gameId, current))
    expect(result.state.actionLog).toEqual([
      { cycle: 1, playerId: 'human', command: { type: 'move', zone: 'coldstore-t3-chaff' } },
    ])
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

  it('finalSummaryHash tells a game that ended with an AFK takeover from one that did not', async () => {
    // Who played the later cycles is outcome: a replay that missed a takeover
    // must not verify against the live game.
    const live = await playLive(SEED)
    const takenOver: GameState = {
      ...live,
      players: { ...live.players, human: { ...live.players.human!, aiControlled: true } },
    }
    expect(finalSummaryHash(takenOver)).not.toBe(finalSummaryHash(live))
  })
})

describe('replay reproduces AFK takeovers driven by Ably presence', () => {
  // processCycle reads presence from state.presenceOffline (stamped by the
  // Workflow tick before an AFK-check cycle). A replay must carry that sample or
  // a live "disconnected → bot takeover" silently never happens in the re-run.
  const meta: SnapshotMeta = {
    players: [
      { playerId: 'human_afk', team: 'chaff', heroId: 'echo', mmr: 1000 },
      { playerId: 'bot_far', team: 'audit', heroId: 'kernel', mmr: 1000 },
    ],
    mode: 'normal',
  }

  it('recorded offline samples (check + confirm) convert the idle human in the re-run too', async () => {
    const withPresence = await reconstructReplay(
      { ...meta, presenceOffline: { 60: ['human_afk'], 65: ['human_afk'] } },
      [],
      12345,
      66,
    )
    expect(withPresence.finalState.players['human_afk']?.aiControlled).toBe(true)

    // One sample is not enough (it could have been a page reload).
    const oneSample = await reconstructReplay(
      { ...meta, presenceOffline: { 60: ['human_afk'] } },
      [],
      12345,
      66,
    )
    expect(oneSample.finalState.players['human_afk']?.aiControlled).not.toBe(true)

    const withoutPresence = await reconstructReplay(meta, [], 12345, 66)
    expect(withoutPresence.finalState.players['human_afk']?.aiControlled).not.toBe(true)
  })
})

describe('replay of a LIVE game with an AFK takeover', () => {
  // The live game runs bot AI; the replay must not. A converted human sits in
  // the live bot registry, and convertToBot used to put them into the REPLAY's
  // registry too — so the re-run ran decideBotAction for them on top of their
  // logged orders ("Action overwritten in same tick") and silently diverged.
  const HEROES = [
    'echo',
    'daemon',
    'malloc',
    'cron',
    'mutex',
    'socket',
    'proxy',
    'regex',
    'kernel',
    'lambda',
  ]
  const IDS = [
    'h1',
    'h2',
    'bot_c2',
    'bot_c3',
    'bot_c4',
    'bot_a0',
    'bot_a1',
    'bot_a2',
    'bot_a3',
    'bot_a4',
  ]
  const roster: LiveGameRoster = {
    players: IDS.map((id, i) => ({
      playerId: id,
      team: (i < 5 ? 'chaff' : 'audit') as TeamId,
      heroId: HEROES[i]!,
      mmr: 1000,
    })),
  }
  const used: string[] = []
  afterEach(() => {
    for (const id of used.splice(0)) cleanupGame(id)
  })

  /** 2 humans + 8 registered bots; h2 keeps giving orders, h1 gives one on
   *  cycle 20 (with presence samples: 40 silent cycles at the cycle-60 check —
   *  past the disconnected threshold, short of the connected one) or none. */
  async function playLiveWithBots(
    gameId: string,
    cycles: number,
    presenceOffline?: Record<number, string[]>,
  ): Promise<GameState> {
    used.push(gameId)
    resetWaveIdCounter()
    const sm = createInMemoryStateManager()
    const setup = roster.players.map((p) => ({
      id: p.playerId,
      name: p.playerId,
      team: p.team,
      heroId: p.heroId,
    }))
    await Effect.runPromise(sm.createGame(gameId, setup))
    await Effect.runPromise(
      sm.updateState(gameId, (s) => ({
        ...s,
        phase: 'playing' as const,
        rngSeed: SEED,
        ...(presenceOffline ? { presenceOffline } : {}),
      })),
    )
    registerBots(
      gameId,
      roster.players
        .filter((p) => p.playerId.startsWith('bot_'))
        .map((p) => ({ playerId: p.playerId, team: p.team, heroId: p.heroId })),
    )
    let current = await Effect.runPromise(sm.getState(gameId))
    for (let c = 0; c < cycles; c++) {
      if (presenceOffline && c === 19) {
        submitReplayAction(gameId, 'h1', { type: 'move', zone: 'rookery-anchor' })
      }
      submitReplayAction(gameId, 'h2', {
        type: 'move',
        zone: c % 2 ? 'rookery-terminal' : 'rookery-anchor',
      })
      current = (await Effect.runPromise(processCycle(gameId, current))).state
    }
    return current
  }

  async function replayOf(live: GameState) {
    resetWaveIdCounter()
    const meta = snapshotMetaFromRoster(roster, live.mapId, 'normal', live.presenceOffline)
    return reconstructReplay(meta, live.actionLog ?? [], live.rngSeed, live.cycle)
  }

  it('DISCONNECTED (two offline samples): the re-run lands on the same hash', async () => {
    const atCheck = await playLiveWithBots('replay_afk_offline_60', 64, { 60: ['h1'], 65: ['h1'] })
    // Not by the connected rule at the primary check — by the confirm sample.
    expect(atCheck.players['h1']?.aiControlled ?? false).toBe(false)
    const live = await playLiveWithBots('replay_afk_offline', 90, { 60: ['h1'], 65: ['h1'] })
    expect(live.players['h1']?.aiControlled).toBe(true)
    expect(live.players['h2']?.aiControlled ?? false).toBe(false)

    const { finalState } = await replayOf(live)
    expect(finalState.players['h1']?.aiControlled).toBe(true)
    expect(finalState.players['h1']?.lastActionCycle).toBe(live.players['h1']?.lastActionCycle)
    expect(finalSummaryHash(finalState)).toBe(finalSummaryHash(live))
  })

  it('CONNECTED (the 60-cycle teammate rule): the re-run lands on the same hash', async () => {
    const live = await playLiveWithBots('replay_afk_connected', 90)
    expect(live.players['h1']?.aiControlled).toBe(true)

    const { finalState } = await replayOf(live)
    expect(finalState.players['h1']?.aiControlled).toBe(true)
    expect(finalSummaryHash(finalState)).toBe(finalSummaryHash(live))
  })

  it('the re-run emits the same takeover event on the same (confirm) cycle', async () => {
    // Stop ON the confirm cycle: state.events holds only the last cycle's events.
    const live = await playLiveWithBots('replay_afk_event', 65, { 60: ['h1'], 65: ['h1'] })
    const liveTakeovers = live.events.filter((e) => e.type === 'afk_takeover')
    expect(liveTakeovers).toHaveLength(1)
    const { finalState } = await replayOf(live)
    expect(finalState.events.filter((e) => e.type === 'afk_takeover')).toEqual(liveTakeovers)
  })
})
