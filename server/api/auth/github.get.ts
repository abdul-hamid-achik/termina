import { Effect } from 'effect'
import { getGameRuntime } from '../../plugins/game-server'

export default defineOAuthGitHubEventHandler({
  config: {
    emailRequired: true,
  },
  async onSuccess(event, { user, tokens }) {
    const runtime = getGameRuntime()
    if (!runtime) {
      throw createError({ statusCode: 503, message: 'Game server not ready' })
    }

    const playerId = `github_${user.id}`

    const existing = await Effect.runPromise(
      runtime.dbService.getPlayerByProvider('github', String(user.id)),
    )

    let player = existing
    if (!player) {
      player = await Effect.runPromise(
        runtime.dbService.createPlayer({
          id: playerId,
          username: user.login,
          email: user.email ?? null,
          avatarUrl: user.avatar_url ?? null,
          provider: 'github',
          providerId: String(user.id),
        }),
      )
    }

    await setUserSession(event, {
      user: {
        id: player.id,
        username: player.username,
        avatarUrl: player.avatarUrl,
        provider: 'github',
      },
    })

    return sendRedirect(event, '/')
  },
  onError(event, error) {
    console.error('[Auth] GitHub OAuth error:', error)
    return sendRedirect(event, '/login?error=github')
  },
})
