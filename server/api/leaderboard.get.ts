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

  const query = getQuery(event)
  const limit = Math.min(Number(query.limit) || 100, 500)

  const players = await Effect.runPromise(runtime.dbService.getLeaderboard(limit))

  return {
    leaderboard: players.map((p, rank) => ({
      rank: rank + 1,
      id: p.id,
      username: p.username,
      avatarUrl: p.avatarUrl,
      mmr: p.mmr,
      gamesPlayed: p.gamesPlayed,
      wins: p.wins,
      winRate: p.gamesPlayed > 0 ? Math.round((p.wins / p.gamesPlayed) * 100) : 0,
    })),
  }
})
