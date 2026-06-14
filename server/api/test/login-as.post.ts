import { Effect } from 'effect'
import { getGameRuntime } from '~~/server/plugins/game-server'

/**
 * Dev/test-only: mint a session for a (find-or-create) local user — the
 * idempotent, OAuth-free login the BDD/e2e harness uses. Double-gated like
 * server/api/test/force-end.post.ts; 404 in production or without the opt-in.
 *
 * Body: { username }  →  { playerId }
 */
export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production' || process.env.TERMINA_TEST_HOOKS !== '1') {
    throw createError({ statusCode: 404, message: 'Not found' })
  }

  const body = await readBody<{ username?: string }>(event).catch(
    () => ({}) as { username?: string },
  )
  const username = body?.username?.trim()
  // Dev-only: allow up to 40 chars so per-run identities like
  // `cairn_${run.token}` (cairntrace v1.9 runtime placeholder, ~21 chars) fit.
  // Prod auth is unaffected — this hook 404s outside the double-gate above.
  if (!username || !/^\w{3,40}$/.test(username)) {
    throw createError({ statusCode: 400, message: 'username must be 3-40 chars [A-Za-z0-9_]' })
  }

  const runtime = getGameRuntime()
  if (!runtime) throw createError({ statusCode: 503, message: 'Game server not ready' })

  let player = await Effect.runPromise(runtime.dbService.getPlayerByUsername(username))
  if (!player) {
    // hashPassword auto-imported from nuxt-auth-utils
    const passwordHash = await hashPassword(`dev_${username}_pw`)
    player = await Effect.runPromise(runtime.dbService.createLocalPlayer(username, passwordHash))
  }

  await setUserSession(event, {
    user: {
      id: player.id,
      username: player.username,
      avatarUrl: player.avatarUrl,
      selectedAvatar: player.selectedAvatar,
      provider: 'local',
      hasPassword: true,
    },
  })

  return { playerId: player.id }
})
