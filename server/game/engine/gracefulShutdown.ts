/**
 * Graceful-shutdown snapshot flush. On SIGTERM (App Platform rolling deploy)
 * the game-server close hook calls this to persist a final snapshot for each
 * live game so the replacement instance resumes with minimal tick loss.
 *
 * Safe by construction:
 *  - time-bounded, so it can never delay the SIGKILL grace window;
 *  - best-effort — every failure is swallowed, leaving the ≤60s periodic
 *    snapshot as the fallback (i.e. no worse than not running at all);
 *  - games without captured meta are skipped, because the resume path requires
 *    `meta.players` and a meta-less snapshot would break it.
 */
import { Effect } from 'effect'
import type { GameState } from '~~/shared/types/game'
import type { RedisServiceApi } from '~~/server/services/RedisService'
import { writeSnapshot, type SnapshotMeta } from './StateSnapshot'

/** Minimal live-game shape the flush needs (a structural subset of LiveGameEntry). */
export interface ShutdownGameEntry {
  stateManager: { getState: (gameId: string) => Effect.Effect<GameState, unknown> }
  meta?: SnapshotMeta
}

export function flushFinalSnapshots(
  games: Iterable<readonly [string, ShutdownGameEntry]>,
  redis: RedisServiceApi,
  timeoutMs = 5000,
): Effect.Effect<void> {
  return Effect.forEach(
    [...games],
    ([gameId, entry]) => {
      const meta = entry.meta
      if (!meta) return Effect.void
      return entry.stateManager.getState(gameId).pipe(
        Effect.flatMap((state) => writeSnapshot(redis, gameId, state, meta)),
        Effect.catchAll(() => Effect.void),
      )
    },
    { concurrency: 'unbounded', discard: true },
  ).pipe(
    Effect.timeout(`${timeoutMs} millis`),
    Effect.catchAll(() => Effect.void),
  )
}
