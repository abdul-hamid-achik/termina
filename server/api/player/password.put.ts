import { Effect } from 'effect'
import { getGameRuntime } from '../../plugins/game-server'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user?.id) {
    throw createError({ statusCode: 401, message: 'Authentication required' })
  }

  const body = await readBody<{
    currentPassword?: string
    newPassword?: string
  }>(event)

  const newPassword = body?.newPassword
  if (!newPassword || newPassword.length < 8) {
    throw createError({ statusCode: 400, message: 'New password must be at least 8 characters' })
  }

  const runtime = getGameRuntime()
  if (!runtime) {
    throw createError({ statusCode: 503, message: 'Game server not ready' })
  }

  const playerId = session.user.id as string

  const player = await Effect.runPromise(runtime.dbService.getPlayer(playerId))
  if (!player) {
    throw createError({ statusCode: 404, message: 'Player not found' })
  }

  // If player already has a password, verify current password
  if (player.passwordHash) {
    const currentPassword = body?.currentPassword
    if (!currentPassword) {
      throw createError({ statusCode: 400, message: 'Current password is required' })
    }

    // verifyPassword auto-imported from nuxt-auth-utils (hash first, then plain)
    const valid = await verifyPassword(player.passwordHash, currentPassword)
    if (!valid) {
      throw createError({ statusCode: 401, message: 'Current password is incorrect' })
    }
  }

  // Hash and save new password (hashPassword auto-imported from nuxt-auth-utils)
  const passwordHash = await hashPassword(newPassword)
  await Effect.runPromise(
    runtime.dbService.updatePlayerPassword(playerId, passwordHash),
  )

  // Update session to reflect that user now has a password
  await setUserSession(event, {
    user: {
      ...session.user,
      hasPassword: true,
    },
  })

  return { success: true }
})
