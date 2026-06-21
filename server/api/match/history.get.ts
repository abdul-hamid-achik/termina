import { Effect } from 'effect'
import { getGameRuntime } from '~~/server/plugins/game-server'
import { checkScopedRateLimit } from '~~/server/utils/RateLimiter'

export default defineEventHandler(async (event) => {
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
  if (!checkScopedRateLimit('publicRead', ip)) {
    throw createError({ statusCode: 429, message: 'Too many requests — try again shortly' })
  }

  const runtime = getGameRuntime()
  if (!runtime) {
    throw createError({ statusCode: 503, message: 'Game server not ready' })
  }

  const query = getQuery(event)
  const playerId = query.player as string | undefined
  const limit = Math.min(Number(query.limit) || 20, 100)

  if (!playerId) {
    // Fall back to authenticated user
    const session = await getUserSession(event)
    if (!session?.user?.id) {
      throw createError({ statusCode: 401, message: 'Player ID required' })
    }
    const matches = await Effect.runPromise(
      runtime.dbService.getMatchHistory(session.user.id, limit),
    )
    return { matches }
  }

  const matches = await Effect.runPromise(runtime.dbService.getMatchHistory(playerId, limit))
  return { matches }
})
