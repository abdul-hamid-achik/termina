import type { Command } from './commands'
import type { GameEvent, TeamId, PlayerVisibleState } from './game'

// ── Client → Server ──────────────────────────────────────────────

export type ClientMessage =
  // `forCycle` stamps the order with the cycle the client saw OPEN when it was
  // typed; the server rejects it explicitly (action_ack accepted:false) if that
  // batch has already committed ('late') or hasn't opened yet ('future') —
  // instead of silently rolling it into a batch the player didn't aim at.
  // `clientSeq` is an opaque correlation number echoed back in action_ack.
  | { type: 'action'; command: Command; forCycle?: number; clientSeq?: number }
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
  /** Epoch ms when this cycle's window commits (the next batch boundary).
   * Drives the HUD's CYCLE clock countdown; absent on manual-tick dev games. */
  nextCommitAt?: number
  state: PlayerVisibleState
}

/**
 * The server's receipt for one order: which slot it landed in for the open
 * cycle and whether it replaced an earlier order in that slot — or why it was
 * refused. THE BATCH CLOCK IS CANON: an ack is the only honest way to tell the
 * player "your instruction is in this batch" before the batch commits.
 */
export interface ActionAckMessage {
  type: 'action_ack'
  accepted: boolean
  /** The cycle currently open on the server. Absent on manual-tick dev games. */
  cycle?: number
  /** The queue slot the order landed in ('main', 'item', ...). Accepted only. */
  slot?: string
  /** True when this order replaced an earlier one in the same slot this cycle. */
  replaced?: boolean
  /** Rejection reason: 'late' (that batch already committed) or 'future'. */
  reason?: 'late' | 'future'
  /** Echo of the client's correlation number, when it sent one. */
  clientSeq?: number
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

/** Server-side liveness probe for adapters without native ping/pong. */
export interface HeartbeatProbeMessage {
  type: 'heartbeat'
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

/**
 * Sent instead of (or in addition to, on later cycles) a `spectator_tick` when
 * a newly-subscribed spectator has no MATURE frame to show yet — i.e. the game
 * is younger than the global broadcast delay (see
 * shared/constants/balance.ts SPECTATOR_BROADCAST_DELAY_MS). Tells the client
 * how long until the first frame arrives so the UI can show a countdown
 * instead of sitting on "waiting for first cycle" indefinitely.
 */
export interface SpectatorDelayedMessage {
  type: 'spectator_delayed'
  gameId: string
  /** Milliseconds until the first mature frame is expected to arrive. */
  etaMs: number
}

/**
 * The final message a spectator receives for a game: delivered only after
 * every already-buffered `spectator_tick` frame has drained through the same
 * broadcast delay, so a spectator can never learn the result before players
 * genuinely could have. No stats — spectators aren't ranked participants;
 * the winner is enough to close out the view.
 */
export interface SpectatorGameOverMessage {
  type: 'spectator_game_over'
  gameId: string
  winner: TeamId
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
  | ActionAckMessage
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
  | HeartbeatProbeMessage
  | ChatBroadcastMessage
  | PingMapBroadcastMessage
  | FullStateMessage
  | GameNotFoundMessage
  | SpectatorCycleMessage
  | SpectatorAckMessage
  | SpectatorDelayedMessage
  | SpectatorGameOverMessage
  | PlayerDisconnectMessage
  | PlayerReconnectMessage
  | LobbyCancelledMessage
