import { createTutorialGame, getGameRuntime, stopDevGame } from '~~/server/plugins/game-server'
import { getPlayerGame, clearPlayerGame } from '~~/server/services/PeerRegistry'
import { checkScopedRateLimit } from '~~/server/utils/RateLimiter'

/**
 * Production: start a single-player tutorial game (the human + bots on the
 * one-lane map, in tutorial mode) and return the /play entry URL. This is a real
 * player feature, reachable in production — it is NOT gated by test hooks.
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

  // Don't strand the player in two games at once — but a previous PRACTICE game
  // must never become a permanent lockout. Clicking "practice" and closing the
  // tab before the WebSocket opens used to leave a dev_ game ticking with the
  // player mapped to it forever: the WS close handler that calls stopDevGame
  // never fired (no socket was ever opened), and the stale-game reaper skips it
  // because the loop IS still ticking. Every later attempt 409'd and the client
  // silently bounced to /lobby — indistinguishable from "the tutorial button is
  // broken". Practice is disposable, so replace it rather than refuse.
  const existing = getPlayerGame(humanId)
  if (existing) {
    if (existing.startsWith('dev_')) {
      stopDevGame(existing)
      clearPlayerGame(humanId)
    } else {
      throw createError({
        statusCode: 409,
        message: "You're already in a match — finish or leave it before starting practice",
      })
    }
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
