import { Context, Effect, Layer } from 'effect'
import { eq, desc, and, sql, inArray } from 'drizzle-orm'
import { useDb, closeDb } from '~~/server/db'
import { PLACEMENT_GAMES } from '~~/shared/constants/ranks'
import {
  players,
  matches,
  matchPlayers,
  heroStats,
  playerProviders,
  seasons,
  guilds,
  type Player,
  type NewPlayer,
  type Match,
  type MatchHistoryEntry,
  type NewMatch,
  type NewMatchPlayer,
  type HeroStat,
  type MatchPlayer,
  type PlayerProvider,
  type Season,
  type Guild,
} from '~~/server/db/schema'

/** Public-safe subset of a player — NEVER includes email / passwordHash / provider ids. */
export type PublicMatchPlayer = Pick<
  Player,
  'id' | 'username' | 'avatarUrl' | 'selectedAvatar' | 'mmr'
>

export interface MatchWithPlayers extends Match {
  players: (MatchPlayer & { player: PublicMatchPlayer })[]
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
  /** Persist a match, returning false only after all retry attempts fail. */
  readonly recordMatch: (match: NewMatch, players: NewMatchPlayer[]) => Effect.Effect<boolean>
  readonly getMatchHistory: (playerId: string, limit?: number) => Effect.Effect<MatchHistoryEntry[]>
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
  /** Mark the guided tutorial as completed for a player (idempotent). */
  readonly markTutorialCompleted: (playerId: string) => Effect.Effect<void>
  /** Get the active season, creating Season 1 on first use. */
  readonly getCurrentSeason: () => Effect.Effect<Season>
  /** Apply a seasonal MMR delta atomically (floored at 0) — mirrors a ranked
   *  game's lifetime MMR change onto the resettable seasonal ladder. */
  readonly applySeasonMmrChange: (playerId: string, change: number) => Effect.Effect<void>
  readonly incrementSeasonGamesPlayed: (playerId: string) => Effect.Effect<void>
  readonly incrementSeasonWins: (playerId: string) => Effect.Effect<void>
  /** Leaderboard ordered by seasonal MMR (the current competitive ladder). */
  readonly getSeasonLeaderboard: (limit?: number) => Effect.Effect<Player[]>
  /** End the active season and start the next one, soft-resetting the ladder. */
  readonly startNewSeason: () => Effect.Effect<Season>
  /** Create a guild and make the creator its leader (and first member). */
  readonly createGuild: (name: string, tag: string, leaderId: string) => Effect.Effect<Guild>
  readonly getGuild: (guildId: string) => Effect.Effect<Guild | null>
  readonly getGuildByName: (name: string) => Effect.Effect<Guild | null>
  readonly getPlayerGuild: (playerId: string) => Effect.Effect<Guild | null>
  readonly getGuildMembers: (guildId: string) => Effect.Effect<Player[]>
  readonly listGuilds: (limit?: number) => Effect.Effect<Guild[]>
  readonly getGuildsByIds: (ids: string[]) => Effect.Effect<Guild[]>
  /** Resolve playerId → guild tag for a batch of players (for in-game display). */
  readonly getGuildTagsForPlayers: (playerIds: string[]) => Effect.Effect<Record<string, string>>
  readonly joinGuild: (guildId: string, playerId: string) => Effect.Effect<void>
  readonly leaveGuild: (playerId: string) => Effect.Effect<void>
  readonly getPlayerByUsername: (username: string) => Effect.Effect<Player | null>
  /** Look a player up by email — one address may only belong to one account,
   *  or "reset my password" becomes ambiguous. */
  readonly getPlayerByEmail: (email: string) => Effect.Effect<Player | null>
  readonly createLocalPlayer: (
    username: string,
    passwordHash: string,
    email?: string | null,
  ) => Effect.Effect<Player>
  /** Set (or change) a player's email. Clears the verified stamp: a new address
   *  is unverified by definition, and carrying the old ✓ across would mean a
   *  password reset could be sent to an address nobody proved they own. */
  readonly setPlayerEmail: (playerId: string, email: string) => Effect.Effect<void>
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
      // playerProviders is the source of truth for OAuth identities. The
      // legacy columns are checked only for rows that predate the normalized
      // provider table, and are migrated as part of that fallback lookup.
      const linked = await db
        .select({ player: players })
        .from(playerProviders)
        .innerJoin(players, eq(playerProviders.playerId, players.id))
        .where(
          and(eq(playerProviders.provider, provider), eq(playerProviders.providerId, providerId)),
        )
        .limit(1)
      if (linked[0]?.player) return linked[0].player

