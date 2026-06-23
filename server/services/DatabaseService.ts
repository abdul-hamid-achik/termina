import { Context, Effect, Layer } from 'effect'
import { eq, desc, and, sql } from 'drizzle-orm'
import { useDb, closeDb } from '~~/server/db'
import {
  players,
  matches,
  matchPlayers,
  heroStats,
  playerProviders,
  type Player,
  type NewPlayer,
  type Match,
  type NewMatch,
  type NewMatchPlayer,
  type HeroStat,
  type MatchPlayer,
  type PlayerProvider,
} from '~~/server/db/schema'

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
  readonly getPlayerByProvider: (
    provider: string,
    providerId: string,
  ) => Effect.Effect<Player | null>
  readonly createPlayer: (data: NewPlayer) => Effect.Effect<Player>
  readonly updatePlayerMMR: (id: string, mmr: number) => Effect.Effect<void>
  readonly recordMatch: (match: NewMatch, players: NewMatchPlayer[]) => Effect.Effect<string>
  readonly getMatchHistory: (playerId: string, limit?: number) => Effect.Effect<Match[]>
  readonly getMatch: (id: string) => Effect.Effect<MatchWithPlayers | null>
  readonly getLeaderboard: (limit?: number) => Effect.Effect<Player[]>
  readonly updateHeroStats: (
    playerId: string,
    heroId: string,
    stats: HeroStatUpdate,
  ) => Effect.Effect<void>
  readonly getHeroStats: (playerId: string) => Effect.Effect<HeroStat[]>
  readonly incrementGamesPlayed: (playerId: string) => Effect.Effect<void>
  readonly incrementWins: (playerId: string) => Effect.Effect<void>
  readonly getPlayerByUsername: (username: string) => Effect.Effect<Player | null>
  readonly createLocalPlayer: (
    username: string,
    passwordHash: string,
    email?: string | null,
  ) => Effect.Effect<Player>
  /** Mark a player's email as verified (sets email_verified_at = now). */
  readonly setEmailVerified: (playerId: string) => Effect.Effect<void>
  readonly linkProvider: (
    playerId: string,
    provider: string,
    providerId: string,
    username: string | null,
    avatarUrl: string | null,
  ) => Effect.Effect<PlayerProvider>
  readonly unlinkProvider: (playerId: string, provider: string) => Effect.Effect<void>
  readonly getPlayerProviders: (playerId: string) => Effect.Effect<PlayerProvider[]>
  readonly updatePlayerAvatar: (playerId: string, heroId: string | null) => Effect.Effect<void>
  readonly updatePlayerUsername: (playerId: string, username: string) => Effect.Effect<void>
  readonly updatePlayerPassword: (playerId: string, passwordHash: string) => Effect.Effect<void>
  /** Gracefully close the postgres connection pool. Called on Nitro shutdown. */
  readonly shutdown: () => Effect.Effect<void>
}

export class DatabaseService extends Context.Tag('DatabaseService')<
  DatabaseService,
  DatabaseServiceApi
