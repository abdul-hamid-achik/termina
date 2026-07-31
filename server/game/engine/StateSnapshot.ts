/**
 * Game state snapshots — periodic JSON snapshots of GameState to Redis so
 * an in-progress game can be resumed after a process restart or crash.
 *
 * Snapshots are best-effort: a failure to write or read should never break
 * the live game loop. Encode/decode handles the one non-JSON field shape
 * in GameState (`surrenderVotes` uses Sets).
 *
 * The Redis API is passed in directly (not via Effect.Tag context) so the
 * game loop's Effect type stays free of service requirements — matching
 * the StateManagerApi pattern.
 */

import { Effect } from 'effect'
import type { GameMode, GameState, TeamId } from '~~/shared/types/game'
import type { RedisServiceApi } from '~~/server/services/RedisService'
import { engineLog } from '~~/server/utils/log'

/** Take a snapshot every Nth tick. 15 ticks = 60s at 4s/tick. */
export const SNAPSHOT_EVERY_N_TICKS = 15

/** Increment when the serialized snapshot shape changes incompatibly. */
export const SNAPSHOT_SCHEMA_VERSION = 1

/** Snapshot TTL — long enough to survive a deploy + a few hours of debugging. */
const SNAPSHOT_TTL_SECONDS = 60 * 60 * 8

const KEY_PREFIX = 'gamesnap2:'

function snapshotKey(gameId: string): string {
  return `${KEY_PREFIX}${gameId}`
}

/**
 * Out-of-state metadata captured at game start so we can re-create the
 * onGameOver callback at resume time (mmr updates etc.). Kept minimal.
 */
export interface SnapshotMeta {
  players: { playerId: string; team: TeamId; heroId: string; mmr: number }[]
  mapId?: string
  mode?: GameMode
}

interface SnapshotPayload {
  schemaVersion: number
  gameId: string
  savedAt: number
  state: SerializedGameState
  meta?: SnapshotMeta
}

type SerializedGameState = Omit<GameState, 'surrenderVotes'> & {
  surrenderVotes: { chaff: string[]; audit: string[] }
}

function serialize(state: GameState): SerializedGameState {
  return {
    ...state,
    surrenderVotes: {
      chaff: [...state.surrenderVotes.chaff],
      audit: [...state.surrenderVotes.audit],
    },
  }
}

function deserialize(serialized: SerializedGameState): GameState {
  return {
    ...serialized,
    surrenderVotes: {
      chaff: new Set(serialized.surrenderVotes.chaff),
      audit: new Set(serialized.surrenderVotes.audit),
    },
  }
}

/** Write a snapshot. Errors are logged and swallowed. */
export function writeSnapshot(
  redis: RedisServiceApi,
  gameId: string,
  state: GameState,
  meta?: SnapshotMeta,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const payload: SnapshotPayload = {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      gameId,
      savedAt: Date.now(),
      state: serialize(state),
      meta: meta
        ? {
            ...meta,
            mapId: meta.mapId ?? state.mapId,
            mode: meta.mode ?? state.mode,
          }
        : undefined,
    }
    yield* redis.set(snapshotKey(gameId), JSON.stringify(payload), SNAPSHOT_TTL_SECONDS)
  }).pipe(
    Effect.catchAllCause((cause) => {
      engineLog.warn('Snapshot write failed', { gameId, error: String(cause) })
      return Effect.void
    }),
  )
}

/** Read a snapshot. Returns null if missing or unparseable. */
export function readSnapshot(
  redis: RedisServiceApi,
  gameId: string,
): Effect.Effect<{ state: GameState; savedAt: number; meta?: SnapshotMeta } | null> {
  return Effect.gen(function* () {
    const raw = yield* redis.get(snapshotKey(gameId))
    if (!raw) return null
    const parsed = yield* Effect.try(() => JSON.parse(raw) as SnapshotPayload)
    if (parsed.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
      throw new Error(`Unsupported snapshot schema version: ${String(parsed.schemaVersion)}`)
    }
    return {
      state: deserialize(parsed.state),
      savedAt: parsed.savedAt,
      meta: parsed.meta,
    }
  }).pipe(
    Effect.catchAllCause((cause) => {
      engineLog.warn('Snapshot read failed', { gameId, error: String(cause) })
      return Effect.succeed(null)
    }),
  )
}

/** List all gameIds with an active snapshot in Redis. */
export function listSnapshotGameIds(redis: RedisServiceApi): Effect.Effect<string[]> {
  return Effect.gen(function* () {
    const keys = yield* redis.scan(`${KEY_PREFIX}*`)
    // SCAN can return the same key more than once across cursor iterations —
    // dedupe so a resumed game isn't processed twice.
    return [...new Set(keys.map((k) => k.slice(KEY_PREFIX.length)))]
  }).pipe(
    Effect.catchAllCause((cause) => {
      engineLog.warn('Snapshot list failed', { error: String(cause) })
      return Effect.succeed([] as string[])
    }),
  )
}

/** Delete a snapshot — call when a game ends so we don't try to resume it. */
export function deleteSnapshot(redis: RedisServiceApi, gameId: string): Effect.Effect<void> {
  return Effect.gen(function* () {
    yield* redis.del(snapshotKey(gameId))
  }).pipe(
    Effect.catchAllCause((cause) => {
      engineLog.warn('Snapshot delete failed', { gameId, error: String(cause) })
      return Effect.void
    }),
  )
}
