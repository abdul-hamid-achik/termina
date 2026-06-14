import { createDevGame } from '../../plugins/game-server'

/**
 * Dev/test-only: create a real game directly (no matchmaking) with the session
 * user as the human player, and return the /play entry URL. Double-gated like
 * server/api/test/force-end.post.ts.
 *
 * Body: { scenario?, heroSelf?, seed? }  →  { gameId, playerId, url }
 */
export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production' || process.env.TERMINA_TEST_HOOKS !== '1') {
    throw createError({ statusCode: 404, message: 'Not found' })
  }

  const session = await getUserSession(event)
  const humanId = session?.user?.id as string | undefined
  if (!humanId) throw createError({ statusCode: 401, message: 'call /api/test/login-as first' })

  const body = await readBody<{
    scenario?: string
    heroSelf?: string
    seed?: number
    manualTick?: boolean | string
  }>(event).catch(() => ({}) as Record<string, never>)

  const created = await createDevGame({
    humanId,
    humanHeroId: body?.heroSelf,
    seed: body?.seed,
    scenario: body?.scenario,
    // accept a real boolean or the string "true" (config-var substitution yields strings)
    manualTick: body?.manualTick === true || body?.manualTick === 'true',
  })
  if (!created) throw createError({ statusCode: 409, message: 'could not create dev game' })

  return {
    gameId: created.gameId,
    playerId: humanId,
    url: `/play?gameId=${encodeURIComponent(created.gameId)}&playerId=${encodeURIComponent(humanId)}&dev=1`,
  }
})
