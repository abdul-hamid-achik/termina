import { getGameRuntime } from '../../plugins/game-server'
import { pickHero } from '../../game/matchmaking/lobby'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user?.id) {
    throw createError({ statusCode: 401, message: 'Authentication required' })
  }

  const runtime = getGameRuntime()
  if (!runtime) {
    throw createError({ statusCode: 503, message: 'Game server not ready' })
  }

  const body = await readBody(event)
  const { lobbyId, heroId } = body ?? {}

  if (!lobbyId || !heroId) {
    throw createError({ statusCode: 400, message: 'Missing lobbyId or heroId' })
  }

  const playerId = session.user.id as string
  const result = pickHero(
    lobbyId,
    playerId,
    heroId,
    runtime.wsService,
    runtime.redisService,
    runtime.dbService,
  )

  if (!result.success) {
    throw createError({ statusCode: 400, message: result.error ?? 'Pick failed' })
  }

  return { success: true }
})
