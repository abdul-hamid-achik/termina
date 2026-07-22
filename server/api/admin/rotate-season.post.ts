import { Effect } from 'effect'
import { getGameRuntime } from '~~/server/plugins/game-server'

/**
 * Production season rotation, gated by a shared admin secret.
 *
 * Auth: the request must send the configured secret in the `x-admin-key` header.
 * The secret comes from `TERMINA_ADMIN_KEY`. If that env var is unset the
 * endpoint is disabled (403) — it is never accidentally open. (Dev/test-hooks
 * rotation lives at /api/dev/new-season for local + e2e use.)
 *
 * Effect: closes the active season, opens the next one, and soft-resets every
 * player's seasonal MMR toward the baseline (lifetime MMR untouched).
 */
export default defineEventHandler(async (event) => {
  const configuredKey = process.env.TERMINA_ADMIN_KEY
  if (!configuredKey) {
    throw createError({ statusCode: 403, message: 'Admin rotation not configured' })
  }

  const providedKey = getHeader(event, 'x-admin-key')
  if (!providedKey || providedKey !== configuredKey) {
    throw createError({ statusCode: 401, message: 'Invalid admin key' })
  }

  const runtime = getGameRuntime()
  if (!runtime) {
    throw createError({ statusCode: 503, message: 'Game server not ready' })
  }

  const season = await Effect.runPromise(runtime.dbService.startNewSeason())
  return {
    success: true,
    season: { number: season.seasonNumber, startedAt: season.startedAt },
  }
})
