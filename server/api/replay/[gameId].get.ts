import { Effect } from 'effect'
import { getGameRuntime } from '~~/server/plugins/game-server'
import { readSnapshot } from '~~/server/game/engine/StateSnapshot'
import { readActions } from '~~/server/game/engine/ActionLog'

/**
 * Return the snapshot + persisted action log for a game so a client-side
 * replay player can rehydrate it and step through ticks.
 *
 * Sets in GameState (surrenderVotes) are converted back to arrays for JSON
 * transport — the replay UI will reconstruct them when needed.
 */
export default defineEventHandler(async (event) => {
  const runtime = getGameRuntime()
  if (!runtime) {
    throw createError({ statusCode: 503, message: 'Game server not ready' })
  }

  const gameId = getRouterParam(event, 'gameId')
  if (!gameId) {
    throw createError({ statusCode: 400, message: 'Game ID required' })
  }

  // readSnapshot/readActions are best-effort — they swallow Redis failures
  // and return null/[] respectively. So a 404 here means the game truly has
  // no snapshot, not that Redis is unreachable.
  const snap = await Effect.runPromise(readSnapshot(runtime.redisService, gameId))
  if (!snap) {
    throw createError({ statusCode: 404, message: 'Replay not found' })
  }

  const actions = await Effect.runPromise(readActions(runtime.redisService, gameId))

  return {
    gameId,
    savedAt: snap.savedAt,
    state: {
      ...snap.state,
      // Sets aren't JSON-serializable; convert for transport
      surrenderVotes: {
        radiant: [...snap.state.surrenderVotes.radiant],
        dire: [...snap.state.surrenderVotes.dire],
      },
    },
    meta: snap.meta,
    actions,
  }
})
