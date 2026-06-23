import { Effect } from 'effect'
import { getGameRuntime } from '~~/server/plugins/game-server'
import { authLog } from '~~/server/utils/log'
import { checkScopedRateLimit } from '~~/server/utils/RateLimiter'
import { sendEmail } from '~~/server/utils/email'
import { passwordResetTemplate } from '~~/shared/emailTemplates'
import { createResetToken } from '~~/server/utils/authTokens'

export default defineEventHandler(async (event) => {
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
  if (!checkScopedRateLimit('auth', ip)) {
    throw createError({ statusCode: 429, message: 'Too many attempts — try again shortly' })
  }

  const body = await readBody<{ username?: string }>(event)
  const username = body?.username?.trim()

  // ALWAYS respond identically regardless of whether the account exists or has
  // an email on file — prevents username/email enumeration via this endpoint.
  const ok = { ok: true as const }
  if (!username) return ok

  const runtime = getGameRuntime()
  if (!runtime) return ok

  try {
    const player = await Effect.runPromise(runtime.dbService.getPlayerByUsername(username))
    if (player?.email) {
      const token = await createResetToken(runtime.redisService, player.id)
      const resetUrl = `${useRuntimeConfig().appUrl}/reset-password?token=${token}`
      const tpl = passwordResetTemplate(resetUrl)
      await sendEmail({ to: player.email, ...tpl })
      authLog.info('Password reset email sent', { playerId: player.id })
    }
  } catch (err) {
    authLog.error('forgot-password error', { error: String(err) })
  }

  return ok
})
