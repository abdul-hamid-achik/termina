import { Effect } from 'effect'
import { getGameRuntime } from '../../plugins/game-server'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user?.id) {
    throw createError({ statusCode: 401, message: 'Authentication required' })
  }

  const runtime = getGameRuntime()
  if (!runtime) {
    throw createError({ statusCode: 503, message: 'Game server not ready' })
  }

  const playerId = session.user.id as string

  const [player, heroStatsData, recentMatches] = await Promise.all([
    Effect.runPromise(runtime.dbService.getPlayer(playerId)),
    Effect.runPromise(runtime.dbService.getHeroStats(playerId)),
    Effect.runPromise(runtime.dbService.getMatchHistory(playerId, 10)),
  ])

  if (!player) {
    throw createError({ statusCode: 404, message: 'Player not found' })
  }

  return {
    player: {
      id: player.id,
      username: player.username,
      avatarUrl: player.avatarUrl,
      mmr: player.mmr,
      gamesPlayed: player.gamesPlayed,
      wins: player.wins,
      losses: player.gamesPlayed - player.wins,
      winRate: player.gamesPlayed > 0 ? (player.wins / player.gamesPlayed) * 100 : 0,
    },
    heroStats: heroStatsData,
    recentMatches,
  }
})
