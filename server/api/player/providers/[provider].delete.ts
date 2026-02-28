import { Effect } from 'effect'
import { getGameRuntime } from '../../../plugins/game-server'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user?.id) {
    throw createError({ statusCode: 401, message: 'Authentication required' })
  }

  const provider = getRouterParam(event, 'provider')
  if (!provider || !['github', 'discord'].includes(provider)) {
    throw createError({ statusCode: 400, message: 'Invalid provider' })
  }

  const runtime = getGameRuntime()
  if (!runtime) {
    throw createError({ statusCode: 503, message: 'Game server not ready' })
  }

  const playerId = session.user.id as string

  // Safety check: cannot unlink if it's the only auth method and no password
  const [providers, player] = await Promise.all([
    Effect.runPromise(runtime.dbService.getPlayerProviders(playerId)),
    Effect.runPromise(runtime.dbService.getPlayer(playerId)),
  ])

  if (!player) {
    throw createError({ statusCode: 404, message: 'Player not found' })
  }

  const hasPassword = !!player.passwordHash
  const remainingProviders = providers.filter((p) => p.provider !== provider)

  if (remainingProviders.length === 0 && !hasPassword) {
    throw createError({
      statusCode: 400,
      message: 'Cannot disconnect your only login method. Set a password first.',
    })
  }

  await Effect.runPromise(
    runtime.dbService.unlinkProvider(playerId, provider),
  )

  return { success: true }
})
