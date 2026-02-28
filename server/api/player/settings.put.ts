import { Effect } from 'effect'
import { getGameRuntime } from '../../plugins/game-server'
import { HERO_IDS } from '~~/shared/constants/heroes'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user?.id) {
    throw createError({ statusCode: 401, message: 'Authentication required' })
  }

  const body = await readBody<{ username?: string; selectedAvatar?: string | null }>(event)

  const runtime = getGameRuntime()
  if (!runtime) {
    throw createError({ statusCode: 503, message: 'Game server not ready' })
  }

  const playerId = session.user.id as string

  // Validate and update username
  if (body?.username !== undefined) {
    const username = body.username.trim()

    if (username.length < 3 || username.length > 20) {
      throw createError({ statusCode: 400, message: 'Username must be 3-20 characters' })
    }

    if (!/^\w+$/.test(username)) {
      throw createError({ statusCode: 400, message: 'Username can only contain letters, numbers, and underscores' })
    }

    // Check uniqueness
    const existing = await Effect.runPromise(
      runtime.dbService.getPlayerByUsername(username),
    )

    if (existing && existing.id !== playerId) {
      throw createError({ statusCode: 409, message: 'Username already taken' })
    }

    await Effect.runPromise(
      runtime.dbService.updatePlayerUsername(playerId, username),
    )

    // Update session with new username
    await setUserSession(event, {
      user: {
        ...session.user,
        username,
      },
    })
  }

  // Validate and update avatar
  if (body?.selectedAvatar !== undefined) {
    if (body.selectedAvatar !== null && !HERO_IDS.includes(body.selectedAvatar)) {
      throw createError({ statusCode: 400, message: 'Invalid avatar selection' })
    }

    await Effect.runPromise(
      runtime.dbService.updatePlayerAvatar(playerId, body.selectedAvatar),
    )
  }

  // Fetch updated player and refresh session
  const player = await Effect.runPromise(runtime.dbService.getPlayer(playerId))

  await setUserSession(event, {
    user: {
      id: player!.id,
      username: player!.username,
      avatarUrl: player!.avatarUrl,
      selectedAvatar: player!.selectedAvatar,
      provider: session.user.provider as 'github' | 'discord' | 'local',
      hasPassword: !!player!.passwordHash,
    },
  })

  return {
    user: {
      id: player!.id,
      username: player!.username,
      avatarUrl: player!.avatarUrl,
      selectedAvatar: player!.selectedAvatar,
    },
  }
})
