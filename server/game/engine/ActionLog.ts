/**
 * Per-game action log — appends every player action to a Redis list so the
 * full sequence of inputs can be replayed even after a restart. Together
 * with periodic state snapshots this is the foundation for deterministic
 * replays and post-mortem debugging.
 *
 * Design notes:
 * - One Redis list per game at `gamelog:{gameId}`. RPUSH on each cycle.
 * - Bounded length via LTRIM after each push so a runaway game can't fill
 *   memory; we keep the most recent ACTION_LOG_MAX entries.
 * - Integrity metadata lives at `gamelogmeta:{gameId}` so callers can tell
 *   a truncated/read-failed log from a complete one. Frames reconstruction
 *   always starts at cycle 0, so a truncated log MUST NOT be presented as
 *   an exact full-match replay.
 * - Best-effort: failures are logged and swallowed on write. Reads surface
 *   `readFailed` instead of silently looking empty.
 * - Same TTL as snapshots so the keys go away even if cleanup is missed.
 */

import { Effect } from 'effect'
import type { Command } from '~~/shared/types/commands'
import type { RedisServiceApi } from '~~/server/services/RedisService'
import { engineLog } from '~~/server/utils/log'

const KEY_PREFIX = 'gamelog:'
const META_PREFIX = 'gamelogmeta:'
const TTL_SECONDS = 60 * 60 * 8

/**
 * Cap on retained log entries per game. ~10000 covers a 60+ minute match
 * with heavy action density (10 players × ~1 action/cycle × 900 ticks plus
 * headroom for bots).
 */
export const ACTION_LOG_MAX = 10_000

function logKey(gameId: string): string {
  return `${KEY_PREFIX}${gameId}`
}

function metaKey(gameId: string): string {
  return `${META_PREFIX}${gameId}`
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
  /** True when LTRIM discarded earlier entries (or the log is at capacity
   *  and the head is past cycle 1 — defensive signal). */
  truncated: boolean
  /** True when Redis read/parse failed; actions will be empty. */
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

interface StoredLogMeta {
  truncated: boolean
  firstLoggedCycle: number | null
  lastLoggedCycle: number | null
  entryCount: number
}

function completeIntegrity(partial: Omit<ActionLogIntegrity, 'complete' | 'initialSnapshotCycle'>): ActionLogIntegrity {
  return {
    ...partial,
    initialSnapshotCycle: 0,
    complete: !partial.truncated && !partial.readFailed,
  }
}

function emptyIntegrity(overrides: Partial<ActionLogIntegrity> = {}): ActionLogIntegrity {
  return completeIntegrity({
    truncated: false,
    readFailed: false,
    entryCount: 0,
    firstLoggedCycle: null,
    lastLoggedCycle: null,
    ...overrides,
  })
}

function cycleBounds(actions: LoggedAction[]): {
  firstLoggedCycle: number | null
  lastLoggedCycle: number | null
} {
  if (actions.length === 0) {
    return { firstLoggedCycle: null, lastLoggedCycle: null }
  }
  let first = actions[0]!.cycle
  let last = actions[0]!.cycle
  for (const a of actions) {
    if (a.cycle < first) first = a.cycle
    if (a.cycle > last) last = a.cycle
  }
  return { firstLoggedCycle: first, lastLoggedCycle: last }
}

function parseStoredMeta(raw: string | null): StoredLogMeta | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<StoredLogMeta>
    return {
      truncated: parsed.truncated === true,
      firstLoggedCycle:
        typeof parsed.firstLoggedCycle === 'number' ? parsed.firstLoggedCycle : null,
      lastLoggedCycle: typeof parsed.lastLoggedCycle === 'number' ? parsed.lastLoggedCycle : null,
      entryCount: typeof parsed.entryCount === 'number' ? parsed.entryCount : 0,
    }
  } catch {
    return null
  }
}

