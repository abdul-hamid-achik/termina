/**
 * AFK detection — the pure, in-memory half of the old Leaver Penalty System.
 *
 * The Redis-backed ENFORCE half (leaver score, low-priority queue, leaver
 * history — getPlayerPenalty/isLowPriority/decayLeaverScores/
 * completeLowPriorityGame/getPlayerLeaverHistory/markPlayerActive/
 * recordLeaver) was already dead before this cutover (see
 * termina-leaver-system-halfwired note: it recorded abandons but nothing
 * ever enforced a penalty) and is deleted along with RedisService.ts.
 *
 * What's left is what server/game/engine/GameLoop.ts's processCycle actually
 * calls every cycle to drive the AFK→bot takeover feature:
 *  - detectAFKPlayers / shouldConvertAFK: pure GameState → decision.
 *  - markClientInput / msSinceClientInput / clearClientInput: an in-memory
 *    "deliberate input" ledger. It used to be stamped by ws.ts on every
 *    action/chat/ping message; there is no WS connection on the Workflow
 *    path to stamp it from, so it now sits permanently empty — every
 *    presence check degrades to `msSinceInput: null` (see GameLoop.ts's
 *    caller, which also has no live-peer signal to feed `isConnected`
 *    either). The AFK→bot conversion itself still works — it just always
 *    takes the "not connected" branch of shouldConvertAFK now. Wiring an
 *    Ably-presence signal back into this ledger is a follow-up (tracked in
 *    server/workflows/gameTickCore.ts's TODOs), not a regression introduced
 *    here: the ledger's shape is kept so that follow-up only needs a new
 *    caller, not a new mechanism.
 */

import type { GameState } from '~~/shared/types/game'
import { isBot } from '~~/server/game/ai/BotManager'
import { CYCLE_DURATION_MS } from '~~/shared/constants/balance'
import { engineLog } from '~~/server/utils/log'

const AFK_THRESHOLD_TICKS = 30 // 2 minutes at 4s/cycle
// A CONNECTED player gets double the window before takeover — "no game action
// for 2 minutes" is normal for someone reading the shop or watching a fight.
const CONNECTED_AFK_THRESHOLD_TICKS = AFK_THRESHOLD_TICKS * 2

// ── Client presence ledger (in-memory) ─────────────────────────
// Wall-clock timestamp of the last DELIBERATE client input per game+player
// (an action, a chat message, a map ping — NOT the automatic heartbeat).
// Lets the AFK takeover distinguish "present but between actions" from
// "gone": someone still touching the game is presence, even when their last
// drained game action is minutes old.
const clientInputAt = new Map<string, number>()
const inputKey = (gameId: string, playerId: string) => `${gameId}:${playerId}`

/** Record a deliberate client input. */
export function markClientInput(gameId: string, playerId: string): void {
  clientInputAt.set(inputKey(gameId, playerId), Date.now())
}

/** ms since the player's last deliberate input this game, or null if none yet. */
export function msSinceClientInput(gameId: string, playerId: string): number | null {
  const at = clientInputAt.get(inputKey(gameId, playerId))
  return at == null ? null : Date.now() - at
}

/** Drop a finished game's presence entries (call alongside BotManager.cleanupGame). */
export function clearClientInput(gameId: string): void {
  const prefix = `${gameId}:`
  for (const key of clientInputAt.keys()) {
    if (key.startsWith(prefix)) clientInputAt.delete(key)
  }
}

/**
 * Check for AFK players in the game.
 * Called every cycle to track player activity.
 */
export function detectAFKPlayers(state: GameState): Array<{ playerId: string; ticksAFK: number }> {
  const afkPlayers: Array<{ playerId: string; ticksAFK: number }> = []

  for (const [playerId, player] of Object.entries(state.players)) {
    if (!player.alive) continue
    if (isBot(playerId)) continue
    // Already replaced by a bot (AFK takeover) — a bot plays this slot now, so
    // it is no longer "AFK". Keeps the takeover + leaver record firing once.
    if (player.aiControlled) continue

    // lastActionCycle is stamped in GameLoop when actions are drained.
    // A player who has never acted counts as AFK since game start (cycle 0).
    const lastActionCycle = player.lastActionCycle ?? 0

    const ticksSinceAction = state.cycle - lastActionCycle
    if (ticksSinceAction >= AFK_THRESHOLD_TICKS) {
      afkPlayers.push({ playerId, ticksAFK: ticksSinceAction })
    }
  }

  return afkPlayers
}

/**
 * Should a player past the action-AFK threshold actually be replaced by a bot?
 *
 * `detectAFKPlayers` only knows "no game action for N ticks", which false-
 * positives on a player who is present but idle — reading the shop, watching a
 * fight, typing chat. This gate adds presence:
 *
 *  - Disconnected (no live presence signal): convert — the original rule.
 *  - Connected: convert only when ALL of
 *      · another human on the team would benefit (converting the only human
 *        in a bots match serves nobody and ruins their practice game),
 *      · no game action for the LONGER connected threshold, and
 *      · no deliberate client input (action/chat/ping) in that same window.
 */
export function shouldConvertAFK(
  state: GameState,
  playerId: string,
  presence: { isConnected: boolean; msSinceInput: number | null },
): boolean {
  if (!presence.isConnected) return true

  const player = state.players[playerId]
  if (!player) return false

  const hasHumanTeammate = Object.values(state.players).some(
    (p) => p.id !== playerId && p.team === player.team && !isBot(p.id) && !p.aiControlled,
  )
  if (!hasHumanTeammate) return false

  const ticksSinceAction = state.cycle - (player.lastActionCycle ?? 0)
  if (ticksSinceAction < CONNECTED_AFK_THRESHOLD_TICKS) return false

  return (
    presence.msSinceInput == null ||
    presence.msSinceInput >= CONNECTED_AFK_THRESHOLD_TICKS * CYCLE_DURATION_MS
  )
}

/**
 * Record a leaver event (log-only). The Redis-backed penalty ledger this used
 * to feed is gone (see module doc) — this is now purely observability.
 */
export function recordLeaverSafe(
  playerId: string,
  gameId: string,
  _state: GameState,
  reason: 'afk' | 'disconnect' | 'feed' | 'grief' = 'afk',
): void {
  engineLog.warn('Leaver detected', { playerId, gameId, reason })
}

/**
 * Integration: track player actions to detect AFK. Kept as a no-op stub —
 * lastActionCycle (stamped directly on GameState by GameLoop) is what
 * detectAFKPlayers actually reads; this hook exists for a future presence
 * signal to plug into without touching GameLoop's call site.
 */
export function markPlayerActiveSafe(_gameId: string, _playerId: string): void {
  // No-op — see module doc.
}
