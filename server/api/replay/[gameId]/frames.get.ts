import { Effect } from 'effect'
import { getGameRuntime } from '~~/server/plugins/game-server'
import { readSnapshot } from '~~/server/game/engine/StateSnapshot'
import { readActions } from '~~/server/game/engine/ActionLog'
import { createInMemoryStateManager } from '~~/server/game/engine/StateManager'
import { processCycle, submitAction } from '~~/server/game/engine/GameLoop'
import type { GameState } from '~~/shared/types/game'

/**
 * Step-through replay frames — a compact per-cycle player/team summary that
 * the scrubber can render at any cycle T.
 *
 * The frames are produced by re-running every persisted action through
 * processCycle from a freshly-initialised state. Bot AI is NOT re-injected
 * because the bot's submitted actions are already in the action log — see
 * the "no registerBots" comment below.
 *
 * Caveats (deliberate trade-offs for V1):
 * - World-side AI (wave waves, neutrals, tenant, caches) uses Math.random
 *   and will diverge from the original game. Player-side evolution (INTEG,
 *   scrip, items, K/D/A, position) follows the recorded action stream and
 *   is the only thing the scrubber UI relies on today.
 * - The replay is bounded by the action log's cycle range, so a game with
 *   no logged actions returns an empty `frames` array.
 */

interface FramePlayer {
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

interface Frame {
  cycle: number
  teams: {
    chaff: { kills: number; iceKills: number }
    audit: { kills: number; iceKills: number }
  }
  timeOfDay: 'day' | 'night'
  players: Record<string, FramePlayer>
}

function summarize(state: GameState): Frame {
  const players: Record<string, FramePlayer> = {}
  for (const [id, p] of Object.entries(state.players)) {
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
      chaff: {
        kills: state.teams.chaff.kills,
        iceKills: state.teams.chaff.iceKills,
      },
      audit: {
        kills: state.teams.audit.kills,
        iceKills: state.teams.audit.iceKills,
      },
    },
    timeOfDay: state.timeOfDay,
    players,
  }
}

export default defineEventHandler(async (event) => {
  const runtime = getGameRuntime()
  if (!runtime) {
    throw createError({ statusCode: 503, message: 'Game server not ready' })
  }

  const gameId = getRouterParam(event, 'gameId')
  if (!gameId) {
    throw createError({ statusCode: 400, message: 'Game ID required' })
  }

  const snap = await Effect.runPromise(readSnapshot(runtime.redisService, gameId))
  if (!snap) {
    throw createError({ statusCode: 404, message: 'Replay not found' })
  }
  if (!snap.meta) {
    throw createError({ statusCode: 422, message: 'Replay missing setup metadata' })
  }

  const actions = await Effect.runPromise(readActions(runtime.redisService, gameId))
  // The last persisted cycle caps the replay length. Snapshots may run a few
  // ticks ahead of the action log if the log was trimmed, so use whichever
  // is bigger as an upper bound.
  const lastActionCycle = actions.reduce((max, a) => (a.cycle > max ? a.cycle : max), 0)
  const lastCycle = Math.max(lastActionCycle, snap.state.cycle)

  // Distinct gameId for the replay so re-running doesn't poke any live
  // game's queue. Importantly we do NOT call registerBots, so processCycle's
  // bot-AI step short-circuits and the action log is the sole input source.
  const replayId = `replay_${gameId}_${Date.now()}`
  const sm = createInMemoryStateManager()
  const setup = snap.meta.players.map((p) => ({
    id: p.playerId,
    name: p.playerId,
    team: p.team,
    heroId: p.heroId,
  }))
  await Effect.runPromise(sm.createGame(replayId, setup))
  await Effect.runPromise(sm.updateState(replayId, (s) => ({ ...s, phase: 'playing' as const })))

  // Bucket actions by their cycle for O(1) lookup as we step forward.
  const actionsByTick = new Map<number, typeof actions>()
  for (const a of actions) {
    const bucket = actionsByTick.get(a.cycle) ?? []
    bucket.push(a)
    actionsByTick.set(a.cycle, bucket)
  }

  const frames: Frame[] = []
  // Frame 0 = initial state.
  const initial = await Effect.runPromise(sm.getState(replayId))
  frames.push(summarize(initial))

  let current = initial
  for (let t = 1; t <= lastCycle; t++) {
    const tickActions = actionsByTick.get(t) ?? []
    for (const a of tickActions) {
      submitAction(replayId, a.playerId, a.command)
    }
    const result = await Effect.runPromise(processCycle(replayId, current))
    current = result.state
    await Effect.runPromise(sm.updateState(replayId, () => current))
    frames.push(summarize(current))
    // Bail out early if processCycle declared the game over so we don't
    // grind through ticks past the win.
    if (current.phase === 'ended') break
  }

  return {
    gameId,
    totalTicks: frames.length - 1,
    frames,
    meta: snap.meta,
  }
})
