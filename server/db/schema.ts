import {
  pgTable,
  text,
  integer,
  timestamp,
  jsonb,
  serial,
  index,
  uniqueIndex,
  boolean,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import type { Command } from '~~/shared/types/commands'

// ── Players ───────────────────────────────────────────────────────

export const players = pgTable(
  'players',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull().unique(),
    email: text('email'),
    avatarUrl: text('avatar_url'),
    passwordHash: text('password_hash'),
    selectedAvatar: text('selected_avatar'),
    /** @deprecated Use playerProviders table instead */
    provider: text('provider', { enum: ['github', 'discord', 'local'] }),
    /** @deprecated Use playerProviders table instead */
    providerId: text('provider_id'),
    mmr: integer('mmr').notNull().default(1000),
    gamesPlayed: integer('games_played').notNull().default(0),
    wins: integer('wins').notNull().default(0),
    // Seasonal rating — the competitive ladder resets each season (soft reset
    // toward the baseline), while `mmr` above stays as the lifetime rating.
    // The leaderboard + rank tiers are driven by seasonMmr. Additive + default
    // 1000 → `drizzle-kit push` safe.
    seasonMmr: integer('season_mmr').notNull().default(1000),
    seasonGamesPlayed: integer('season_games_played').notNull().default(0),
    seasonWins: integer('season_wins').notNull().default(0),
    // Which season the seasonal fields belong to (matches seasons.seasonNumber).
    seasonNumber: integer('season_number').notNull().default(1),
    // The guild/clan this player belongs to (null = unaffiliated). Additive +
    // nullable → `drizzle-kit push` safe.
    guildId: text('guild_id'),
    // Set true once the player finishes the guided tutorial. Lets the client
    // funnel new players toward practice and skip the "learn to play" nudge for
    // returning players. Additive + default false → `drizzle-kit push` safe.
    tutorialCompleted: boolean('tutorial_completed').notNull().default(false),
    // Set when the user confirms their email (verification link) or signs in via
    // an OAuth provider that already verified it. Null = unverified. Nullable +
    // additive, so `drizzle-kit push` applies it with no data migration.
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('players_mmr_idx').on(table.mmr)],
)

export const playersRelations = relations(players, ({ many }) => ({
  matchPlayers: many(matchPlayers),
  heroStats: many(heroStats),
  providers: many(playerProviders),
}))

// ── Player Providers ─────────────────────────────────────────────

export const playerProviders = pgTable(
  'player_providers',
  {
    id: serial('id').primaryKey(),
    playerId: text('player_id')
      .notNull()
      .references(() => players.id),
    provider: text('provider').notNull(),
    providerId: text('provider_id').notNull(),
    providerUsername: text('provider_username'),
    providerAvatarUrl: text('provider_avatar_url'),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('player_providers_provider_provider_id_idx').on(table.provider, table.providerId),
    index('player_providers_player_id_idx').on(table.playerId),
  ],
)

export const playerProvidersRelations = relations(playerProviders, ({ one }) => ({
  player: one(players, { fields: [playerProviders.playerId], references: [players.id] }),
}))

// ── Matches ───────────────────────────────────────────────────────

