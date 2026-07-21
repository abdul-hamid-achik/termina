import { Effect } from 'effect'
import { getGameRuntime } from '~~/server/plugins/game-server'
import { checkScopedRateLimit } from '~~/server/utils/RateLimiter'
import { getRankTier } from '~~/shared/constants/ranks'

export default defineEventHandler(async (event) => {
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
  if (!checkScopedRateLimit('publicRead', ip)) {
    throw createError({ statusCode: 429, message: 'Too many requests — try again shortly' })
  }

  const runtime = getGameRuntime()
  if (!runtime) {
    throw createError({ statusCode: 503, message: 'Game server not ready' })
  }

  const query = getQuery(event)
  const limit = Math.min(Number(query.limit) || 100, 500)

  // The competitive ladder is the seasonal rating (resettable); rank tiers are
  // derived from it. Lifetime mmr is included for reference.
  const [players, season] = await Promise.all([
    Effect.runPromise(runtime.dbService.getSeasonLeaderboard(limit)),
    Effect.runPromise(runtime.dbService.getCurrentSeason()),
  ])

  // Batch-resolve guild tags for the listed players (one query, not N).
  const guildIds = [...new Set(players.map((p) => p.guildId).filter((g): g is string => !!g))]
  const playerGuilds = await Effect.runPromise(runtime.dbService.getGuildsByIds(guildIds))
  const tagByGuild = new Map(playerGuilds.map((g) => [g.id, g.tag]))

  return {
    season: { number: season.seasonNumber, startedAt: season.startedAt },
    leaderboard: players.map((p, rank) => {
      const tier = getRankTier(p.seasonMmr)
      return {
        rank: rank + 1,
        id: p.id,
        username: p.username,
        avatarUrl: p.avatarUrl,
        guildTag: p.guildId ? (tagByGuild.get(p.guildId) ?? null) : null,
        mmr: p.seasonMmr,
        lifetimeMmr: p.mmr,
        rankTier: tier.id,
        rankName: tier.name,
        gamesPlayed: p.seasonGamesPlayed,
        wins: p.seasonWins,
        winRate:
          p.seasonGamesPlayed > 0 ? Math.round((p.seasonWins / p.seasonGamesPlayed) * 100) : 0,
      }
    }),
  }
})
