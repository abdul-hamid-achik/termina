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

  const playerId = getRouterParam(event, 'id')
  if (!playerId) {
    throw createError({ statusCode: 400, message: 'Player ID required' })
  }

  const player = await Effect.runPromise(runtime.dbService.getPlayer(playerId))
  if (!player) {
    throw createError({ statusCode: 404, message: 'Player not found' })
  }

  // Don't expose sensitive fields
  const { email: _email, passwordHash: _passwordHash, ...publicProfile } = player
  return { player: publicProfile }
})
