/**
 * Per-game action log — appends every player action to a Redis list so the
 * full sequence of inputs can be replayed even after a restart. Together
 * with periodic state snapshots this is the foundation for deterministic
 * replays and post-mortem debugging.
 *
 * Design notes:
 * - One Redis list per game at `gamelog:{gameId}`. RPUSH on each tick.
 * - Bounded length via LTRIM after each push so a runaway game can't fill
 *   memory; we keep the most recent ACTION_LOG_MAX entries.
 * - Best-effort: failures are logged and swallowed. The live game never
 *   blocks on the log.
 * - Same TTL as snapshots so the keys go away even if cleanup is missed.
 */

import { Effect } from 'effect'
import type { Command } from '~~/shared/types/commands'
import type { RedisServiceApi } from '../../services/RedisService'
import { engineLog } from '../../utils/log'

const KEY_PREFIX = 'gamelog:'
const TTL_SECONDS = 60 * 60 * 8

/**
 * Cap on retained log entries per game. ~10000 covers a 60+ minute match
 * with heavy action density (10 players × ~1 action/tick × 900 ticks plus
 * headroom for bots).
 */
const ACTION_LOG_MAX = 10_000

function logKey(gameId: string): string {
  return `${KEY_PREFIX}${gameId}`
}

export interface LoggedAction {
  tick: number
  playerId: string
  command: Command
}

/**
 * Append a batch of actions for the given tick. Failures are swallowed so
 * a Redis hiccup never breaks the game loop.
 */
export function appendActions(
  redis: RedisServiceApi,
  gameId: string,
  actions: LoggedAction[],
): Effect.Effect<void> {
  if (actions.length === 0) return Effect.void
  return Effect.gen(function* () {
    const key = logKey(gameId)
    for (const action of actions) {
      yield* redis.rpush(key, JSON.stringify(action))
    }
    // Trim to the last ACTION_LOG_MAX entries (keep the tail).
    yield* redis.ltrim(key, -ACTION_LOG_MAX, -1)
    yield* redis.expire(key, TTL_SECONDS)
  }).pipe(
    Effect.catchAllCause((cause) => {
      engineLog.warn('Action log append failed', { gameId, error: String(cause) })
      return Effect.void
    }),
  )
}

/** Read all logged actions for a game (in tick order). */
export function readActions(
  redis: RedisServiceApi,
  gameId: string,
): Effect.Effect<LoggedAction[]> {
  return Effect.gen(function* () {
    const raw = yield* redis.lrange(logKey(gameId), 0, -1)
    const actions: LoggedAction[] = []
    for (const r of raw) {
      const parsed = yield* Effect.try(() => JSON.parse(r) as LoggedAction)
      actions.push(parsed)
    }
    return actions
  }).pipe(
    Effect.catchAllCause((cause) => {
      engineLog.warn('Action log read failed', { gameId, error: String(cause) })
      return Effect.succeed([] as LoggedAction[])
    }),
  )
}

/** Drop the action log for a game — call when a game ends. */
export function deleteActionLog(redis: RedisServiceApi, gameId: string): Effect.Effect<void> {
  return Effect.gen(function* () {
    yield* redis.del(logKey(gameId))
  }).pipe(
    Effect.catchAllCause((cause) => {
      engineLog.warn('Action log delete failed', { gameId, error: String(cause) })
      return Effect.void
    }),
  )
}
