import { Effect } from 'effect'
import { getGameRuntime } from '../../plugins/game-server'
import { leaveQueue } from '../../game/matchmaking/queue'

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
  const player = await Effect.runPromise(runtime.dbService.getPlayer(playerId))

  await Effect.runPromise(leaveQueue(runtime.redisService, playerId, player?.mmr ?? 1000))

  return { success: true }
})
