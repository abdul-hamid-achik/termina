import { submitAction } from '~~/server/game/engine/GameLoop'
import { getDevRawState } from '~~/server/plugins/game-server'
import { testHooksEnabled } from '~~/server/utils/testHooks'
import type { Command } from '~~/shared/types/commands'

/**
 * Dev/test-only: queue a single player action on a dev game, bypassing the
 * client's canAct/tick buffer so a spec can drive a deterministic
 * action → /api/test/advance → /api/test/state assertion (the path the live UI
 * makes fragile). The action is validated/resolved by processTick on the next
 * advance, exactly like a real action. Double-gated like the other hooks.
 *
 * Body: { gameId, playerId?, command }  →  { queued, tick }
 *   - playerId defaults to the session user (the seeded human).
 *   - command is a structured Command, e.g. { type: 'buy', item: 'iron_branch' }
 *     or { type: 'cast', ability: 'w' } or
 *     { type: 'attack', target: { kind: 'hero', name: '<id>' } }.
 */
export default defineEventHandler(async (event) => {
  if (!testHooksEnabled()) {
    throw createError({ statusCode: 404, message: 'Not found' })
  }

  const body = await readBody<{ gameId?: string; playerId?: string; command?: Command }>(
    event,
  ).catch(() => ({}) as { gameId?: string; playerId?: string; command?: Command })

  const gameId = body?.gameId
  const command = body?.command
  if (typeof gameId !== 'string' || !command || typeof command.type !== 'string') {
    throw createError({
      statusCode: 400,
      message: 'Expected { gameId: string, command: { type, ... } }',
    })
  }

  // playerId defaults to the seeded human (the session user) like new-game does.
  let playerId = body?.playerId
  if (!playerId) {
    const session = await getUserSession(event)
    playerId = session?.user?.id as string | undefined
  }
  if (!playerId) {
    throw createError({
      statusCode: 400,
      message: 'No playerId (pass one, or call /api/test/login-as first)',
    })
  }

  submitAction(gameId, playerId, command)
  return { queued: true, tick: getDevRawState(gameId)?.tick ?? null }
})
