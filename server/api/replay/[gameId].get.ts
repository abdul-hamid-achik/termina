import { Effect } from 'effect'
import { getGameRuntime } from '~~/server/plugins/game-server'
import type { SnapshotMeta, LoggedAction } from '~~/server/game/engine/replayArtifact'
import { checkScopedRateLimit } from '~~/server/utils/RateLimiter'

/**
 * Return the archived final state + persisted action log for a finished game
 * so a client-side replay player can rehydrate it and step through ticks.
 *
 * Archive-only (all-Vercel cutover): the DO-era Redis fast path (a live
 * snapshot + action log, 8h TTL) is gone with the WS game server. The only
 * remaining source is the Postgres archive (match_replays), written at
 * finalization — see replayArtifact.ts's module doc for why nothing writes
 * one on the Neon/Workflow path yet. A game that hasn't been archived (still
 * in progress, or finished before archiving was wired up) 404s here.
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

  const archived = await Effect.runPromise(runtime.dbService.getMatchReplay(gameId))
  if (!archived) {
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
    // Archives are only ever written from complete logs.
    integrity: { complete: true, truncated: false, readFailed: false },
    rulesetVersion: archived.rulesetVersion,
  }
})
