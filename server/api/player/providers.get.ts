import { Effect } from 'effect'
import { getGameRuntime } from '../../plugins/game-server'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user?.id) {
    throw createError({ statusCode: 401, message: 'Authentication required' })
  }

  const runtime = getGameRuntime()
  if (!runtime) {
    throw createError({ statusCode: 503, message: 'Game server not ready' })
  }

  const playerId = session.user.id as string

  const providers = await Effect.runPromise(
    runtime.dbService.getPlayerProviders(playerId),
  )

  return providers.map((p) => ({
    provider: p.provider,
    providerId: p.providerId,
    providerUsername: p.providerUsername,
    linkedAt: p.linkedAt,
  }))
})
