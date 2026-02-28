import { Effect } from 'effect'
import { getGameRuntime } from '../../plugins/game-server'
import { joinQueue, getQueueSize } from '../../game/matchmaking/queue'
import { getPlayerGame } from '../../services/PeerRegistry'

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
  const mode = body?.mode ?? 'ranked_5v5'

  if (!['ranked_5v5', 'quick_3v3', '1v1'].includes(mode)) {
    throw createError({ statusCode: 400, message: 'Invalid game mode' })
  }

  const playerId = session.user.id as string

  // Prevent re-queuing if player is already in an active game
  const activeGameId = getPlayerGame(playerId)
  if (activeGameId) {
    throw createError({ statusCode: 409, message: 'Already in an active game' })
  }

  const player = await Effect.runPromise(runtime.dbService.getPlayer(playerId))

  await Effect.runPromise(
    joinQueue(runtime.redisService, {
      playerId,
      mmr: player?.mmr ?? 1000,
      joinedAt: Date.now(),
      mode,
    }),
  )

  const queueSize = await Effect.runPromise(getQueueSize(runtime.redisService))

  return { success: true, queueSize }
})
