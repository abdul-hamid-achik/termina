import { getGameRuntime } from '~~/server/plugins/game-server'
import { getPartyByPlayer, disbandParty } from '~~/server/game/matchmaking/party'
import { createCoopLobby } from '~~/server/game/matchmaking/lobby'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user?.id) {
    throw createError({ statusCode: 401, message: 'Authentication required' })
  }
  const playerId = session.user.id as string

  const runtime = getGameRuntime()
  if (!runtime) {
    throw createError({ statusCode: 503, message: 'Game server not ready' })
  }

  const party = getPartyByPlayer(playerId)
  if (!party) {
    throw createError({ statusCode: 400, message: 'You are not in a party' })
  }
  if (party.leaderId !== playerId) {
    throw createError({ statusCode: 403, message: 'Only the party leader can start the game' })
  }

  // Build a co-op lobby: party on chaff, bots fill to a 5v5. The party is
  // disbanded once the lobby exists (its members are now in the lobby).
  const lobby = createCoopLobby(
    party.members.map((m) => ({ playerId: m.playerId, username: m.username, mmr: m.mmr })),
    runtime.wsService,
    runtime.redisService,
    runtime.dbService,
  )
  disbandParty(party.code)

  return { success: true, lobbyId: lobby.id }
})