export const matches = pgTable(
  'matches',
  {
    id: text('id').primaryKey(),
    // casual_5v5 = a game that contained bots (bot-filled matchmaking or practice);
    // it is recorded for history but never affects MMR (see game-server onGameOver).
    mode: text('mode', { enum: ['ranked_5v5', 'quick_3v3', '1v1', 'casual_5v5'] }).notNull(),
    winner: text('winner', { enum: ['chaff', 'audit'] }),
    durationCycles: integer('duration_ticks'),
    // The season this match was played in (null for pre-seasons history).
    seasonNumber: integer('season_number'),
    // Derived ladder/profile stats are applied in the same transaction as this
    // claim. This makes a retried game-over callback safe: one callback wins
    // the claim, later callbacks observe true and do no work.
    derivedStatsApplied: boolean('derived_stats_applied').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (table) => [index('matches_created_at_idx').on(table.createdAt)],
)

export const matchesRelations = relations(matches, ({ many }) => ({
  matchPlayers: many(matchPlayers),
}))

// ── Seasons ───────────────────────────────────────────────────────
// Competitive seasons. Exactly one row has active=true at a time; the seasonal
// ladder (players.seasonMmr) resets when a new season starts.

export const seasons = pgTable('seasons', {
  id: serial('id').primaryKey(),
  seasonNumber: integer('season_number').notNull().unique(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  active: boolean('active').notNull().default(true),
})

// ── Guilds / Clans ────────────────────────────────────────────────
// A guild is a persistent named group with a short tag shown next to members'
// names. Membership is one-to-one (players.guildId). The leader is recorded so
// the roster can mark them; deleting/transfer is out of scope for the MVP.

export const guilds = pgTable(
  'guilds',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull().unique(),
    tag: text('tag').notNull(),
    leaderId: text('leader_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    guildNameIdx: index('guild_name_idx').on(table.name),
  }),
)

// ── Match Players ─────────────────────────────────────────────────

export const matchPlayers = pgTable(
  'match_players',
  {
    id: serial('id').primaryKey(),
    matchId: text('match_id')
      .notNull()
      .references(() => matches.id),
    playerId: text('player_id')
      .notNull()
      .references(() => players.id),
    team: text('team', { enum: ['chaff', 'audit'] }).notNull(),
    heroId: text('hero_id').notNull(),
    kills: integer('kills').notNull().default(0),
    deaths: integer('deaths').notNull().default(0),
    assists: integer('assists').notNull().default(0),
    /** @deprecated Legacy field; use finalScrip/netWorth for the scrip economy. */
    goldEarned: integer('gold_earned').notNull().default(0),
    // End-of-match economy/combat/farm values used by the public history view.
    finalScrip: integer('final_scrip').notNull().default(0),
    netWorth: integer('net_worth').notNull().default(0),
    damageDealt: integer('damage_dealt').notNull().default(0),
    iceDamageDealt: integer('ice_damage_dealt').notNull().default(0),
    lastHits: integer('last_hits').notNull().default(0),
    burns: integer('burns').notNull().default(0),
    /** @deprecated Healing is not tracked by the engine yet. */
    healingDone: integer('healing_done').notNull().default(0),
    finalItems: jsonb('final_items').$type<string[]>().default([]),
    finalLevel: integer('final_level').notNull().default(1),
    mmrChange: integer('mmr_change').notNull().default(0),
  },
  (table) => [
    index('match_players_match_id_idx').on(table.matchId),
    index('match_players_player_id_idx').on(table.playerId),
    uniqueIndex('match_players_match_player_unique').on(table.matchId, table.playerId),
  ],
)

export const matchPlayersRelations = relations(matchPlayers, ({ one }) => ({
  match: one(matches, { fields: [matchPlayers.matchId], references: [matches.id] }),
  player: one(players, { fields: [matchPlayers.playerId], references: [players.id] }),
}))

// ── Match Replays ─────────────────────────────────────────────────
// The durable replay artifact. With deterministic resolution (GameState.rngSeed
// → per-tick RNG), a replay is fully reproducible from roster metadata + the
// action log + the seed — no per-frame storage. Written inside the durable
// finalization path (game-server reconcileFinalization) so it inherits its
// exactly-once/retry guarantees; the Redis copies (snapshot + action log, 8h
// TTL) remain the fast path and this row is the archive the replay endpoints
// fall back to.

export const matchReplays = pgTable('match_replays', {
  // Same id space as matches.id (the gameId) — replays exist only for
  // recorded matches (practice games are never persisted at all).
  matchId: text('match_id')
    .primaryKey()
    .references(() => matches.id),
  // Bumped manually when engine behavior changes enough that old replays
  // are expected to diverge. The hash below makes divergence DETECTABLE
  // regardless; this is the honest label for "recorded under other rules".
  rulesetVersion: integer('ruleset_version').notNull(),
  // The per-game resolution seed — stitched into the re-run so crits/procs/
  // spawns replay identically.
  rngSeed: integer('rng_seed'),
  /** Roster/setup metadata (SnapshotMeta shape). */
  meta: jsonb('meta').notNull(),
  /** The full persisted action log (LoggedAction[]). */
  actions: jsonb('actions').notNull(),
  /** The final ended GameState (sets converted to arrays for JSON). */
  finalState: jsonb('final_state').notNull(),
  /** sha256 of the stable final-state summary — lets the reconstruction
   * verify it landed on the SAME game, and say so when it didn't. */
  finalSummaryHash: text('final_summary_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const matchReplaysRelations = relations(matchReplays, ({ one }) => ({
  match: one(matches, { fields: [matchReplays.matchId], references: [matches.id] }),
}))

// ── Hero Stats ────────────────────────────────────────────────────

export const heroStats = pgTable(
  'hero_stats',
  {
    id: serial('id').primaryKey(),
    playerId: text('player_id')
      .notNull()
      .references(() => players.id),
    heroId: text('hero_id').notNull(),
    gamesPlayed: integer('games_played').notNull().default(0),
    wins: integer('wins').notNull().default(0),
    totalKills: integer('total_kills').notNull().default(0),
    totalDeaths: integer('total_deaths').notNull().default(0),
    totalAssists: integer('total_assists').notNull().default(0),
  },
  (table) => [
    // One row per (player, hero) — the target for updateHeroStats' upsert.
    // Without this unique index the ON CONFLICT (player_id, hero_id) has nothing
    // to match and game-over stat persistence fails.
    uniqueIndex('hero_stats_player_hero_unique').on(table.playerId, table.heroId),
    index('hero_stats_hero_id_idx').on(table.heroId),
  ],
)

export const heroStatsRelations = relations(heroStats, ({ one }) => ({
  player: one(players, { fields: [heroStats.playerId], references: [players.id] }),
}))

// ── Live Games (Workflow tick, spike/workflow-tick migration) ──────
// The durable home for a game's ENGINE state while the all-Vercel workflow
// tick drives it — replaces the DO process's in-memory `liveGames` map.
// `cycle` mirrors `state.cycle` in a plain column (not buried in jsonb)
// specifically so the tick step's UPDATE can compare-and-swap on it: at-
// least-once workflow execution means two invocations of the SAME tick can
// race, and only the one that still sees `cycle = loadedCycle` may win the
// write (see server/workflows/gameTick.ts's CAS guard). `roster` carries
// everything needed to rehydrate the per-process bot/hero registries on a
// fresh instance — every step may land on one.

/** One roster entry — enough to rehydrate BotManager.registerBots on a fresh
 *  instance. Structurally mirrors game-server.ts's local StartPlayer, kept as
 *  its own type (not imported) so server/db never depends on server/game. */
export interface LiveGameRosterPlayer {
  playerId: string
  team: 'chaff' | 'audit'
  heroId: string
  mmr: number
}

/** Game-wide bot registration options — mirrors BotManager's
 *  RegisterBotsOptions, kept structurally (not imported) for the same reason. */
export interface LiveGameBotOptions {
  difficulty?: 'easy' | 'medium' | 'hard' | 'unfair'
  forceLane?: string
  availableLanes?: string[]
}

export interface LiveGameRoster {
  players: LiveGameRosterPlayer[]
  botOptions?: LiveGameBotOptions
}

export const liveGames = pgTable('live_games', {
  gameId: text('game_id').primaryKey(),
  /** Full serialized GameState (Sets converted to arrays — see
   *  replayArtifact.serializeStateForTransport). Typed loosely: the transport
   *  shape diverges from GameState (surrenderVotes becomes arrays) and this
   *  column is always round-tripped through hydrate()/serializeStateForTransport
   *  in server/workflows/gameTick.ts rather than read as GameState directly. */
  state: jsonb('state').notNull().$type<Record<string, unknown>>(),
  /** Denormalized copy of state.cycle — the CAS guard's compare column. */
  cycle: integer('cycle').notNull(),
  /** StartPlayer roster (team/heroId/mmr) + bot registration options
   *  (difficulty/forceLane/availableLanes). */
  roster: jsonb('roster').notNull().$type<LiveGameRoster>(),
  /** Denormalized from state.mode — lets the action ingress + finalization
   *  gate on practice/tutorial games without hydrating the full state. */
  mode: text('mode').notNull().default('normal'),
  mapId: text('map_id'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type LiveGame = typeof liveGames.$inferSelect
export type NewLiveGame = typeof liveGames.$inferInsert

// ── Pending Actions (Workflow tick) ─────────────────────────────────
// The durable action ingress queue for a workflow-driven game. Actions land
// here from POST /api/game/action (the WS ingress has no equivalent on
// Vercel), and the tick step SELECTs + DELETEs a game's rows in one
// RETURNING query at the top of each tick before running processCycle —
// mirroring the in-process queue GameLoop.submitAction fed on DO.

export const pendingActions = pgTable(
  'pending_actions',
  {
    id: serial('id').primaryKey(),
    gameId: text('game_id').notNull(),
    playerId: text('player_id').notNull(),
    command: jsonb('command').notNull().$type<Command>(),
    /** The cycle the client saw open when it typed this order — mirrors
     *  ws.ts's forCycle semantics. Null = unstamped (bots, dev tools). */
    forCycle: integer('for_cycle'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('pending_actions_game_id_idx').on(table.gameId)],
)

export type PendingAction = typeof pendingActions.$inferSelect
export type NewPendingAction = typeof pendingActions.$inferInsert

// ── Type Exports ──────────────────────────────────────────────────

export type Player = typeof players.$inferSelect
export type NewPlayer = typeof players.$inferInsert
export type Match = typeof matches.$inferSelect
export type NewMatch = typeof matches.$inferInsert
export type MatchReplay = typeof matchReplays.$inferSelect
export type NewMatchReplay = typeof matchReplays.$inferInsert
export type MatchPlayer = typeof matchPlayers.$inferSelect
export type NewMatchPlayer = typeof matchPlayers.$inferInsert
export type MatchHistoryPlayerStats = Pick<
  MatchPlayer,
  | 'kills'
  | 'deaths'
  | 'assists'
  | 'finalScrip'
  | 'netWorth'
  | 'damageDealt'
  | 'iceDamageDealt'
  | 'lastHits'
  | 'burns'
  | 'finalItems'
  | 'finalLevel'
  | 'mmrChange'
>
/** A match plus the queried player's team and end-of-match stats. */
export type MatchHistoryEntry = Match & {
  team: 'chaff' | 'audit'
  playerStats: MatchHistoryPlayerStats
}
export type HeroStat = typeof heroStats.$inferSelect
export type NewHeroStat = typeof heroStats.$inferInsert
export type PlayerProvider = typeof playerProviders.$inferSelect
export type NewPlayerProvider = typeof playerProviders.$inferInsert
export type Season = typeof seasons.$inferSelect
export type NewSeason = typeof seasons.$inferInsert
export type Guild = typeof guilds.$inferSelect
export type NewGuild = typeof guilds.$inferInsert

// ════════════════════════════════════════════════════════════════════
// Neon matchmaking (spike/workflow-tick) — replaces the Redis sorted-set
// queue (server/game/matchmaking/queue.ts) for the Vercel-only cutover.
// See server/game/matchmaking/queueNeon.ts. Kept in its own section at
// the end of the file to keep this diff isolated from other concurrent
// schema additions (e.g. live_games/pending_actions).
// ════════════════════════════════════════════════════════════════════

export const queueEntries = pgTable(
  'queue_entries',
  {
    playerId: text('player_id').primaryKey(),
    username: text('username').notNull(),
    mmr: integer('mmr').notNull(),
    mode: text('mode').notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('queue_entries_mode_mmr_idx').on(table.mode, table.mmr)],
)

export type QueueEntryRow = typeof queueEntries.$inferSelect
export type NewQueueEntryRow = typeof queueEntries.$inferInsert

// ════════════════════════════════════════════════════════════════════
// Auth tokens (Neon replacement for Redis-backed reset/verify tokens) —
// see server/utils/authTokens.ts. Single-use, expiring tokens for password
// reset + email verification. `token` is the primary key (the token string
// itself is the lookup key, mirroring the old Redis key-per-token scheme);
// `consumeToken` DELETEs on read so redemption is single-use without a
// separate "used" flag.
// ════════════════════════════════════════════════════════════════════

export const authTokens = pgTable('auth_tokens', {
  token: text('token').primaryKey(),
  playerId: text('player_id').notNull(),
  purpose: text('purpose', { enum: ['reset', 'verify'] }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type AuthToken = typeof authTokens.$inferSelect
export type NewAuthToken = typeof authTokens.$inferInsert
