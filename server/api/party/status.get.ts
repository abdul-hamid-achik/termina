import { getGameRuntime } from '~~/server/plugins/game-server'
import { getPartyByPlayer } from '~~/server/game/matchmaking/party'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user?.id) {
    throw createError({ statusCode: 401, message: 'Authentication required' })
  }

  if (!getGameRuntime()) {
    throw createError({ statusCode: 503, message: 'Game server not ready' })
  }

  return { party: getPartyByPlayer(session.user.id as string) ?? null }
})
