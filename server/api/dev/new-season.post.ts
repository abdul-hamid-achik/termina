import { Effect } from 'effect'
import { getGameRuntime } from '~~/server/plugins/game-server'
import { testHooksEnabled } from '~~/server/utils/testHooks'

/**
 * Rotate the competitive season: closes the active season, opens the next one,
 * and soft-resets every player's seasonal MMR toward the baseline (lifetime MMR
 * is untouched). This is an operational action — exposed only in dev / test-hooks
 * previews. A real production deployment should drive this through a proper
 * admin path (auth + audit), which is out of scope for the MVP.
 */
export default defineEventHandler(async () => {
  if (!import.meta.dev && !testHooksEnabled()) {
    throw createError({ statusCode: 403, message: 'Not available' })
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
