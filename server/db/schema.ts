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

// ── Type Exports ──────────────────────────────────────────────────

export type Player = typeof players.$inferSelect
export type NewPlayer = typeof players.$inferInsert
export type Match = typeof matches.$inferSelect
export type NewMatch = typeof matches.$inferInsert
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
