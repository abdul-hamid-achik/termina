import { Context, Effect, Layer } from 'effect'
import { eq, desc } from 'drizzle-orm'
import { useDb } from '../db'
import {
  players,
  matches,
  matchPlayers,
  heroStats,
  type Player,
  type NewPlayer,
  type Match,
  type NewMatch,
  type NewMatchPlayer,
  type HeroStat,
  type MatchPlayer,
} from '../db/schema'

export interface MatchWithPlayers extends Match {
  players: (MatchPlayer & { player: Player })[]
}

export interface HeroStatUpdate {
  won: boolean
  kills: number
  deaths: number
  assists: number
}

export interface DatabaseServiceApi {
  readonly getPlayer: (id: string) => Effect.Effect<Player | null>
  readonly getPlayerByProvider: (provider: string, providerId: string) => Effect.Effect<Player | null>
  readonly createPlayer: (data: NewPlayer) => Effect.Effect<Player>
  readonly updatePlayerMMR: (id: string, mmr: number) => Effect.Effect<void>
  readonly recordMatch: (match: NewMatch, players: NewMatchPlayer[]) => Effect.Effect<string>
  readonly getMatchHistory: (playerId: string, limit?: number) => Effect.Effect<Match[]>
  readonly getMatch: (id: string) => Effect.Effect<MatchWithPlayers | null>
  readonly getLeaderboard: (limit?: number) => Effect.Effect<Player[]>
  readonly updateHeroStats: (playerId: string, heroId: string, stats: HeroStatUpdate) => Effect.Effect<void>
  readonly getHeroStats: (playerId: string) => Effect.Effect<HeroStat[]>
  readonly incrementGamesPlayed: (playerId: string) => Effect.Effect<void>
  readonly incrementWins: (playerId: string) => Effect.Effect<void>
}

export class DatabaseService extends Context.Tag('DatabaseService')<DatabaseService, DatabaseServiceApi>() {}

export const DatabaseServiceLive = Layer.succeed(DatabaseService, {
  getPlayer: (id) =>
    Effect.promise(async () => {
      const db = useDb()
      const result = await db.select().from(players).where(eq(players.id, id)).limit(1)
      return result[0] ?? null
    }),

  getPlayerByProvider: (provider, providerId) =>
    Effect.promise(async () => {
      const db = useDb()
      const result = await db
        .select()
        .from(players)
        .where(eq(players.providerId, providerId))
        .limit(1)
      return result.find((p) => p.provider === provider) ?? null
    }),

  createPlayer: (data) =>
    Effect.promise(async () => {
      const db = useDb()
      const result = await db.insert(players).values(data).returning()
      return result[0]!
    }),

  updatePlayerMMR: (id, mmr) =>
    Effect.promise(async () => {
      const db = useDb()
      await db.update(players).set({ mmr }).where(eq(players.id, id))
    }),

  recordMatch: (match, matchPlayerData) =>
    Effect.promise(async () => {
      const db = useDb()
      await db.insert(matches).values(match)
      if (matchPlayerData.length > 0) {
        await db.insert(matchPlayers).values(matchPlayerData)
      }
      return match.id
    }),

  getMatchHistory: (playerId, limit = 20) =>
    Effect.promise(async () => {
      const db = useDb()
      const playerMatches = await db
        .select({ matchId: matchPlayers.matchId })
        .from(matchPlayers)
        .where(eq(matchPlayers.playerId, playerId))
        .limit(limit)

      if (playerMatches.length === 0) return []

      const matchIds = playerMatches.map((m) => m.matchId)
      const result = await db
        .select()
        .from(matches)
        .where(eq(matches.id, matchIds[0]!))
        .orderBy(desc(matches.createdAt))

      // Fetch all matches for the IDs
      const allMatches: Match[] = []
      for (const mid of matchIds) {
        const m = await db.select().from(matches).where(eq(matches.id, mid)).limit(1)
        if (m[0]) allMatches.push(m[0])
      }
      return allMatches.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    }),

  getMatch: (id) =>
    Effect.promise(async () => {
      const db = useDb()
      const matchResult = await db.select().from(matches).where(eq(matches.id, id)).limit(1)
      const match = matchResult[0]
      if (!match) return null

      const mpRows = await db
        .select()
        .from(matchPlayers)
        .where(eq(matchPlayers.matchId, id))

      const playersInMatch = await Promise.all(
        mpRows.map(async (mp) => {
          const pResult = await db
            .select()
            .from(players)
            .where(eq(players.id, mp.playerId))
            .limit(1)
          return { ...mp, player: pResult[0]! }
        }),
      )

      return { ...match, players: playersInMatch }
    }),

  getLeaderboard: (limit = 100) =>
    Effect.promise(async () => {
      const db = useDb()
      return db.select().from(players).orderBy(desc(players.mmr)).limit(limit)
    }),

  updateHeroStats: (playerId, heroId, stats) =>
    Effect.promise(async () => {
      const db = useDb()
      const existing = await db
        .select()
        .from(heroStats)
        .where(eq(heroStats.playerId, playerId))

      const stat = existing.find((s) => s.heroId === heroId)

      if (stat) {
        await db
          .update(heroStats)
          .set({
            gamesPlayed: stat.gamesPlayed + 1,
            wins: stat.wins + (stats.won ? 1 : 0),
            totalKills: stat.totalKills + stats.kills,
            totalDeaths: stat.totalDeaths + stats.deaths,
            totalAssists: stat.totalAssists + stats.assists,
          })
          .where(eq(heroStats.id, stat.id))
      } else {
        await db.insert(heroStats).values({
          playerId,
          heroId,
          gamesPlayed: 1,
          wins: stats.won ? 1 : 0,
          totalKills: stats.kills,
          totalDeaths: stats.deaths,
          totalAssists: stats.assists,
        })
      }
    }),

  getHeroStats: (playerId) =>
    Effect.promise(async () => {
      const db = useDb()
      return db.select().from(heroStats).where(eq(heroStats.playerId, playerId))
    }),

  incrementGamesPlayed: (playerId) =>
    Effect.promise(async () => {
      const db = useDb()
      const p = await db.select().from(players).where(eq(players.id, playerId)).limit(1)
      if (p[0]) {
        await db
          .update(players)
          .set({ gamesPlayed: p[0].gamesPlayed + 1 })
          .where(eq(players.id, playerId))
      }
    }),

  incrementWins: (playerId) =>
    Effect.promise(async () => {
      const db = useDb()
      const p = await db.select().from(players).where(eq(players.id, playerId)).limit(1)
      if (p[0]) {
        await db
          .update(players)
          .set({ wins: p[0].wins + 1 })
          .where(eq(players.id, playerId))
      }
    }),
})
