/**
 * Leaver Penalty System
 * Detects AFK players and applies penalties
 * Tracks leaver history and assigns low-priority queue
 */

import { Effect, Layer } from 'effect'
import type { GameState } from '~~/shared/types/game'
import { RedisService, type RedisServiceApi } from './RedisService'
import { engineLog } from '~~/server/utils/log'
import { isBot } from '~~/server/game/ai/BotManager'
import { CYCLE_DURATION_MS } from '~~/shared/constants/balance'

const _mockRedisService = Layer.succeed(RedisService, {
  get: () => Effect.succeed(null),
  set: () => Effect.succeed(void 0),
  del: () => Effect.succeed(void 0),
  lpush: () => Effect.succeed(void 0),
  rpush: () => Effect.succeed(void 0),
  rpop: () => Effect.succeed(null),
  llen: () => Effect.succeed(0),
  lrange: () => Effect.succeed([]),
  ltrim: () => Effect.succeed(void 0),
  publish: () => Effect.succeed(void 0),
  subscribe: () => Effect.succeed(void 0),
  unsubscribe: () => Effect.succeed(void 0),
  zadd: () => Effect.succeed(void 0),
  zrangebyscore: () => Effect.succeed([]),
  zrem: () => Effect.succeed(void 0),
  zcard: () => Effect.succeed(0),
  hset: () => Effect.succeed(void 0),
  hget: () => Effect.succeed(null),
  hdel: () => Effect.succeed(void 0),
  hgetall: () => Effect.succeed({}),
  setnx: () => Effect.succeed(0),
  getdel: () => Effect.succeed(null),
  keys: () => Effect.succeed([]),
  scan: () => Effect.succeed([]),
  expire: () => Effect.succeed(void 0),
  eval: () => Effect.succeed(null),
  shutdown: () => Effect.succeed(void 0),
})

export interface LeaverRecord {
  playerId: string
  gameId: string
  cycle: number
  timestamp: number
  reason: 'afk' | 'disconnect' | 'feed' | 'grief'
  duration: number // ticks AFK
}

export interface PlayerPenalty {
  playerId: string
  leaverScore: number // 0-100, higher = worse
  totalLeaves: number
  recentLeaves: number // Last 10 games
  lowPriority: boolean
  lowPriorityGamesRemaining: number
  lastLeaveTimestamp: number | null
}

const AFK_THRESHOLD_TICKS = 30 // 2 minutes at 4s/cycle
// A CONNECTED player gets double the window before takeover — "no game action
// for 2 minutes" is normal for someone reading the shop or watching a fight.
const CONNECTED_AFK_THRESHOLD_TICKS = AFK_THRESHOLD_TICKS * 2
const LEAVER_SCORE_DECAY = 1 // Points decay per day
const LOW_PRIORITY_THRESHOLD = 30 // Score above this = low priority
const LOW_PRIORITY_GAMES = 3 // Games required to clear low priority

// ── Client presence ledger (in-memory) ─────────────────────────
// Wall-clock timestamp of the last DELIBERATE client input per game+player
// (an action, a chat message, a map ping — NOT the automatic heartbeat),
// stamped by the WS route. Lets the AFK takeover distinguish "present but
// between actions" from "gone": someone still touching the game is presence,
// even when their last drained game action is minutes old.
const clientInputAt = new Map<string, number>()
const inputKey = (gameId: string, playerId: string) => `${gameId}:${playerId}`

/** Record a deliberate client input (call from the WS route on action/chat/ping). */
export function markClientInput(gameId: string, playerId: string): void {
  clientInputAt.set(inputKey(gameId, playerId), Date.now())
}

/** ms since the player's last deliberate input this game, or null if none yet. */
export function msSinceClientInput(gameId: string, playerId: string): number | null {
  const at = clientInputAt.get(inputKey(gameId, playerId))
  return at == null ? null : Date.now() - at
}

/** Drop a finished game's presence entries (call alongside BotManager.cleanupGame). */
export function clearClientInput(gameId: string): void {
  const prefix = `${gameId}:`
  for (const key of clientInputAt.keys()) {
    if (key.startsWith(prefix)) clientInputAt.delete(key)
  }
}

/**
 * Check for AFK players in the game
 * Called every cycle to track player activity
 */
