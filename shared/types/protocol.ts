import type { Command } from './commands'
import type { GameEvent, TeamId, PlayerVisibleState } from './game'

// ── Client → Server ──────────────────────────────────────────────

export type ClientMessage =
  | { type: 'action'; command: Command }
  | { type: 'chat'; channel: 'team' | 'all'; message: string }
  | { type: 'ping_map'; zone: string }
  | { type: 'heartbeat' }
  | { type: 'reconnect'; gameId: string; playerId: string; lastCycle?: number }
  | { type: 'join_game'; gameId: string }
  | { type: 'hero_pick'; lobbyId: string; heroId: string }
  | { type: 'hero_ban'; lobbyId: string; heroId: string }
  | { type: 'request_state' }
  | { type: 'spectate'; gameId: string }
  | { type: 'unspectate' }

// ── Server → Client ──────────────────────────────────────────────

export interface CycleStateMessage {
  type: 'cycle_state'
  cycle: number
  state: PlayerVisibleState
}

export interface EventsMessage {
  type: 'events'
  cycle: number
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
  /** The recipient's own Elo change for this match (sent per-peer). */
  mmrChange?: number
  /** False when the match contained bots (practice / bot-filled) and therefore
   * did not affect MMR — the post-game screen shows "unranked" instead of a number. */
  ranked?: boolean
  /** Length of the match in cycles. Without it the post-game screen can only show
   * totals, and a total is unreadable as progress: 40 last hits is a good 10
   * minutes and a poor 30. Everything rate-based on that screen derives from it. */
  durationCycles?: number
}

export interface PlayerEndStats {
  kills: number
  deaths: number
  assists: number
  /** Gold still UNSPENT at the final cycle — a wallet balance, not earnings.
   * Read `netWorth` for "how well did this player farm"; a player who converted
   * every coin into items ends the match with the smallest `scrip` on the board. */
  scrip: number
  items: (string | null)[]
  heroDamage: number
  iceDamage: number
  /**
   * The four fields below are optional so the shared story/test fixtures and any
   * client running against an older server keep type-checking; the server sets
   * all of them on every game_over and the post-game screen falls back to 0.
   */
  /** Wave kills ("CS") — with `burns`, the pair of numbers a new MOBA player
   * most needs to watch improve, and the only ones the old payload omitted. */
  lastHits?: number
  burns?: number
  /** Unspent scrip plus the full cost of every item owned. */
  netWorth?: number
  level?: number
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

export interface HeroBanMessage {
  type: 'hero_ban'
  playerId: string
  heroId: string
}

export interface PickTurnMessage {
  type: 'pick_turn'
  /** The player whose turn it is to pick. */
  playerId: string
  username: string
  /** Time until the server auto-picks for them (ms). */
  timeRemainingMs: number
}

export interface BanTurnMessage {
  type: 'ban_turn'
  /** The player whose turn it is to ban. */
  playerId: string
  username: string
  /** Time until the server auto-bans for them (ms). */
  timeRemainingMs: number
}

export interface LobbyStateMessage {
  type: 'lobby_state'
  lobbyId: string
  team: TeamId
  players: { playerId: string; username: string; team: TeamId; heroId: string | null }[]
  phase?: 'banning' | 'picking'
  /** Heroes banned so far (only meaningful during/after the ban phase). */
  bans?: string[]
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

export interface FullStateMessage {
  type: 'full_state'
  cycle: number
  state: PlayerVisibleState
}

export interface GameNotFoundMessage {
  type: 'game_not_found'
  gameId: string
}

export interface SpectatorCycleMessage {
  type: 'spectator_tick'
  cycle: number
  /**
   * Spectators receive a `PlayerVisibleState` with all players/zones revealed
   * — same shape as the in-game cycle_state so the renderer can be reused.
   */
  state: PlayerVisibleState
}

export interface SpectatorAckMessage {
  type: 'spectator_ack'
  gameId: string
}

/** Broadcast to the surviving players when someone drops their connection. */
export interface PlayerDisconnectMessage {
  type: 'player_disconnect'
  playerId: string
}

/** Broadcast to the game when a previously-dropped player reconnects in time. */
export interface PlayerReconnectMessage {
  type: 'player_reconnect'
  playerId: string
}

/** The server tore down a forming lobby (e.g. a drafter never reconnected past
 *  the grace window). The client resets its lobby store back to find-match so a
 *  surviving player isn't frozen on the draft/found/starting screen. */
export interface LobbyCancelledMessage {
  type: 'lobby_cancelled'
  reason: string
}

export type ServerMessage =
  | CycleStateMessage
  | EventsMessage
  | AnnouncementMessage
  | GameOverMessage
  | ErrorMessage
  | QueueUpdateMessage
  | HeroPickMessage
  | HeroBanMessage
  | PickTurnMessage
  | BanTurnMessage
  | LobbyStateMessage
  | GameStartingMessage
  | GameCountdownMessage
  | QueueRosterMessage
  | QueueFillingMessage
  | HeartbeatAckMessage
  | ChatBroadcastMessage
  | PingMapBroadcastMessage
  | FullStateMessage
  | GameNotFoundMessage
  | SpectatorCycleMessage
  | SpectatorAckMessage
  | PlayerDisconnectMessage
  | PlayerReconnectMessage
  | LobbyCancelledMessage
