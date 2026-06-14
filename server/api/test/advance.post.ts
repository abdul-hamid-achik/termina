import { advanceDevGame, getDevRawState } from '~~/server/plugins/game-server'
import { testHooksEnabled } from '~~/server/utils/testHooks'

/**
 * Dev/test-only: advance a manual-tick dev game by N ticks deterministically
 * (no wall-clock wait). The game must have been created with manualTick: true.
 * Double-gated like the other hooks.
 *
 * Body: { gameId, ticks }  →  { advanced, tick }
 */
export default defineEventHandler(async (event) => {
  if (!testHooksEnabled()) {
    throw createError({ statusCode: 404, message: 'Not found' })
  }

  const body = await readBody<{ gameId?: string; ticks?: number }>(event).catch(
    () => ({}) as { gameId?: string; ticks?: number },
  )
  const gameId = body?.gameId
  const ticks = body?.ticks ?? 1
  if (typeof gameId !== 'string' || typeof ticks !== 'number') {
    throw createError({ statusCode: 400, message: 'Expected { gameId: string, ticks: number }' })
  }

  const advanced = await advanceDevGame(gameId, ticks)
  return { advanced, tick: getDevRawState(gameId)?.tick ?? null }
})
