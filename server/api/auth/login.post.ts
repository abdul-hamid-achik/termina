import { Effect } from 'effect'
import { getGameRuntime } from '../../plugins/game-server'
import { authLog } from '../../utils/log'

export default defineEventHandler(async (event) => {
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
    const player = await Effect.runPromise(
      runtime.dbService.getPlayerByUsername(username),
    )

    if (!player || !player.passwordHash) {
      throw createError({ statusCode: 401, message: 'Invalid credentials' })
    }

    const valid = await Bun.password.verify(password, player.passwordHash)
    if (!valid) {
      throw createError({ statusCode: 401, message: 'Invalid credentials' })
    }

    authLog.info('Local player logged in', { playerId: player.id, username })

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
    if (err && typeof err === 'object' && 'statusCode' in err) {
      throw err
    }
    authLog.error('Login error', err)
    throw createError({ statusCode: 500, message: 'Login failed' })
  }
})
