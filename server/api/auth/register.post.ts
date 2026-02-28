import { Effect } from 'effect'
import { getGameRuntime } from '../../plugins/game-server'
import { authLog } from '../../utils/log'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ username?: string; password?: string }>(event)

  // Validate input
  const username = body?.username?.trim()
  const password = body?.password

  if (!username || !password) {
    throw createError({ statusCode: 400, message: 'Username and password are required' })
  }

  if (username.length < 3 || username.length > 20) {
    throw createError({ statusCode: 400, message: 'Username must be 3-20 characters' })
  }

  if (!/^\w+$/.test(username)) {
    throw createError({ statusCode: 400, message: 'Username can only contain letters, numbers, and underscores' })
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
    const existing = await Effect.runPromise(
      runtime.dbService.getPlayerByUsername(username),
    )

    if (existing) {
      throw createError({ statusCode: 409, message: 'Username already taken' })
    }

    // Hash password (hashPassword auto-imported from nuxt-auth-utils)
    const passwordHash = await hashPassword(password)

    // Create player
    const player = await Effect.runPromise(
      runtime.dbService.createLocalPlayer(username, passwordHash),
    )

    authLog.info('New local player registered', { playerId: player.id, username })

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
    authLog.error('Registration error', err)
    throw createError({ statusCode: 500, message: 'Registration failed' })
  }
})
