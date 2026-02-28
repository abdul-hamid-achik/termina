import {
  pgTable,
  text,
  integer,
  timestamp,
  jsonb,
  serial,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// ── Players ───────────────────────────────────────────────────────

export const players = pgTable('players', {
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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const playersRelations = relations(players, ({ many }) => ({
  matchPlayers: many(matchPlayers),
  heroStats: many(heroStats),
  providers: many(playerProviders),
}))

// ── Player Providers ─────────────────────────────────────────────

export const playerProviders = pgTable('player_providers', {
  id: serial('id').primaryKey(),
  playerId: text('player_id')
    .notNull()
    .references(() => players.id),
  provider: text('provider').notNull(),
  providerId: text('provider_id').notNull(),
  providerUsername: text('provider_username'),
  providerAvatarUrl: text('provider_avatar_url'),
  linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('player_providers_provider_provider_id_idx').on(table.provider, table.providerId),
  index('player_providers_player_id_idx').on(table.playerId),
])

export const playerProvidersRelations = relations(playerProviders, ({ one }) => ({
  player: one(players, { fields: [playerProviders.playerId], references: [players.id] }),
}))

// ── Matches ───────────────────────────────────────────────────────

export const matches = pgTable('matches', {
  id: text('id').primaryKey(),
  mode: text('mode', { enum: ['ranked_5v5', 'quick_3v3', '1v1'] }).notNull(),
  winner: text('winner', { enum: ['radiant', 'dire'] }),
  durationTicks: integer('duration_ticks'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
})

export const matchesRelations = relations(matches, ({ many }) => ({
  matchPlayers: many(matchPlayers),
}))

// ── Match Players ─────────────────────────────────────────────────

export const matchPlayers = pgTable('match_players', {
  id: serial('id').primaryKey(),
  matchId: text('match_id')
    .notNull()
    .references(() => matches.id),
  playerId: text('player_id')
    .notNull()
    .references(() => players.id),
  team: text('team', { enum: ['radiant', 'dire'] }).notNull(),
  heroId: text('hero_id').notNull(),
  kills: integer('kills').notNull().default(0),
  deaths: integer('deaths').notNull().default(0),
  assists: integer('assists').notNull().default(0),
  goldEarned: integer('gold_earned').notNull().default(0),
  damageDealt: integer('damage_dealt').notNull().default(0),
  healingDone: integer('healing_done').notNull().default(0),
  finalItems: jsonb('final_items').$type<string[]>().default([]),
  finalLevel: integer('final_level').notNull().default(1),
  mmrChange: integer('mmr_change').notNull().default(0),
}, (table) => [
  index('match_players_match_id_idx').on(table.matchId),
  index('match_players_player_id_idx').on(table.playerId),
])

export const matchPlayersRelations = relations(matchPlayers, ({ one }) => ({
  match: one(matches, { fields: [matchPlayers.matchId], references: [matches.id] }),
  player: one(players, { fields: [matchPlayers.playerId], references: [players.id] }),
}))

// ── Hero Stats ────────────────────────────────────────────────────

export const heroStats = pgTable('hero_stats', {
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
}, (table) => [
  index('hero_stats_player_id_idx').on(table.playerId),
  index('hero_stats_hero_id_idx').on(table.heroId),
])

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
export type HeroStat = typeof heroStats.$inferSelect
export type NewHeroStat = typeof heroStats.$inferInsert
export type PlayerProvider = typeof playerProviders.$inferSelect
export type NewPlayerProvider = typeof playerProviders.$inferInsert
