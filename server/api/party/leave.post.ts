import { getGameRuntime } from '~~/server/plugins/game-server'
import { leaveParty, getPartyByPlayer } from '~~/server/game/matchmaking/party'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user?.id) {
    throw createError({ statusCode: 401, message: 'Authentication required' })
  }
  const playerId = session.user.id as string

  if (!getGameRuntime()) {
    throw createError({ statusCode: 503, message: 'Game server not ready' })
  }

  leaveParty(playerId)
  return { success: true, party: getPartyByPlayer(playerId) ?? null }
})
