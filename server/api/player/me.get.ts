import { Effect } from 'effect'
import { getGameRuntime } from '~~/server/plugins/game-server'
import { isGuestId } from '~~/server/utils/guest'

/**
 * Refresh the session user from the DB row. The session payload is stamped at
 * login, so fields that change mid-session (tutorialCompleted after finishing
 * the tutorial) go stale until the next login; this endpoint re-reads the row
 * and re-stamps the session. Invoked once from PostGame when a tutorial game
 * is actually completed.
 */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user?.id) {
    throw createError({ statusCode: 401, message: 'Authentication required' })
  }

  // A guest has no `players` row by design (server/api/auth/guest.post.ts), so
  // the DB read below 404'd for every guest on every call — console noise, and
  // a contract the client had to special-case. Answer from the session instead,
  // in the same shape, flagged `guest: true`; nothing to re-stamp.
  const sessionUser = session.user
  if (sessionUser.guest || isGuestId(sessionUser.id)) {
    return {
      user: {
        id: sessionUser.id,
        username: sessionUser.username,
        avatarUrl: sessionUser.avatarUrl ?? null,
        selectedAvatar: sessionUser.selectedAvatar ?? null,
        tutorialCompleted: !!sessionUser.tutorialCompleted,
        guest: true as const,
      },
    }
  }

  const runtime = getGameRuntime()
  if (!runtime) {
    throw createError({ statusCode: 503, message: 'Game server not ready' })
  }

  const player = await Effect.runPromise(runtime.dbService.getPlayer(session.user.id))
  if (!player) {
    throw createError({ statusCode: 404, message: 'Player not found' })
  }

  await setUserSession(event, {
    user: {
      id: player.id,
      username: player.username,
      avatarUrl: player.avatarUrl,
      selectedAvatar: player.selectedAvatar,
      provider: session.user.provider as 'github' | 'discord' | 'local',
      hasPassword: !!player.passwordHash,
      tutorialCompleted: !!player.tutorialCompleted,
    },
  })

  return {
    user: {
      id: player.id,
      username: player.username,
      avatarUrl: player.avatarUrl,
      selectedAvatar: player.selectedAvatar,
      tutorialCompleted: !!player.tutorialCompleted,
    },
  }
})
