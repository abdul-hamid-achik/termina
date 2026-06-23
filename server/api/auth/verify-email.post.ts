import { Effect } from 'effect'
import { getGameRuntime } from '~~/server/plugins/game-server'
import { authLog } from '~~/server/utils/log'
import { checkScopedRateLimit } from '~~/server/utils/RateLimiter'
import { consumeVerifyToken } from '~~/server/utils/authTokens'

// Public: the unguessable token IS the proof of email ownership, so no session
// is required (the link is clicked from the user's inbox, possibly logged out).
export default defineEventHandler(async (event) => {
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
  if (!checkScopedRateLimit('auth', ip)) {
    throw createError({ statusCode: 429, message: 'Too many attempts — try again shortly' })
  }

  const body = await readBody<{ token?: string }>(event)
  const token = body?.token?.trim()
  if (!token) {
    throw createError({ statusCode: 400, message: 'Verification token is required' })
  }

  const runtime = getGameRuntime()
  if (!runtime) {
    throw createError({ statusCode: 503, message: 'Game server not ready' })
  }

  const playerId = await consumeVerifyToken(runtime.redisService, token)
  if (!playerId) {
    throw createError({
      statusCode: 400,
      message: 'This verification link is invalid or has expired',
    })
  }

  await Effect.runPromise(runtime.dbService.setEmailVerified(playerId))
  authLog.info('Email verified', { playerId })
  return { ok: true }
})
