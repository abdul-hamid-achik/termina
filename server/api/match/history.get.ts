import { Effect } from 'effect'
import { getGameRuntime } from '../../plugins/game-server'

export default defineEventHandler(async (event) => {
  const runtime = getGameRuntime()
  if (!runtime) {
    throw createError({ statusCode: 503, message: 'Game server not ready' })
  }

  const query = getQuery(event)
  const playerId = query.player as string | undefined
  const limit = Math.min(Number(query.limit) || 20, 100)

  if (!playerId) {
    // Fall back to authenticated user
    const session = await getUserSession(event)
    if (!session?.user?.id) {
      throw createError({ statusCode: 401, message: 'Player ID required' })
    }
    const matches = await Effect.runPromise(
      runtime.dbService.getMatchHistory(session.user.id, limit),
    )
    return { matches }
  }

  const matches = await Effect.runPromise(runtime.dbService.getMatchHistory(playerId, limit))
  return { matches }
})
