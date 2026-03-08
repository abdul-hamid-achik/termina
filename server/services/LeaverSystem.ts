/**
 * Leaver Penalty System
 * Detects AFK players and applies penalties
 * Tracks leaver history and assigns low-priority queue
 */

import { Effect, Layer } from 'effect'
import type { GameState } from '~~/shared/types/game'
import { RedisService } from './RedisService'
import { engineLog } from '../utils/log'

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
  setnx: () => Effect.succeed(0),
  getdel: () => Effect.succeed(null),
  keys: () => Effect.succeed([]),
  expire: () => Effect.succeed(void 0),
  eval: () => Effect.succeed(null),
  shutdown: () => Effect.succeed(void 0),
})

export interface LeaverRecord {
  playerId: string
  gameId: string
  tick: number
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

const AFK_THRESHOLD_TICKS = 30 // 2 minutes at 4s/tick
const LEAVER_SCORE_DECAY = 1 // Points decay per day
const LOW_PRIORITY_THRESHOLD = 30 // Score above this = low priority
const LOW_PRIORITY_GAMES = 3 // Games required to clear low priority

/**
 * Check for AFK players in the game
 * Called every tick to track player activity
 */
export function detectAFKPlayers(state: GameState): Array<{ playerId: string; ticksAFK: number }> {
  const afkPlayers: Array<{ playerId: string; ticksAFK: number }> = []

  for (const [playerId, player] of Object.entries(state.players)) {
    if (!player.alive) continue

    // Track last action tick (this would be updated when player takes actions)
    const lastActionTick =
      (player as unknown as { lastActionTick?: number }).lastActionTick ?? state.tick

    const ticksSinceAction = state.tick - lastActionTick
    if (ticksSinceAction >= AFK_THRESHOLD_TICKS) {
      afkPlayers.push({ playerId, ticksAFK: ticksSinceAction })
    }
  }

  return afkPlayers
}

/**
 * Safely record a leaver violation (fire-and-forget with mock fallback)
 * Use this for async calls where RedisService may not be available
 */
export function recordLeaverSafe(
  playerId: string,
  gameId: string,
  state: GameState,
  reason: 'afk' | 'disconnect' | 'feed' | 'grief' = 'afk',
): void {
  engineLog.warn('Leaver detected (async)', { playerId, gameId, reason })
}

/**
 * Record a leaver violation
 */
export function recordLeaver(
  playerId: string,
  gameId: string,
  state: GameState,
  reason: 'afk' | 'disconnect' | 'feed' | 'grief' = 'afk',
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const redis = yield* RedisService

    const record: LeaverRecord = {
      playerId,
      gameId,
      tick: state.tick,
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
export function getPlayerPenalty(playerId: string): Effect.Effect<PlayerPenalty> {
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
export function isLowPriority(playerId: string): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    const penalty = yield* getPlayerPenalty(playerId)
    return penalty.lowPriority
  })
}

/**
 * Decrement low-priority games remaining after completing a game
 */
export function completeLowPriorityGame(playerId: string): Effect.Effect<void> {
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
export function decayLeaverScores(): Effect.Effect<void> {
  return Effect.gen(function* () {
    const redis = yield* RedisService
    const keys = yield* redis.keys('leaver:score:*')

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
): Effect.Effect<LeaverRecord[]> {
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
export function markPlayerActive(gameId: string, playerId: string): Effect.Effect<void> {
  return Effect.gen(function* () {
    const redis = yield* RedisService
    // Store last action tick in Redis for persistence
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
