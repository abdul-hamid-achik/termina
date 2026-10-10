import { Effect } from 'effect'
import { getGameRuntime } from '~~/server/plugins/game-server'
import { authLog } from '~~/server/utils/log'
import { checkScopedRateLimit } from '~~/server/utils/RateLimiter'
import { upgradedSessionSecure } from '~~/server/utils/guest'
import { endFormerGuestPractice } from '~~/server/utils/guestPracticeEnd'

export default defineEventHandler(async (event) => {
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
  if (!checkScopedRateLimit('auth', ip)) {
    throw createError({ statusCode: 429, message: 'Too many attempts — try again shortly' })
  }

  const body = await readBody<{ username?: string; password?: string }>(event)

  const username = body?.username?.trim()
  const password = body?.password

  if (!username || !password) {
    throw createError({ statusCode: 400, message: 'Username and password are required' })
  }

  const runtime = getGameRuntime()
  if (!runtime) {
    throw createError({ statusCode: 503, message: 'Game server not ready' })
  }

  try {
    const player = await Effect.runPromise(runtime.dbService.getPlayerByUsername(username))

    if (!player || !player.passwordHash) {
      throw createError({ statusCode: 401, message: 'Invalid credentials' })
    }

    // verifyPassword auto-imported from nuxt-auth-utils (hash first, then plain)
    const valid = await verifyPassword(player.passwordHash, password)
    if (!valid) {
      throw createError({ statusCode: 401, message: 'Invalid credentials' })
    }

    authLog.info('Local player logged in', { playerId: player.id, username })

    // Swap the guest session for the real identity. NOT setUserSession: that deep-merges
    // (defu), so a guest's `user.guest: true` survived and the nav kept showing [GUEST].
    // replaceUserSession is only clear() + update(), and h3's clear() does not drop the
    // request cookie that update() re-reads: the result is a TOP-LEVEL shallow merge
    // (`user` is replaced wholesale, any other key would survive). So every top-level
    // key a session can carry (`user`, `secure`) is set explicitly here.
    // A guest signing in keeps a claim on the practice game it left running
    // (formerGuestId → GAME_SESSION_CHANGED in action.post, not a bare 403).
    const prior = await getUserSession(event)
    const secure = upgradedSessionSecure(prior)
    await replaceUserSession(event, {
      secure,
      user: {
        id: player.id,
        username: player.username,
        avatarUrl: player.avatarUrl,
        selectedAvatar: player.selectedAvatar,
        provider: 'local',
        hasPassword: true,
        tutorialCompleted: !!player.tutorialCompleted,
      },
    })
    // The guest's practice game would otherwise tick on for nobody.
    if (secure) await endFormerGuestPractice(secure.formerGuestId)

    return {
      user: {
        id: player.id,
        username: player.username,
        avatarUrl: player.avatarUrl,
        selectedAvatar: player.selectedAvatar,
        provider: 'local' as const,
        hasPassword: true,
        tutorialCompleted: !!player.tutorialCompleted,
      },
    }
  } catch (err) {
    if (err && typeof err === 'object' && 'statusCode' in err) {
      throw err
    }
    const detail = err instanceof Error ? err.message : String(err)
    authLog.error('Login error', err)
    throw createError({
      statusCode: 500,
      message: import.meta.dev ? `Login failed: ${detail}` : 'Login failed',
    })
  }
})
