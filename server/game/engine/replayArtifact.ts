import { createHash } from 'node:crypto'
import { Effect } from 'effect'
import type { GameMode, GameState, TeamId } from '~~/shared/types/game'
import type { Command } from '~~/shared/types/commands'
import type { NewMatchReplay } from '~~/server/db/schema'
import { createInMemoryStateManager } from '~~/server/game/engine/StateManager'
import { processCycle, submitReplayAction } from '~~/server/game/engine/GameLoop'

/**
 * The durable replay artifact.
 *
 * With deterministic resolution (GameState.rngSeed → per-tick RNG), a full
 * replay is reproducible from three small things: the roster metadata, the
 * persisted action log, and the seed. This module owns that artifact's shape,
 * the stable final-state hash that proves a reconstruction landed on the SAME
 * game, and the reconstruction itself (shared by the /api/replay endpoints
 * and the determinism tests).
 *
 * Archive-only (all-Vercel cutover): the Redis fast path (a live snapshot +
 * action log, 8h TTL) that used to back this on the DO deployment is gone
 * along with the DO-era WS game server — server/game/engine/StateSnapshot.ts
 * and ActionLog.ts (their Redis read/write halves) were deleted with it.
 * `SnapshotMeta`/`LoggedAction` below are what's left of their public shape:
 * still exactly what a match_replays row's `meta`/`actions` jsonb columns
 * hold, and what reconstructReplay needs to re-run a finished game. Nothing
 * currently WRITES a match_replays row on the Neon/Workflow path yet (see
 * server/workflows/gameTickCore.ts's finalizeGame TODO) — this module's
 * write side (buildReplayArtifact) is dormant until that lands; the read
 * side (reconstructReplay) still serves whatever archived replays exist.
 */

/**
 * Out-of-state metadata captured at game start so a replay can be
 * reconstructed from a fresh state manager (roster, map, mode). Kept minimal.
 */
export interface SnapshotMeta {
  players: { playerId: string; team: TeamId; heroId: string; mmr: number }[]
  mapId?: string
  mode?: GameMode
}

export interface LoggedAction {
  cycle: number
  playerId: string
  command: Command
  synthesized?: boolean
}

/** Integrity of a stored action log for replay honesty. */
export interface ActionLogIntegrity {
  /** True only when the retained log can reconstruct from cycle 1. */
  complete: boolean
  /** True when the log was trimmed (or is at capacity and its head is past
   *  cycle 1 — defensive signal). */
  truncated: boolean
  /** True when the log source failed to read; actions will be empty. */
  readFailed: boolean
  entryCount: number
  firstLoggedCycle: number | null
  lastLoggedCycle: number | null
  /** Frames always rebuild from a fresh createGame (cycle 0). */
  initialSnapshotCycle: 0
}

export interface ActionLogReadResult {
  actions: LoggedAction[]
  integrity: ActionLogIntegrity
}

/**
 * Bumped manually when engine behavior changes enough that replays recorded
 * before the change are EXPECTED to diverge. The hash makes divergence
 * detectable regardless — this is the honest label for "recorded under other
 * rules", not the mechanism.
 */
export const REPLAY_RULESET_VERSION = 1

/** Per-player scrubber summary — the projection the replay UI renders. */
export interface FramePlayer {
  id: string
  integ: number
  maxInteg: number
  bw: number
  maxBw: number
  level: number
  scrip: number
  kills: number
  deaths: number
  assists: number
  alive: boolean
  zone: string
  items: (string | null)[]
}

export interface Frame {
  cycle: number
  teams: {
    chaff: { kills: number; iceKills: number }
    audit: { kills: number; iceKills: number }
  }
  timeOfDay: 'day' | 'night'
  players: Record<string, FramePlayer>
}

/** The compact per-cycle summary the scrubber renders at any cycle T. */
export function summarizeFrame(state: GameState): Frame {
  const players: Record<string, FramePlayer> = {}
  // Defensive ?? {}: test fixtures routinely build partial states.
  for (const [id, p] of Object.entries(state.players ?? {})) {
    players[id] = {
      id,
      integ: p.integ,
      maxInteg: p.maxInteg,
      bw: p.bw,
      maxBw: p.maxBw,
      level: p.level,
      scrip: p.scrip,
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      alive: p.alive,
      zone: p.zone,
      items: p.items,
    }
  }
  return {
    cycle: state.cycle,
    teams: {
      chaff: { kills: state.teams?.chaff.kills ?? 0, iceKills: state.teams?.chaff.iceKills ?? 0 },
      audit: { kills: state.teams?.audit.kills ?? 0, iceKills: state.teams?.audit.iceKills ?? 0 },
    },
    timeOfDay: state.timeOfDay,
    players,
  }
}

