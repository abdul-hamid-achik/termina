import { Effect } from 'effect'
import { getGameRuntime } from '../../plugins/game-server'
import { getQueueSize } from '../../game/matchmaking/queue'

export default defineEventHandler(async () => {
  const runtime = getGameRuntime()
  if (!runtime) {
    throw createError({ statusCode: 503, message: 'Game server not ready' })
  }

  const size = await Effect.runPromise(getQueueSize(runtime.redisService))

  return {
    playersInQueue: size,
    estimatedWaitSeconds: Math.max(10, size * 3),
  }
})