/**
 * Append a batch of actions for the given cycle. Failures are swallowed so
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
    const mKey = metaKey(gameId)
    const beforeLen = yield* redis.llen(key)
    const priorMeta = parseStoredMeta(yield* redis.get(mKey))
    let truncated = priorMeta?.truncated === true

    for (const action of actions) {
      yield* redis.rpush(key, JSON.stringify(action))
    }
    // Trim to the last ACTION_LOG_MAX entries (keep the tail).
    if (beforeLen + actions.length > ACTION_LOG_MAX) {
      truncated = true
    }
    yield* redis.ltrim(key, -ACTION_LOG_MAX, -1)
    yield* redis.expire(key, TTL_SECONDS)

    const retained = yield* redis.lrange(key, 0, -1)
    const parsedRetained: LoggedAction[] = []
    for (const r of retained) {
      try {
        parsedRetained.push(JSON.parse(r) as LoggedAction)
      } catch {
        // Skip corrupt entries when refreshing meta; read path handles them too.
      }
    }
    const bounds = cycleBounds(parsedRetained)
    // Defensive: a full buffer whose earliest retained cycle is past the
    // opening cycles almost certainly lost head entries even if the counter
    // race missed the length check.
    if (
      parsedRetained.length >= ACTION_LOG_MAX &&
      bounds.firstLoggedCycle !== null &&
      bounds.firstLoggedCycle > 1
    ) {
      truncated = true
    }

    const meta: StoredLogMeta = {
      truncated,
      firstLoggedCycle: bounds.firstLoggedCycle,
      lastLoggedCycle: bounds.lastLoggedCycle,
      entryCount: parsedRetained.length,
    }
    yield* redis.set(mKey, JSON.stringify(meta), TTL_SECONDS)
  }).pipe(
    Effect.catchAllCause((cause) => {
      engineLog.warn('Action log append failed', { gameId, error: String(cause) })
      return Effect.void
    }),
  )
}

/**
 * Read the action log plus integrity metadata. Prefer this over `readActions`
 * whenever the caller must not treat a truncated/failed log as complete.
 */
export function readActionLog(
  redis: RedisServiceApi,
  gameId: string,
): Effect.Effect<ActionLogReadResult> {
  return Effect.gen(function* () {
    const raw = yield* redis.lrange(logKey(gameId), 0, -1)
    const storedMeta = parseStoredMeta(yield* redis.get(metaKey(gameId)))
    const actions: LoggedAction[] = []
    for (const r of raw) {
      const parsed = yield* Effect.try(() => JSON.parse(r) as LoggedAction)
      actions.push(parsed)
    }
    const bounds = cycleBounds(actions)
    let truncated = storedMeta?.truncated === true
    if (
      actions.length >= ACTION_LOG_MAX &&
      bounds.firstLoggedCycle !== null &&
      bounds.firstLoggedCycle > 1
    ) {
      truncated = true
    }
    return {
      actions,
      integrity: completeIntegrity({
        truncated,
        readFailed: false,
        entryCount: actions.length,
        firstLoggedCycle: bounds.firstLoggedCycle ?? storedMeta?.firstLoggedCycle ?? null,
        lastLoggedCycle: bounds.lastLoggedCycle ?? storedMeta?.lastLoggedCycle ?? null,
      }),
    }
  }).pipe(
    Effect.catchAllCause((cause) => {
      engineLog.warn('Action log read failed', { gameId, error: String(cause) })
      return Effect.succeed({
        actions: [] as LoggedAction[],
        integrity: emptyIntegrity({ readFailed: true }),
      })
    }),
  )
}

/** Read all logged actions for a game (in cycle order). */
export function readActions(redis: RedisServiceApi, gameId: string): Effect.Effect<LoggedAction[]> {
  return readActionLog(redis, gameId).pipe(Effect.map((r) => r.actions))
}

/** Drop the action log for a game — call when a game ends. */
export function deleteActionLog(redis: RedisServiceApi, gameId: string): Effect.Effect<void> {
  return Effect.gen(function* () {
    yield* redis.del(logKey(gameId))
    yield* redis.del(metaKey(gameId))
  }).pipe(
    Effect.catchAllCause((cause) => {
      engineLog.warn('Action log delete failed', { gameId, error: String(cause) })
      return Effect.void
    }),
  )
}
