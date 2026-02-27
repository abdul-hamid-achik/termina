import { Effect } from 'effect'
import { getGameRuntime } from '../../plugins/game-server'

export default defineEventHandler(async (event) => {
  const runtime = getGameRuntime()
  if (!runtime) {
    throw createError({ statusCode: 503, message: 'Game server not ready' })
  }

  const matchId = getRouterParam(event, 'id')
  if (!matchId) {
    throw createError({ statusCode: 400, message: 'Match ID required' })
  }

  const match = await Effect.runPromise(runtime.dbService.getMatch(matchId))
  if (!match) {
    throw createError({ statusCode: 404, message: 'Match not found' })
  }

  return { match }
})