export function detectAFKPlayers(state: GameState): Array<{ playerId: string; ticksAFK: number }> {
  const afkPlayers: Array<{ playerId: string; ticksAFK: number }> = []

  for (const [playerId, player] of Object.entries(state.players)) {
    if (!player.alive) continue
    if (isBot(playerId)) continue
    // Already replaced by a bot (AFK takeover) — a bot plays this slot now, so
    // it is no longer "AFK". Keeps the takeover + leaver record firing once.
    if (player.aiControlled) continue

    // lastActionCycle is stamped in GameLoop when actions are drained.
    // A player who has never acted counts as AFK since game start (cycle 0).
    const lastActionCycle = player.lastActionCycle ?? 0

    const ticksSinceAction = state.cycle - lastActionCycle
    if (ticksSinceAction >= AFK_THRESHOLD_TICKS) {
      afkPlayers.push({ playerId, ticksAFK: ticksSinceAction })
    }
  }

  return afkPlayers
}

/**
 * Should a player past the action-AFK threshold actually be replaced by a bot?
 *
 * `detectAFKPlayers` only knows "no game action for N ticks", which false-
 * positives on a player who is present but idle — reading the shop, watching a
 * fight, typing chat. This gate adds presence:
 *
 *  - Disconnected (no live WS peer): convert — the original rule.
 *  - Connected: convert only when ALL of
 *      · another human on the team would benefit (converting the only human
 *        in a bots match serves nobody and ruins their practice game),
 *      · no game action for the LONGER connected threshold, and
 *      · no deliberate client input (action/chat/ping) in that same window.
 */
export function shouldConvertAFK(
  state: GameState,
  playerId: string,
  presence: { isConnected: boolean; msSinceInput: number | null },
): boolean {
  if (!presence.isConnected) return true

  const player = state.players[playerId]
  if (!player) return false

  const hasHumanTeammate = Object.values(state.players).some(
    (p) => p.id !== playerId && p.team === player.team && !isBot(p.id) && !p.aiControlled,
  )
  if (!hasHumanTeammate) return false

  const ticksSinceAction = state.cycle - (player.lastActionCycle ?? 0)
  if (ticksSinceAction < CONNECTED_AFK_THRESHOLD_TICKS) return false

  return (
    presence.msSinceInput == null ||
    presence.msSinceInput >= CONNECTED_AFK_THRESHOLD_TICKS * CYCLE_DURATION_MS
  )
}

/**
 * Safely record a leaver violation (fire-and-forget).
 * Persists to Redis when a service is provided; otherwise just logs.
 */
export function recordLeaverSafe(
  playerId: string,
  gameId: string,
  state: GameState,
  reason: 'afk' | 'disconnect' | 'feed' | 'grief' = 'afk',
  redis?: RedisServiceApi,
): void {
  engineLog.warn('Leaver detected', { playerId, gameId, reason })
  if (!redis) return
  void Effect.runPromise(
    recordLeaver(playerId, gameId, state, reason).pipe(
      Effect.provideService(RedisService, redis),
      Effect.catchAll((err) => {
        engineLog.warn('Leaver record failed', { playerId, error: String(err) })
        return Effect.void
      }),
    ),
  )
}

/**
 * Record a leaver violation
 */
export function recordLeaver(
  playerId: string,
  gameId: string,
  state: GameState,
  reason: 'afk' | 'disconnect' | 'feed' | 'grief' = 'afk',
): Effect.Effect<void, never, RedisService> {
  return Effect.gen(function* () {
    const redis = yield* RedisService

    const record: LeaverRecord = {
      playerId,
      gameId,
      cycle: state.cycle,
      timestamp: Date.now(),
      reason,
      duration:
        reason === 'afk'
          ? (detectAFKPlayers(state).find((p) => p.playerId === playerId)?.ticksAFK ?? 0)
          : 0,
    }

    // Store in Redis
    yield* redis.rpush(`leaver:records:${playerId}`, JSON.stringify(record))
    yield* redis.ltrim(`leaver:records:${playerId}`, -50, -1) // Keep last 50

    // Update leaver score
    const currentPenalty = yield* getPlayerPenalty(playerId)
    const newScore = Math.min(100, currentPenalty.leaverScore + 10)

    yield* redis.set(
      `leaver:score:${playerId}`,
      JSON.stringify({
        playerId,
        leaverScore: newScore,
        totalLeaves: currentPenalty.totalLeaves + 1,
        recentLeaves: Math.min(10, currentPenalty.recentLeaves + 1),
        lowPriority: newScore >= LOW_PRIORITY_THRESHOLD,
        lowPriorityGamesRemaining: newScore >= LOW_PRIORITY_THRESHOLD ? LOW_PRIORITY_GAMES : 0,
        lastLeaveTimestamp: Date.now(),
      }),
    )

    engineLog.warn('Leaver recorded', { playerId, gameId, reason, newScore })
  })
}

