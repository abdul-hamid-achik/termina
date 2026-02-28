import { Effect } from 'effect'
import { getGameRuntime } from '../../plugins/game-server'
import { authLog } from '../../utils/log'

export default defineOAuthDiscordEventHandler({
  async onSuccess(event, { user, tokens: _tokens }) {
    const runtime = getGameRuntime()
    if (!runtime) {
      throw createError({ statusCode: 503, message: 'Game server not ready' })
    }

    const playerId = `discord_${user.id}`

    const existing = await Effect.runPromise(
      runtime.dbService.getPlayerByProvider('discord', String(user.id)),
    )

    let player = existing
    if (!player) {
      const avatarHash = user.avatar
      const avatarUrl = avatarHash
        ? `https://cdn.discordapp.com/avatars/${user.id}/${avatarHash}.png`
        : null

      player = await Effect.runPromise(
        runtime.dbService.createPlayer({
          id: playerId,
          username: user.username ?? user.global_name ?? `discord_${user.id}`,
          email: user.email ?? null,
          avatarUrl,
          provider: 'discord',
          providerId: String(user.id),
        }),
      )
    }

    // Ensure provider is linked in playerProviders table
    try {
      const discordAvatar = user.avatar
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
        : null
      await Effect.runPromise(
        runtime.dbService.linkProvider(
          player.id,
          'discord',
          String(user.id),
          user.username ?? user.global_name ?? null,
          discordAvatar,
        ),
      )
    } catch {
      // Already linked — ignore duplicate
    }

    await setUserSession(event, {
      user: {
        id: player.id,
        username: player.username,
        avatarUrl: player.avatarUrl,
        selectedAvatar: player.selectedAvatar,
        provider: 'discord',
        hasPassword: !!player.passwordHash,
      },
    })

    return sendRedirect(event, '/')
  },
  onError(event, error) {
    authLog.error('Discord OAuth error', error)
    return sendRedirect(event, '/login?error=discord')
  },
})
