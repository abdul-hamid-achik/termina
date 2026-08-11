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
// The WS-era variants (reconnect/join_game/hero_pick/hero_ban/request_state/
// spectate/unspectate/heartbeat) died with the DO WebSocket server — on the
// Ably+HTTP transport connection recovery is Ably's job and drafting/
// spectating have no serverless port yet. Re-add shapes WITH their transport
// when those features return.

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

// The WS-era queue/draft (queue_update, hero_pick/ban, pick/ban_turn,
// lobby_state, game_starting, game_countdown, queue_roster, queue_filling,
// lobby_cancelled), spectator (spectator_tick/ack/delayed/game_over),
// connection-lifecycle (player_disconnect/reconnect, full_state,
// game_not_found) and heartbeat message shapes were deleted with their WS
// producers in the all-Vercel cutover — nothing on the Ably+HTTP path ever
// constructs them. Rebuild shapes alongside their transport when a
// serverless draft/spectate returns.
export type ServerMessage =
  | CycleStateMessage
  | ActionAckMessage
  | EventsMessage
  | AnnouncementMessage
  | GameOverMessage
  | ErrorMessage
  | ChatBroadcastMessage
  | PingMapBroadcastMessage
