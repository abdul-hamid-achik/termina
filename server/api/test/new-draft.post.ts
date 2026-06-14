import { seedDraftLobby } from '~~/server/game/matchmaking/lobby'
import { testHooksEnabled } from '~~/server/utils/testHooks'

/**
 * Dev/test-only: seed a hero-draft lobby directly (no live matchmaking), frozen
 * at the session user's pick turn. The pre-game analogue of new-game.post.ts —
 * double-gated like the other test hooks; 404 in production or without the opt-in.
 *
 * Body: { prepick? }  — bots that pick before the human (default 9 ⇒ human picks
 * last, so one confirm completes the draft and starts the game).
 * Response: { lobbyId, playerId, team, currentPickIndex, url }  — open `url`
 * (/lobby); the client recovers the draft on connect and shows the hero picker.
 */
export default defineEventHandler(async (event) => {
  if (!testHooksEnabled()) {
    throw createError({ statusCode: 404, message: 'Not found' })
  }

  const session = await getUserSession(event)
  const humanId = session?.user?.id as string | undefined
  if (!humanId) throw createError({ statusCode: 401, message: 'call /api/test/login-as first' })
  const humanUsername = (session?.user?.username as string | undefined) ?? humanId

  const body = await readBody<{ prepick?: number | string }>(event).catch(
    () => ({}) as { prepick?: number | string },
  )
  // Accept a real number or a stringified one (config-var substitution yields strings).
  const prepick = body?.prepick === undefined ? 9 : Number(body.prepick)
  if (!Number.isFinite(prepick)) {
    throw createError({ statusCode: 400, message: 'prepick must be a number 0-9' })
  }

  const lobby = seedDraftLobby({ humanId, humanUsername, prepick })
  const human = lobby.players.find((p) => p.playerId === humanId)

  return {
    lobbyId: lobby.id,
    playerId: humanId,
    team: human?.team ?? 'radiant',
    currentPickIndex: lobby.currentPickIndex,
    url: '/lobby',
  }
})
