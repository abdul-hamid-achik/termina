import { getDevRawState } from '~~/server/plugins/game-server'

/**
 * Dev/test-only: raw GameState snapshot for spec assertions (engine-truth
 * cross-checks against the rendered DOM). Double-gated like the other hooks.
 *
 * Query: ?gameId=<id>  →  GameState JSON
 */
export default defineEventHandler((event) => {
  if (process.env.NODE_ENV === 'production' || process.env.TERMINA_TEST_HOOKS !== '1') {
    throw createError({ statusCode: 404, message: 'Not found' })
  }

  const gameId = getQuery(event).gameId
  if (typeof gameId !== 'string') {
    throw createError({ statusCode: 400, message: 'gameId query param required' })
  }

  const state = getDevRawState(gameId)
  if (!state) throw createError({ statusCode: 404, message: 'no such live game on this instance' })

  // surrenderVotes holds Sets (serialize to {}); harmless — specs read game data.
  return state
})