/**
 * Get player's current penalty status
 */
export function getPlayerPenalty(
  playerId: string,
): Effect.Effect<PlayerPenalty, never, RedisService> {
  return Effect.gen(function* () {
    const redis = yield* RedisService
    const scoreData = yield* redis.get(`leaver:score:${playerId}`)

    if (!scoreData) {
      return {
        playerId,
        leaverScore: 0,
        totalLeaves: 0,
        recentLeaves: 0,
        lowPriority: false,
        lowPriorityGamesRemaining: 0,
        lastLeaveTimestamp: null,
      }
    }

    return JSON.parse(scoreData) as PlayerPenalty
  })
}

/**
 * Check if a player is in low-priority queue
 */
export function isLowPriority(playerId: string): Effect.Effect<boolean, never, RedisService> {
  return Effect.gen(function* () {
    const penalty = yield* getPlayerPenalty(playerId)
    return penalty.lowPriority
  })
}

/**
 * Decrement low-priority games remaining after completing a game
 */
export function completeLowPriorityGame(
  playerId: string,
): Effect.Effect<void, never, RedisService> {
  return Effect.gen(function* () {
    const redis = yield* RedisService
    const penalty = yield* getPlayerPenalty(playerId)

    if (penalty.lowPriorityGamesRemaining > 0) {
      const updated = {
        ...penalty,
        lowPriorityGamesRemaining: penalty.lowPriorityGamesRemaining - 1,
        lowPriority: penalty.lowPriorityGamesRemaining - 1 > 0,
      }

      yield* redis.set(`leaver:score:${playerId}`, JSON.stringify(updated))

      if (!updated.lowPriority) {
        engineLog.info('Player cleared low-priority queue', { playerId })
      }
    }
  })
}

/**
 * Decay leaver score over time (1 point per day)
 * Call this periodically (daily cron job)
 */
export function decayLeaverScores(): Effect.Effect<void, never, RedisService> {
  return Effect.gen(function* () {
    const redis = yield* RedisService
    const keys = yield* redis.scan('leaver:score:*')

    for (const key of keys) {
      const data = yield* redis.get(key)
      if (!data) continue

      const penalty = JSON.parse(data) as PlayerPenalty
      const newScore = Math.max(0, penalty.leaverScore - LEAVER_SCORE_DECAY)

      const updated = {
        ...penalty,
        leaverScore: newScore,
        lowPriority: newScore >= LOW_PRIORITY_THRESHOLD,
      }

      yield* redis.set(key, JSON.stringify(updated))
    }
  })
}

/**
 * Get leaver records for a player
 */
export function getPlayerLeaverHistory(
  playerId: string,
  limit = 10,
): Effect.Effect<LeaverRecord[], never, RedisService> {
  return Effect.gen(function* () {
    const redis = yield* RedisService
    const records = yield* redis.lrange(`leaver:records:${playerId}`, -limit, -1)
    return records.map((r) => JSON.parse(r) as LeaverRecord)
  })
}

/**
 * Integration: Track player actions to detect AFK
 * Call this whenever a player takes an action
 */
export function markPlayerActive(
  gameId: string,
  playerId: string,
): Effect.Effect<void, never, RedisService> {
  return Effect.gen(function* () {
    const redis = yield* RedisService
    // Store last action cycle in Redis for persistence
    yield* redis.set(`game:${gameId}:last_action:${playerId}`, Date.now().toString())
  })
}

/**
 * Safely mark player as active (fire-and-forget)
 * Use this when RedisService may not be available
 */
export function markPlayerActiveSafe(_gameId: string, _playerId: string): void {
  // No-op for now - in production this would track activity
}
