import type { Command } from './commands'
import type { GameState, GameEvent, TeamId } from './game'

// ── Client → Server ──────────────────────────────────────────────

export type ClientMessage =
  | { type: 'action'; command: Command }
  | { type: 'chat'; channel: 'team' | 'all'; message: string }
  | { type: 'ping_map'; zone: string }
  | { type: 'heartbeat' }
  | { type: 'reconnect'; gameId: string; playerId: string }

// ── Server → Client ──────────────────────────────────────────────

export interface TickStateMessage {
  type: 'tick_state'
  tick: number
  state: GameState
}

export interface EventsMessage {
  type: 'events'
  tick: number
  events: GameEvent[]
}

export interface AnnouncementMessage {
  type: 'announcement'
  message: string
  level: 'info' | 'warning' | 'kill' | 'objective'
}

export interface GameOverMessage {
  type: 'game_over'
  winner: TeamId
  stats: Record<string, PlayerEndStats>
}

export interface PlayerEndStats {
  kills: number
  deaths: number
  assists: number
  gold: number
  items: (string | null)[]
  heroDamage: number
  towerDamage: number
}

export interface ErrorMessage {
  type: 'error'
  code: string
  message: string
}

export interface QueueUpdateMessage {
  type: 'queue_update'
  playersInQueue: number
  estimatedWaitSeconds: number
}

export interface HeroPickMessage {
  type: 'hero_pick'
  playerId: string
  heroId: string
}

export type ServerMessage =
  | TickStateMessage
  | EventsMessage
  | AnnouncementMessage
  | GameOverMessage
  | ErrorMessage
  | QueueUpdateMessage
  | HeroPickMessage
