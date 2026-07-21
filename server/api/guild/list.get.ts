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

  const guilds = await Effect.runPromise(runtime.dbService.listGuilds(50))
  return { guilds }
})
