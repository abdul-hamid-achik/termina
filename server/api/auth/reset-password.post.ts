import { Effect } from 'effect'
import { getGameRuntime } from '~~/server/plugins/game-server'
import { authLog } from '~~/server/utils/log'
import { checkScopedRateLimit } from '~~/server/utils/RateLimiter'
import { sendEmail } from '~~/server/utils/email'
import { passwordChangedTemplate } from '~~/shared/emailTemplates'
import { consumeResetToken } from '~~/server/utils/authTokens'

export default defineEventHandler(async (event) => {
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
  if (!checkScopedRateLimit('auth', ip)) {
    throw createError({ statusCode: 429, message: 'Too many attempts — try again shortly' })
  }

  const body = await readBody<{ token?: string; password?: string }>(event)
  const token = body?.token?.trim()
  const password = body?.password

  if (!token || !password) {
    throw createError({ statusCode: 400, message: 'Token and new password are required' })
  }
  if (password.length < 8) {
    throw createError({ statusCode: 400, message: 'Password must be at least 8 characters' })
  }

  const runtime = getGameRuntime()
  if (!runtime) {
    throw createError({ statusCode: 503, message: 'Game server not ready' })
  }

  // Single-use: getdel atomically redeems the token so a reset link works once.
  const playerId = await consumeResetToken(runtime.redisService, token)
  if (!playerId) {
    throw createError({ statusCode: 400, message: 'This reset link is invalid or has expired' })
  }

  const passwordHash = await hashPassword(password)
  await Effect.runPromise(runtime.dbService.updatePlayerPassword(playerId, passwordHash))
  authLog.info('Password reset completed', { playerId })

  // Best-effort security alert (never block the reset on email).
  const player = await Effect.runPromise(runtime.dbService.getPlayer(playerId))
  if (player?.email) {
    void sendEmail({ to: player.email, ...passwordChangedTemplate() })
  }

  return { ok: true }
})
