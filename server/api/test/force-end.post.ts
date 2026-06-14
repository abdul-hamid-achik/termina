import { forceEndGame } from '../../plugins/game-server'
import type { TeamId } from '~~/shared/types/game'

/**
 * Test-only endpoint: force a live game to end with a given winner so the
 * post-game screen appears near-instantly in e2e specs (instead of playing a
 * full bot match to an Ancient kill, which takes minutes and is flaky).
 *
 * Double-gated: only mounted-effective when NOT production AND the explicit
 * TERMINA_TEST_HOOKS=1 opt-in is set (the e2e test server runs with it — see
 * tests/e2e/README.md). Any other environment returns 404 so the route is invisible.
 *
 * Body: { gameId: string, winner: 'radiant' | 'dire' }
 * Response: { ended: boolean } — false if the game isn't live on this instance.
 */
export default defineEventHandler(async (event) => {
  const hooksEnabled =
    process.env.NODE_ENV !== 'production' && process.env.TERMINA_TEST_HOOKS === '1'
  if (!hooksEnabled) {
    throw createError({ statusCode: 404, message: 'Not found' })
  }

  const body = await readBody(event).catch(() => ({}) as Record<string, unknown>)
  const gameId = body?.gameId
  const winner = body?.winner

  if (typeof gameId !== 'string' || (winner !== 'radiant' && winner !== 'dire')) {
    throw createError({
      statusCode: 400,
      message: 'Expected { gameId: string, winner: "radiant" | "dire" }',
    })
  }

  const ended = forceEndGame(gameId, winner as TeamId)
  return { ended }
})
