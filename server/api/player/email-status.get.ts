import { Effect } from 'effect'
import { getGameRuntime } from '~~/server/plugins/game-server'

// The current user's email + verification state, for the settings "Email" panel.
// (The session cookie intentionally doesn't carry the email — it's read fresh
// here so a just-verified address reflects immediately.)
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  const userId = session?.user?.id as string | undefined
  if (!userId) {
    throw createError({ statusCode: 401, message: 'Authentication required' })
  }

  const runtime = getGameRuntime()
  if (!runtime) {
    throw createError({ statusCode: 503, message: 'Game server not ready' })
  }

  const player = await Effect.runPromise(runtime.dbService.getPlayer(userId))
  return { email: player?.email ?? null, verified: !!player?.emailVerifiedAt }
})