/**
 * A stable hash of the game's outcome-relevant final state: players, teams,
 * waves, camps, ice, terminals, cycle and winner. Everything is sorted by
 * structural keys and unit IDS ARE EXCLUDED — wave ids come from a
 * process-wide counter and neutral ids embed a per-game suffix, so two
 * faithful reproductions of the same game legitimately differ in ids while
 * agreeing on everything that matters.
 */
export function finalSummaryHash(state: GameState): string {
  const frame = summarizeFrame(state)
  const stable = {
    cycle: frame.cycle,
    winner: state.winner ?? null,
    teams: frame.teams,
    players: Object.keys(frame.players)
      .sort()
      .map((id) => frame.players[id]),
    waves: (state.waves ?? [])
      .map((w) => [w.zone, w.team, w.type, w.integ, w.maxInteg ?? null] as const)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    neutrals: (state.neutrals ?? [])
      .map((n) => [n.zone, n.type, n.integ, n.maxInteg, n.alive] as const)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    ice: (state.ice ?? [])
      .map((t) => [t.zone, t.team, t.integ, t.alive, t.invulnerable] as const)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    terminals: {
      chaff: [state.terminals?.chaff.integ ?? null, state.terminals?.chaff.alive ?? null],
      audit: [state.terminals?.audit.integ ?? null, state.terminals?.audit.alive ?? null],
    },
  }
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex')
}

/** Sets aren't JSON-serializable — convert for jsonb/wire transport. */
export function serializeStateForTransport(state: GameState): Record<string, unknown> {
  return {
    ...state,
    surrenderVotes: {
      chaff: [...state.surrenderVotes.chaff],
      audit: [...state.surrenderVotes.audit],
    },
  }
}

/** Build the archive row for a finished game. */
export function buildReplayArtifact(
  gameId: string,
  finalState: GameState,
  meta: SnapshotMeta,
  actions: LoggedAction[],
): NewMatchReplay {
  return {
    matchId: gameId,
    rulesetVersion: REPLAY_RULESET_VERSION,
    rngSeed: finalState.rngSeed ?? null,
    meta,
    actions,
    finalState: serializeStateForTransport(finalState),
    finalSummaryHash: finalSummaryHash(finalState),
  }
}

export interface ReplayReconstruction {
  frames: Frame[]
  finalState: GameState
}

/** Monotonic disambiguator for reconstruction ids within one process. */
let replaySeq = 0

/**
 * Re-run a finished game from cycle 0: fresh state from the roster metadata,
 * the ORIGINAL rngSeed stitched in (createGame stamps a fresh seed, which
 * would make every crit/proc/spawn diverge), then the persisted actions fed
 * through processCycle tick by tick. Bot AI is NOT re-injected — the bots'
 * submitted actions are already in the log, so the log is the sole input.
 */
export async function reconstructReplay(
  meta: SnapshotMeta,
  actions: LoggedAction[],
  rngSeed: number | null | undefined,
  lastCycle: number,
): Promise<ReplayReconstruction> {
  // Distinct AND unique gameId: several engine modules keep per-gameId state
  // (action queues, assist tracking, farm tallies) — two reconstructions that
  // shared an id would leak that state into each other, which is exactly the
  // nondeterminism this artifact exists to rule out.
  const replayId = `replay_${Date.now()}_${++replaySeq}`
  const sm = createInMemoryStateManager()
  const setup = meta.players.map((p) => ({
    id: p.playerId,
    name: p.playerId,
    team: p.team,
    heroId: p.heroId,
  }))
  await Effect.runPromise(sm.createGame(replayId, setup, { mapId: meta.mapId, mode: meta.mode }))
  await Effect.runPromise(
    sm.updateState(replayId, (s) => ({
      ...s,
      phase: 'playing' as const,
      // The determinism stitch: without the original seed the re-run rolls a
      // different resolution stream and the replay silently lies.
      ...(rngSeed != null ? { rngSeed } : {}),
    })),
  )

  const actionsByTick = new Map<number, LoggedAction[]>()
  for (const a of actions) {
    const bucket = actionsByTick.get(a.cycle) ?? []
    bucket.push(a)
    actionsByTick.set(a.cycle, bucket)
  }

  const frames: Frame[] = []
  const initial = await Effect.runPromise(sm.getState(replayId))
  frames.push(summarizeFrame(initial))

  let current = initial
  for (let t = 1; t <= lastCycle; t++) {
    for (const a of actionsByTick.get(t) ?? []) {
      submitReplayAction(replayId, a.playerId, a.command, a.synthesized)
    }
    const result = await Effect.runPromise(processCycle(replayId, current))
    current = result.state
    await Effect.runPromise(sm.updateState(replayId, () => current))
    frames.push(summarizeFrame(current))
    // Stop once processCycle declared the game over — no grinding past the win.
    if (current.phase === 'ended') break
  }

  return { frames, finalState: current }
}