>() {}

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
        .where(
          and(
            eq(players.providerId, providerId),
            eq(players.provider, provider as 'github' | 'discord' | 'local'),
          ),
        )
        .limit(1)
      return result[0] ?? null
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
    }).pipe(
      Effect.tap(() =>
        Effect.logDebug('MMR updated').pipe(Effect.annotateLogs({ playerId: id, newMmr: mmr })),
      ),
    ),

  recordMatch: (match, matchPlayerData) =>
    Effect.gen(function* () {
      const db = useDb()
      // Retry with exponential backoff — a single DB hiccup (connection blip,
      // transient deadlock) must not permanently lose a match record.
      const MAX_RETRIES = 3
      const BASE_DELAY_MS = 500
      let lastErr: unknown
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        // Run the idempotency check + transactional insert as ONE fallible
        // effect. Effect.tryPromise routes a rejection into the typed error
        // channel (Effect.promise would turn it into an uncatchable defect that
        // kills the fiber and bypasses this retry loop entirely), and catchAll
        // folds success/failure into a tagged result the loop can branch on.
        const result = yield* Effect.tryPromise(async () => {
          // Idempotency: if the match already exists (e.g. a previous attempt
          // partially succeeded before the ack was received), skip re-inserting
          // to avoid a unique-constraint violation.
          const existing = await db
            .select({ id: matches.id })
            .from(matches)
            .where(eq(matches.id, match.id))
            .limit(1)
          if (existing.length > 0) return { idempotent: true as const }
          // Transactional: if the matchPlayer insert fails, the match row is
          // rolled back too — no orphan match with no players.
          await db.transaction(async (tx) => {
            await tx.insert(matches).values(match)
            if (matchPlayerData.length > 0) {
              await tx.insert(matchPlayers).values(matchPlayerData)
            }
          })
          return { idempotent: false as const }
        }).pipe(
          Effect.map((value) => ({ ok: true as const, value })),
          Effect.catchAll((err) => Effect.succeed({ ok: false as const, err })),
        )
        if (result.ok) {
          if (result.value.idempotent) {
            yield* Effect.logInfo('Match already persisted — idempotent skip').pipe(
              Effect.annotateLogs({ matchId: match.id }),
            )
          }
          return match.id
        }
        lastErr = result.err
        if (attempt < MAX_RETRIES) {
          const delay = BASE_DELAY_MS * 2 ** attempt
          yield* Effect.logWarning('Match persist failed — retrying').pipe(
            Effect.annotateLogs({ matchId: match.id, attempt: attempt + 1, delay }),
          )
          yield* Effect.sleep(`${delay} millis`)
        }
      }
      // All retries exhausted — log the error but still return the matchId
      // (the game is already over; losing the record is logged, not fatal).
      yield* Effect.logError('Match persist failed after all retries').pipe(
        Effect.annotateLogs({ matchId: match.id, error: String(lastErr) }),
      )
      return match.id
    }).pipe(
      Effect.tap((matchId) =>
        Effect.logInfo('Match persisted').pipe(Effect.annotateLogs({ matchId })),
      ),
    ),

  getMatchHistory: (playerId, limit = 20) =>
    Effect.promise(async () => {
      const db = useDb()
      const results = await db
        .select({ match: matches })
        .from(matchPlayers)
        .innerJoin(matches, eq(matchPlayers.matchId, matches.id))
        .where(eq(matchPlayers.playerId, playerId))
        .orderBy(desc(matches.createdAt))
        .limit(limit)

      return results.map((r) => r.match)
    }),

  getMatch: (id) =>
    Effect.promise(async () => {
      const db = useDb()
      const matchResult = await db.select().from(matches).where(eq(matches.id, id)).limit(1)
      const match = matchResult[0]
      if (!match) return null

      const results = await db
        .select()
        .from(matchPlayers)
        .innerJoin(players, eq(matchPlayers.playerId, players.id))
        .where(eq(matchPlayers.matchId, id))

      const playersInMatch = results.map((r) => ({
        ...r.match_players,
        player: r.players,
      }))

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
      await db
        .insert(heroStats)
        .values({
          playerId,
          heroId,
          gamesPlayed: 1,
          wins: stats.won ? 1 : 0,
          totalKills: stats.kills,
          totalDeaths: stats.deaths,
          totalAssists: stats.assists,
        })
        .onConflictDoUpdate({
          target: [heroStats.playerId, heroStats.heroId],
          // Qualify each column to the target table. In ON CONFLICT DO UPDATE the
          // SET expressions see both hero_stats and the `excluded` pseudo-row, so a
          // bare `games_played`/`wins` is ambiguous (Postgres errors out).
          set: {
            gamesPlayed: sql`${heroStats.gamesPlayed} + 1`,
            wins: sql`${heroStats.wins} + ${stats.won ? 1 : 0}`,
            totalKills: sql`${heroStats.totalKills} + ${stats.kills}`,
            totalDeaths: sql`${heroStats.totalDeaths} + ${stats.deaths}`,
            totalAssists: sql`${heroStats.totalAssists} + ${stats.assists}`,
          },
        })
    }),

  getHeroStats: (playerId) =>
    Effect.promise(async () => {
      const db = useDb()
      return db.select().from(heroStats).where(eq(heroStats.playerId, playerId))
    }),

  incrementGamesPlayed: (playerId) =>
    Effect.promise(async () => {
      const db = useDb()
      await db
        .update(players)
        .set({ gamesPlayed: sql`games_played + 1` })
        .where(eq(players.id, playerId))
    }),

  incrementWins: (playerId) =>
    Effect.promise(async () => {
      const db = useDb()
      await db
        .update(players)
        .set({ wins: sql`wins + 1` })
        .where(eq(players.id, playerId))
    }),

  getPlayerByUsername: (username) =>
    Effect.promise(async () => {
      const db = useDb()
      const result = await db.select().from(players).where(eq(players.username, username)).limit(1)
      return result[0] ?? null
    }),

  createLocalPlayer: (username, passwordHash, email) =>
    Effect.promise(async () => {
      const db = useDb()
      const id = `local_${crypto.randomUUID()}`
      const result = await db
        .insert(players)
        .values({
          id,
          username,
          passwordHash,
          email: email ?? null,
          provider: 'local',
          providerId: id,
        })
        .returning()
      return result[0]!
    }),

  setEmailVerified: (playerId) =>
    Effect.promise(async () => {
      const db = useDb()
      await db.update(players).set({ emailVerifiedAt: new Date() }).where(eq(players.id, playerId))
    }),

  linkProvider: (playerId, provider, providerId, username, avatarUrl) =>
    Effect.promise(async () => {
      const db = useDb()
      const result = await db
        .insert(playerProviders)
        .values({
          playerId,
          provider,
          providerId,
          providerUsername: username,
          providerAvatarUrl: avatarUrl,
        })
        .returning()
      return result[0]!
    }),

  unlinkProvider: (playerId, provider) =>
    Effect.promise(async () => {
      const db = useDb()
      await db
        .delete(playerProviders)
        .where(and(eq(playerProviders.playerId, playerId), eq(playerProviders.provider, provider)))
    }),

  getPlayerProviders: (playerId) =>
    Effect.promise(async () => {
      const db = useDb()
      return db.select().from(playerProviders).where(eq(playerProviders.playerId, playerId))
    }),

  updatePlayerAvatar: (playerId, heroId) =>
    Effect.promise(async () => {
      const db = useDb()
      await db.update(players).set({ selectedAvatar: heroId }).where(eq(players.id, playerId))
    }),

  updatePlayerUsername: (playerId, username) =>
    Effect.promise(async () => {
      const db = useDb()
      await db.update(players).set({ username }).where(eq(players.id, playerId))
    }),

  updatePlayerPassword: (playerId, passwordHash) =>
    Effect.promise(async () => {
      const db = useDb()
      await db.update(players).set({ passwordHash }).where(eq(players.id, playerId))
    }),

  shutdown: () => Effect.promise(async () => closeDb()),
})
