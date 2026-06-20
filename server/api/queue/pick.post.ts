import { getGameRuntime } from '~~/server/plugins/game-server'
import { pickHero } from '~~/server/game/matchmaking/lobby'
import { checkScopedRateLimit } from '~~/server/utils/RateLimiter'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user?.id) {
    throw createError({ statusCode: 401, message: 'Authentication required' })
  }

  const playerId = session.user.id as string

  // Rate limit hero picks (the WS hero_pick path is already limited; this
  // HTTP fallback was unlimited — a script could spam picks).
  if (!checkScopedRateLimit('lobby', playerId)) {
    throw createError({ statusCode: 429, message: 'Pick rate limited. Please slow down.' })
  }

  const runtime = getGameRuntime()
  if (!runtime) {
    throw createError({ statusCode: 503, message: 'Game server not ready' })
  }

  const body = await readBody(event)
  const { lobbyId, heroId } = body ?? {}

  if (!lobbyId || !heroId) {
    throw createError({ statusCode: 400, message: 'Missing lobbyId or heroId' })
  }

  const result = pickHero(
    lobbyId,
    playerId,
    heroId,
    runtime.wsService,
    runtime.redisService,
    runtime.dbService,
  )

  if (!result.success) {
    throw createError({ statusCode: 400, message: result.error ?? 'Pick failed' })
  }

  return { success: true }
})
