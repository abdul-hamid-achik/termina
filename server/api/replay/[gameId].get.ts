import { Effect } from 'effect'
import { getGameRuntime } from '~~/server/plugins/game-server'
import { readSnapshot } from '~~/server/game/engine/StateSnapshot'
import { readActionLog, type LoggedAction } from '~~/server/game/engine/ActionLog'
import type { SnapshotMeta } from '~~/server/game/engine/StateSnapshot'
import { serializeStateForTransport } from '~~/server/game/engine/replayArtifact'
import { checkScopedRateLimit } from '~~/server/utils/RateLimiter'

/**
 * Return the final state + persisted action log for a game so a client-side
 * replay player can rehydrate it and step through ticks.
 *
 * Two sources, one shape:
 *  - Redis (fast path, 8h TTL): the live snapshot + action log.
 *  - Postgres archive (match_replays): written at finalization, forever.
 * Redis is tried first; the archive answers once Redis has forgotten the game.
 *
 * Integrity metadata is always included. A truncated log is still returned
 * here (raw dump for debugging) but marked `complete: false` so the UI must
 * not present it as an exact full-match replay. Frame reconstruction
 * (`/frames`) rejects truncated logs with 409. Archived replays are only ever
 * written from complete logs, so the archive path always reports complete.
 */
export default defineEventHandler(async (event) => {
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
  if (!checkScopedRateLimit('publicRead', ip)) {
    throw createError({ statusCode: 429, message: 'Too many requests — try again shortly' })
  }

  const runtime = getGameRuntime()
  if (!runtime) {
    throw createError({ statusCode: 503, message: 'Game server not ready' })
  }

  const gameId = getRouterParam(event, 'gameId')
  if (!gameId) {
    throw createError({ statusCode: 400, message: 'Game ID required' })
  }

  // readSnapshot is best-effort — Redis failures return null and fall through
  // to the archive.
  const snap = await Effect.runPromise(readSnapshot(runtime.redisService, gameId))

  if (snap) {
    // Replays are post-game only. Mid-game snapshots are written every N ticks
    // for crash recovery and carry the FULL unfogged state (positions, scrip,
    // items, queued auto-path orders) — serving them while the game runs would
    // be a free maphack for anyone polling this public endpoint.
    if (snap.state.phase !== 'ended') {
      throw createError({ statusCode: 403, message: 'Replay available after the game ends' })
    }

    const { actions, integrity } = await Effect.runPromise(
      readActionLog(runtime.redisService, gameId),
    )
    if (!integrity.readFailed) {
      return {
        gameId,
        source: 'live' as const,
        savedAt: snap.savedAt,
        state: serializeStateForTransport(snap.state),
        meta: snap.meta,
        actions,
        integrity,
      }
    }
    // Redis snapshot exists but the log read failed — the archive may still
    // have the complete artifact; fall through.
  }

  const archived = await Effect.runPromise(runtime.dbService.getMatchReplay(gameId))
  if (!archived) {
    // A Redis snapshot existed but its log read failed — transient, retry.
    // Only a clean miss on BOTH sources is a real 404.
    if (snap) {
      throw createError({ statusCode: 503, message: 'Replay action log unavailable' })
    }
    throw createError({ statusCode: 404, message: 'Replay not found' })
  }

  return {
    gameId,
    source: 'archive' as const,
    savedAt: archived.createdAt?.toISOString?.() ?? null,
    // Stored pre-serialized at write time (sets already arrays) — pass through.
    state: archived.finalState,
    meta: archived.meta as SnapshotMeta,
    actions: archived.actions as LoggedAction[],
    // Archives are only written from complete logs (see archiveMatchReplay).
    integrity: { complete: true, truncated: false, readFailed: false },
    rulesetVersion: archived.rulesetVersion,
  }
})
