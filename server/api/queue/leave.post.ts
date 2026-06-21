import { Effect } from 'effect'
import { getGameRuntime } from '~~/server/plugins/game-server'
import { leaveQueue, type QueueMode } from '~~/server/game/matchmaking/queue'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user?.id) {
    throw createError({ statusCode: 401, message: 'Authentication required' })
  }

  const runtime = getGameRuntime()
  if (!runtime) {
    throw createError({ statusCode: 503, message: 'Game server not ready' })
  }

  const body = await readBody(event).catch(() => ({}))
  const mode = (body?.mode ?? 'ranked_5v5') as QueueMode

  if (!['ranked_5v5', 'quick_3v3', '1v1'].includes(mode)) {
    throw createError({ statusCode: 400, message: 'Invalid game mode' })
  }

  const playerId = session.user.id as string

  await Effect.runPromise(leaveQueue(runtime.redisService, playerId, mode))

  return { success: true }
})
