import { Effect } from 'effect'
import { getGameRuntime } from '~~/server/plugins/game-server'
import { checkScopedRateLimit } from '~~/server/utils/RateLimiter'

export default defineEventHandler(async (event) => {
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
  if (!checkScopedRateLimit('publicRead', ip)) {
    throw createError({ statusCode: 429, message: 'Too many requests — try again shortly' })
  }

  const runtime = getGameRuntime()
  if (!runtime) {
    throw createError({ statusCode: 503, message: 'Game server not ready' })
  }

  const playerId = getRouterParam(event, 'id')
  if (!playerId) {
    throw createError({ statusCode: 400, message: 'Player ID required' })
  }

  const player = await Effect.runPromise(runtime.dbService.getPlayer(playerId))
  if (!player) {
    throw createError({ statusCode: 404, message: 'Player not found' })
  }

  // Per-hero record is public (W/L + KDA per hero) — powers the profile's
  // "most played heroes" panel.
  const heroStats = await Effect.runPromise(runtime.dbService.getHeroStats(playerId))

  // Resolve the player's guild (name + tag) so the profile can show it without a
  // second round-trip.
  const guild = player.guildId
    ? await Effect.runPromise(runtime.dbService.getGuild(player.guildId))
    : null

  // Don't expose sensitive fields
  const { email: _email, passwordHash: _passwordHash, ...publicProfile } = player
  return {
    player: publicProfile,
    heroStats,
    guild: guild ? { id: guild.id, name: guild.name, tag: guild.tag } : null,
  }
})
