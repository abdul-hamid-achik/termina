import type { Command } from './commands'
import type { GameEvent, TeamId, PlayerVisibleState } from './game'

// ── Client → Server ──────────────────────────────────────────────

export type ClientMessage =
  | { type: 'action'; command: Command }
  | { type: 'chat'; channel: 'team' | 'all'; message: string }
  | { type: 'ping_map'; zone: string }
  | { type: 'heartbeat' }
  | { type: 'reconnect'; gameId: string; playerId: string }
  | { type: 'join_game'; gameId: string }
  | { type: 'hero_pick'; lobbyId: string; heroId: string }

// ── Server → Client ──────────────────────────────────────────────

export interface TickStateMessage {
  type: 'tick_state'
  tick: number
  state: PlayerVisibleState
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

export interface LobbyStateMessage {
  type: 'lobby_state'
  lobbyId: string
  team: TeamId
  players: { playerId: string; username: string; team: TeamId; heroId: string | null }[]
}

export interface GameStartingMessage {
  type: 'game_starting'
  gameId: string
}

export interface GameCountdownMessage {
  type: 'game_countdown'
  seconds: number
}

export interface QueueRosterMessage {
  type: 'queue_roster'
  players: { username: string; mmrBracket: string }[]
  total: number
}

export interface QueueFillingMessage {
  type: 'queue_filling'
  botsCount: number
}

export interface HeartbeatAckMessage {
  type: 'heartbeat_ack'
  timestamp: number
}

export interface ChatBroadcastMessage {
  type: 'chat'
  playerId: string
  channel: 'team' | 'all'
  message: string
}

export interface PingMapBroadcastMessage {
  type: 'ping_map'
  playerId: string
  zone: string
}

export type ServerMessage =
  | TickStateMessage
  | EventsMessage
  | AnnouncementMessage
  | GameOverMessage
  | ErrorMessage
  | QueueUpdateMessage
  | HeroPickMessage
  | LobbyStateMessage
  | GameStartingMessage
  | GameCountdownMessage
  | QueueRosterMessage
  | QueueFillingMessage
  | HeartbeatAckMessage
  | ChatBroadcastMessage
  | PingMapBroadcastMessage
