import { Effect } from 'effect'
import { getGameRuntime } from '~~/server/plugins/game-server'
import { createParty } from '~~/server/game/matchmaking/party'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user?.id) {
    throw createError({ statusCode: 401, message: 'Authentication required' })
  }
  const playerId = session.user.id as string
  const username = (session.user.username ?? playerId) as string

  const runtime = getGameRuntime()
  if (!runtime) {
    throw createError({ statusCode: 503, message: 'Game server not ready' })
  }

  const player = await Effect.runPromise(runtime.dbService.getPlayer(playerId))
  const party = createParty({ playerId, username, mmr: player?.mmr ?? 1000 })

  return { party }
})