      const legacy = await db
        .select()
        .from(players)
        .where(
          and(
            eq(players.providerId, providerId),
            eq(players.provider, provider as 'github' | 'discord' | 'local'),
          ),
        )
        .limit(1)
      const player = legacy[0] ?? null
      if (player) {
        // The unique provider identity index makes this safe under concurrent
        // OAuth callbacks. If another callback backfilled first, keep its row.
        const backfilled = await db
          .insert(playerProviders)
          .values({
            playerId: player.id,
            provider,
            providerId,
            providerUsername: player.username,
            providerAvatarUrl: player.avatarUrl,
          })
          .onConflictDoNothing({
            target: [playerProviders.provider, playerProviders.providerId],
          })
          .returning({ playerId: playerProviders.playerId })
        if (backfilled.length === 0) {
          // A concurrent callback may have claimed this provider identity for
          // another player between the two lookups. Re-read the authoritative
          // row rather than authenticating against the stale legacy match.
          const authoritative = await db
            .select({ player: players })
            .from(playerProviders)
            .innerJoin(players, eq(playerProviders.playerId, players.id))
            .where(
              and(
                eq(playerProviders.provider, provider),
                eq(playerProviders.providerId, providerId),
              ),
            )
            .limit(1)
          // If the legacy row lost the race for this provider identity, never
          // authenticate against it: the normalized row is authoritative.
          return authoritative[0]?.player ?? null
        }
      }
      return player
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
          } else {
            yield* Effect.logInfo('Match persisted').pipe(
              Effect.annotateLogs({ matchId: match.id }),
            )
          }
          return true
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
      // All retries exhausted — report failure without failing the game-over
      // fiber. Callers must not apply derived stats to an unpersisted match.
      yield* Effect.logError('Match persist failed after all retries').pipe(
        Effect.annotateLogs({ matchId: match.id, error: String(lastErr) }),
      )
      return false
    }),

  getMatchHistory: (playerId, limit = 20) =>
    Effect.promise(async () => {
      const db = useDb()
      const results = await db
        .select({ match: matches, team: matchPlayers.team })
        .from(matchPlayers)
        .innerJoin(matches, eq(matchPlayers.matchId, matches.id))
        .where(eq(matchPlayers.playerId, playerId))
        .orderBy(desc(matches.createdAt))
        .limit(limit)

      // Carry the queried player's team so the UI can show Victory/Defeat from
      // their perspective (not just which side won).
      return results.map((r) => ({ ...r.match, team: r.team }))
    }),

  getMatch: (id) =>
    Effect.promise(async () => {
      const db = useDb()
      const matchResult = await db.select().from(matches).where(eq(matches.id, id)).limit(1)
      const match = matchResult[0]
      if (!match) return null

      // Project ONLY public player columns — the join must never carry
      // email / passwordHash / provider ids off the server (a match payload is
      // readable by any authenticated user).
      const results = await db
        .select({
          match_players: matchPlayers,
          player: {
            id: players.id,
            username: players.username,
            avatarUrl: players.avatarUrl,
            selectedAvatar: players.selectedAvatar,
            mmr: players.mmr,
          },
        })
        .from(matchPlayers)
        .innerJoin(players, eq(matchPlayers.playerId, players.id))
        .where(eq(matchPlayers.matchId, id))

      const playersInMatch = results.map((r) => ({
        ...r.match_players,
        player: r.player,
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

  markTutorialCompleted: (playerId) =>
    Effect.promise(async () => {
      const db = useDb()
      await db.update(players).set({ tutorialCompleted: true }).where(eq(players.id, playerId))
    }),

  getCurrentSeason: () =>
    Effect.promise(async () => {
      const db = useDb()
      const active = await db.select().from(seasons).where(eq(seasons.active, true)).limit(1)
      if (active[0]) return active[0]
      // First use → create Season 1. The unique season_number guards against a
      // concurrent creator; if this insert loses the race, re-read the winner.
      try {
        const created = await db
          .insert(seasons)
          .values({ seasonNumber: 1, active: true })
          .returning()
        return created[0]!
      } catch {
        const retry = await db.select().from(seasons).where(eq(seasons.active, true)).limit(1)
        return retry[0]!
      }
    }),

  applySeasonMmrChange: (playerId, change) =>
    Effect.promise(async () => {
      const db = useDb()
      await db
        .update(players)
        .set({ seasonMmr: sql`GREATEST(0, ${players.seasonMmr} + ${change})` })
        .where(eq(players.id, playerId))
    }),

  incrementSeasonGamesPlayed: (playerId) =>
    Effect.promise(async () => {
      const db = useDb()
      await db
        .update(players)
        .set({ seasonGamesPlayed: sql`season_games_played + 1` })
        .where(eq(players.id, playerId))
    }),

  incrementSeasonWins: (playerId) =>
    Effect.promise(async () => {
      const db = useDb()
      await db
        .update(players)
        .set({ seasonWins: sql`season_wins + 1` })
        .where(eq(players.id, playerId))
    }),

  // Ranked players only. Selecting every row made the ladder a list of everyone
  // who had ever registered — all sitting at the 1000 baseline with 0-0 — which
  // also let an account that has never played outrank someone who lost a match.
  getSeasonLeaderboard: (limit = 100) =>
    Effect.promise(async () => {
      const db = useDb()
      return db
        .select()
        .from(players)
        .where(sql`${players.seasonGamesPlayed} >= ${PLACEMENT_GAMES}`)
        .orderBy(desc(players.seasonMmr))
        .limit(limit)
    }),

  startNewSeason: () =>
    Effect.promise(async () => {
      const db = useDb()
      // Close out the current active season (if any).
      await db
        .update(seasons)
        .set({ active: false, endedAt: new Date() })
        .where(eq(seasons.active, true))
      const last = await db
        .select({ seasonNumber: seasons.seasonNumber })
        .from(seasons)
        .orderBy(desc(seasons.seasonNumber))
        .limit(1)
      const nextNumber = (last[0]?.seasonNumber ?? 0) + 1
      const created = await db
        .insert(seasons)
        .values({ seasonNumber: nextNumber, active: true })
        .returning()
      // Soft-reset the ladder: pull everyone's seasonal MMR halfway toward the
      // 1000 baseline and zero the seasonal W/L record. Lifetime mmr is untouched.
      await db.update(players).set({
        seasonMmr: sql`1000 + (${players.seasonMmr} - 1000) / 2`,
        seasonGamesPlayed: 0,
        seasonWins: 0,
        seasonNumber: nextNumber,
      })
      return created[0]!
    }),

  createGuild: (name, tag, leaderId) =>
    Effect.promise(async () => {
      const db = useDb()
      const created = await db
        .insert(guilds)
        .values({ id: crypto.randomUUID(), name, tag, leaderId })
        .returning()
      // The creator is the first member.
      await db.update(players).set({ guildId: created[0]!.id }).where(eq(players.id, leaderId))
      return created[0]!
    }),

  getGuild: (guildId) =>
    Effect.promise(async () => {
      const db = useDb()
      const rows = await db.select().from(guilds).where(eq(guilds.id, guildId)).limit(1)
      return rows[0] ?? null
    }),

  getGuildByName: (name) =>
    Effect.promise(async () => {
      const db = useDb()
      const rows = await db.select().from(guilds).where(eq(guilds.name, name)).limit(1)
      return rows[0] ?? null
    }),

  getPlayerGuild: (playerId) =>
    Effect.promise(async () => {
      const db = useDb()
      const rows = await db
        .select({ guild: guilds })
        .from(players)
        .innerJoin(guilds, eq(players.guildId, guilds.id))
        .where(eq(players.id, playerId))
        .limit(1)
      return rows[0]?.guild ?? null
    }),

  getGuildMembers: (guildId) =>
    Effect.promise(async () => {
      const db = useDb()
      return db.select().from(players).where(eq(players.guildId, guildId))
    }),

  listGuilds: (limit = 50) =>
    Effect.promise(async () => {
      const db = useDb()
      return db.select().from(guilds).orderBy(guilds.name).limit(limit)
    }),

  getGuildsByIds: (ids) =>
    Effect.promise(async () => {
      if (ids.length === 0) return []
      const db = useDb()
      return db.select().from(guilds).where(inArray(guilds.id, ids))
    }),

  getGuildTagsForPlayers: (playerIds) =>
    Effect.promise(async () => {
      if (playerIds.length === 0) return {}
      const db = useDb()
      const rows = await db
        .select({ playerId: players.id, tag: guilds.tag })
        .from(players)
        .innerJoin(guilds, eq(players.guildId, guilds.id))
        .where(inArray(players.id, playerIds))
      const out: Record<string, string> = {}
      for (const r of rows) out[r.playerId] = r.tag
      return out
    }),

  joinGuild: (guildId, playerId) =>
    Effect.promise(async () => {
      const db = useDb()
      await db.update(players).set({ guildId }).where(eq(players.id, playerId))
    }),

  leaveGuild: (playerId) =>
    Effect.promise(async () => {
      const db = useDb()
      await db.update(players).set({ guildId: null }).where(eq(players.id, playerId))
    }),

  getPlayerByEmail: (email) =>
    Effect.promise(async () => {
      const db = useDb()
      const rows = await db.select().from(players).where(eq(players.email, email)).limit(1)
      return rows[0] ?? null
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

  setPlayerEmail: (playerId, email) =>
    Effect.promise(async () => {
      const db = useDb()
      await db.update(players).set({ email, emailVerifiedAt: null }).where(eq(players.id, playerId))
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
      await db.transaction(async (tx) => {
        await tx
          .delete(playerProviders)
          .where(
            and(eq(playerProviders.playerId, playerId), eq(playerProviders.provider, provider)),
          )

        // OAuth lookup falls back to these deprecated columns for legacy rows.
        // Clear them when they identify the provider being unlinked, otherwise
        // a later OAuth login would silently recreate the link.
        await tx
          .update(players)
          .set({ provider: null, providerId: null })
          .where(
            and(
              eq(players.id, playerId),
              eq(players.provider, provider as 'github' | 'discord' | 'local'),
            ),
          )
      })
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
