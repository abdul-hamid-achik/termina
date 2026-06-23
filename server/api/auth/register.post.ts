import { Effect } from 'effect'
import { getGameRuntime } from '~~/server/plugins/game-server'
import { authLog } from '~~/server/utils/log'
import { checkScopedRateLimit } from '~~/server/utils/RateLimiter'
import { sendEmail } from '~~/server/utils/email'
import { verifyEmailTemplate, welcomeTemplate } from '~~/shared/emailTemplates'
import { createVerifyToken } from '~~/server/utils/authTokens'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default defineEventHandler(async (event) => {
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
  if (!checkScopedRateLimit('auth', ip)) {
    throw createError({ statusCode: 429, message: 'Too many attempts — try again shortly' })
  }

  const body = await readBody<{ username?: string; password?: string; email?: string }>(event)

  // Validate input
  const username = body?.username?.trim()
  const password = body?.password
  // Email is OPTIONAL — but it's the only way to recover a forgotten password,
  // so we collect + verify it when provided.
  const email = body?.email?.trim() || null

  if (!username || !password) {
    throw createError({ statusCode: 400, message: 'Username and password are required' })
  }

  if (email && !EMAIL_RE.test(email)) {
    throw createError({ statusCode: 400, message: 'Enter a valid email address' })
  }

  if (username.length < 3 || username.length > 20) {
    throw createError({ statusCode: 400, message: 'Username must be 3-20 characters' })
  }

  if (!/^\w+$/.test(username)) {
    throw createError({
      statusCode: 400,
      message: 'Username can only contain letters, numbers, and underscores',
    })
  }

  if (password.length < 8) {
    throw createError({ statusCode: 400, message: 'Password must be at least 8 characters' })
  }

  const runtime = getGameRuntime()
  if (!runtime) {
    throw createError({ statusCode: 503, message: 'Game server not ready' })
  }

  try {
    // Check if username is taken
    const existing = await Effect.runPromise(runtime.dbService.getPlayerByUsername(username))

    if (existing) {
      throw createError({ statusCode: 409, message: 'Username already taken' })
    }

    // Hash password (hashPassword auto-imported from nuxt-auth-utils)
    const passwordHash = await hashPassword(password)

    // Create player
    const player = await Effect.runPromise(
      runtime.dbService.createLocalPlayer(username, passwordHash, email),
    )

    authLog.info('New local player registered', {
      playerId: player.id,
      username,
      hasEmail: !!email,
    })

    // Best-effort welcome + verification emails (never block registration).
    if (email) {
      const appUrl = useRuntimeConfig().appUrl
      void (async () => {
        try {
          const token = await createVerifyToken(runtime.redisService, player.id)
          const verifyUrl = `${appUrl}/verify-email?token=${token}`
          const welcome = welcomeTemplate(username)
          await sendEmail({ to: email, ...welcome })
          const verify = verifyEmailTemplate(verifyUrl)
          await sendEmail({ to: email, ...verify })
        } catch (err) {
          authLog.error('Post-registration email failed', {
            playerId: player.id,
            error: String(err),
          })
        }
      })()
    }

    // Set session
    await setUserSession(event, {
      user: {
        id: player.id,
        username: player.username,
        avatarUrl: player.avatarUrl,
        selectedAvatar: player.selectedAvatar,
        provider: 'local',
        hasPassword: true,
      },
    })

    return {
      user: {
        id: player.id,
        username: player.username,
        avatarUrl: player.avatarUrl,
        selectedAvatar: player.selectedAvatar,
        provider: 'local' as const,
        hasPassword: true,
      },
    }
  } catch (err) {
    // Re-throw createError instances (validation/conflict errors)
    if (err && typeof err === 'object' && 'statusCode' in err) {
      throw err
    }
    const detail = err instanceof Error ? err.message : String(err)
    authLog.error('Registration error', err)
    throw createError({
      statusCode: 500,
      message: import.meta.dev ? `Registration failed: ${detail}` : 'Registration failed',
    })
  }
})
