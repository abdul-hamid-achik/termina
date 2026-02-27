import { Effect } from 'effect'
import { getGameRuntime } from '../../plugins/game-server'

export default defineEventHandler(async (event) => {
  const runtime = getGameRuntime()
  if (!runtime) {
    throw createError({ statusCode: 503, message: 'Game server not ready' })
  }

  const playerId = getRouterParam(event, 'id')
  if (!playerId) {
    throw createError({ statusCode: 400, message: 'Player ID required' })
  }

  const player = await Effect.runPromise(runtime.dbService.getPlayer(playerId))
  if (!player) {
    throw createError({ statusCode: 404, message: 'Player not found' })
  }

  // Don't expose email
  const { email, ...publicProfile } = player
  return { player: publicProfile }
})
