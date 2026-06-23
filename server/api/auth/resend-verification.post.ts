import { Effect } from 'effect'
import { getGameRuntime } from '~~/server/plugins/game-server'
import { authLog } from '~~/server/utils/log'
import { checkScopedRateLimit } from '~~/server/utils/RateLimiter'
import { sendEmail } from '~~/server/utils/email'
import { verifyEmailTemplate } from '~~/shared/emailTemplates'
import { createVerifyToken } from '~~/server/utils/authTokens'

// Logged-in users can re-request a verification email for the address on file.
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  const userId = session?.user?.id as string | undefined
  if (!userId) {
    throw createError({ statusCode: 401, message: 'Authentication required' })
  }
  if (!checkScopedRateLimit('auth', userId)) {
    throw createError({ statusCode: 429, message: 'Too many attempts — try again shortly' })
  }

  const runtime = getGameRuntime()
  if (!runtime) {
    throw createError({ statusCode: 503, message: 'Game server not ready' })
  }

  const player = await Effect.runPromise(runtime.dbService.getPlayer(userId))
  // Only send when there's an unverified email; return ok either way.
  if (player?.email && !player.emailVerifiedAt) {
    const token = await createVerifyToken(runtime.redisService, player.id)
    const verifyUrl = `${useRuntimeConfig().appUrl}/verify-email?token=${token}`
    void sendEmail({ to: player.email, ...verifyEmailTemplate(verifyUrl) })
    authLog.info('Verification email resent', { playerId: player.id })
  }

  return { ok: true }
})
