import { createTutorialGame, getGameRuntime } from '~~/server/plugins/game-server'
import { getPlayerGame } from '~~/server/services/PeerRegistry'
import { checkScopedRateLimit } from '~~/server/utils/RateLimiter'

/**
 * Production: start a single-player tutorial game (the human + bots on the
 * one-lane map, in tutorial mode) and return the /play entry URL. This is a real
 * player feature — NOT gated by test hooks, unlike /api/test/new-game.
 *
 * Body: { heroSelf? }  →  { gameId, playerId, url }
 */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  const humanId = session?.user?.id as string | undefined
  if (!humanId) {
    throw createError({ statusCode: 401, message: 'Sign in to start the tutorial' })
  }

  if (!checkScopedRateLimit('tutorial', humanId)) {
    throw createError({ statusCode: 429, message: 'Too many tutorial requests — slow down' })
  }

  if (!getGameRuntime()) {
    throw createError({ statusCode: 503, message: 'Game server not ready' })
  }

  // Don't strand the player in two games at once.
  if (getPlayerGame(humanId)) {
    throw createError({ statusCode: 409, message: 'Already in an active game' })
  }

  const body = await readBody<{ heroSelf?: string }>(event).catch(
    () => ({}) as { heroSelf?: string },
  )
  const created = await createTutorialGame({ humanId, humanHeroId: body?.heroSelf })
  if (!created) {
    throw createError({ statusCode: 503, message: 'Could not start tutorial game' })
  }

  return {
    gameId: created.gameId,
    playerId: humanId,
    url: `/play?gameId=${encodeURIComponent(created.gameId)}&playerId=${encodeURIComponent(humanId)}&tutorial=1`,
  }
})
