import { desc } from 'drizzle-orm'
import { requireAdmin } from '~~/server/utils/admin'
import { useDb } from '~~/server/db'
import { liveGames, queueEntries, matches } from '~~/server/db/schema'
import { isBot } from '~~/server/game/ai/BotManager'

/**
 * Operator panel snapshot: every live game (with tick staleness, so a
 * wedged workflow is visible at a glance), the matchmaking queue, and the
 * last few finished matches. Polled by /admin every few seconds.
 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = useDb()

  const [games, queue, recent] = await Promise.all([
    db
      .select({
        gameId: liveGames.gameId,
        cycle: liveGames.cycle,
        mode: liveGames.mode,
        mapId: liveGames.mapId,
        roster: liveGames.roster,
        updatedAt: liveGames.updatedAt,
      })
      .from(liveGames),
    db.select().from(queueEntries),
    db
      .select({
        id: matches.id,
        mode: matches.mode,
        winner: matches.winner,
        durationCycles: matches.durationCycles,
        endedAt: matches.endedAt,
      })
      .from(matches)
      .orderBy(desc(matches.endedAt))
      .limit(10),
  ])

  const now = Date.now()
  return {
    games: games.map((g) => ({
      gameId: g.gameId,
      mode: g.mode,
      mapId: g.mapId,
      cycle: g.cycle,
      updatedAt: g.updatedAt.toISOString(),
      /** ms since the last committed tick — >8000 means the 4s clock is
       *  stalled (wedged run, crashed step, or a game the workflow lost). */
      stalledMs: now - g.updatedAt.getTime(),
      humans: g.roster.players.filter((p) => !isBot(p.playerId)).map((p) => p.playerId),
      botCount: g.roster.players.filter((p) => isBot(p.playerId)).length,
    })),
    queue: queue.map((q) => ({
      playerId: q.playerId,
      username: q.username,
      mode: q.mode,
      mmr: q.mmr,
      joinedAt: q.joinedAt.toISOString(),
    })),
    recentMatches: recent.map((m) => ({
      id: m.id,
      mode: m.mode,
      winner: m.winner,
      durationCycles: m.durationCycles,
      endedAt: m.endedAt?.toISOString() ?? null,
    })),
  }
})
