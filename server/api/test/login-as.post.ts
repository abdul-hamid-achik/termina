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
    // Dev-only diagnostic (this hook 404s in production): surface exactly what
    // the client sent so a CI-only rejection is debuggable from the server log
    // — e.g. an unresolved `${run.token}` placeholder leaking through literally.
    console.warn(
      `[test/login-as] 400 — username=${JSON.stringify(body?.username)} ` +
        `(type=${typeof body?.username}, bodyKeys=[${Object.keys(body ?? {}).join(',')}])`,
    )
    throw createError({ statusCode: 400, message: 'username must be 3-40 chars [A-Za-z0-9_]' })
  }

  // TEMP CI DIAGNOSTIC (dev-only; this hook 404s in prod): the e2e `login_as_dev`
  // step (an in-page POST to this route) hangs ONLY in CI and is not reproducible
  // locally. These brackets pinpoint whether the request reaches the server and, if
  // so, which await stalls (DB query vs hash vs session). Remove once root-caused.
  const t0 = Date.now()
  const mark = (m: string) => console.warn(`[test/login-as] ${m} (+${Date.now() - t0}ms)`)
  mark(`entry username=${username}`)

  const runtime = getGameRuntime()
  if (!runtime) throw createError({ statusCode: 503, message: 'Game server not ready' })
  mark('runtime ok → getPlayerByUsername')

  let player = await Effect.runPromise(runtime.dbService.getPlayerByUsername(username))
  mark(`getPlayerByUsername → ${player ? 'found' : 'null'}`)
  if (!player) {
    // hashPassword auto-imported from nuxt-auth-utils
    const passwordHash = await hashPassword(`dev_${username}_pw`)
    mark('hashPassword done → createLocalPlayer')
    player = await Effect.runPromise(runtime.dbService.createLocalPlayer(username, passwordHash))
    mark('createLocalPlayer done')
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
  mark('setUserSession done → return')

  return { playerId: player.id }
})
