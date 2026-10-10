/**
 * AFK detection — the pure half of the old Leaver Penalty System, driving the
 * AFK→bot takeover in server/game/engine/GameLoop.ts's processCycle.
 *
 * The Redis-backed ENFORCE half (leaver score, low-priority queue, history)
 * was already dead before the all-Vercel cutover and is gone with
 * RedisService.ts.
 *
 * PRESENCE (the connection signal). On the Workflow/Ably path there is no
 * long-lived socket to ask "is this player still here?". Instead each client
 * enters Ably presence on its own channel (`game:{gameId}:p:{playerId}`, see
 * app/composables/useGameChannel.ts), and on an AFK check cycle ONLY the tick
 * (server/workflows/gameTickCore.ts) asks Ably REST who is present — one batch
 * GET, and only for humans who could be past the AFK threshold. The answer is
 * written into the state BEFORE processCycle runs (`presenceOffline`, keyed by
 * the cycle it was sampled for), so the engine itself stays pure: it reads
 * data, never the network.
 *
 * Unknown is NOT offline: no ABLY_API_KEY (tests/local dev), a failed or slow
 * lookup, a per-channel error, or a sample stamped for another cycle all read
 * as "connected" — only the long, teammate-gated rule can fire then.
 *
 * TWO SAMPLES before an "offline" takeover. Ably presence leave is immediate
 * on a clean close, so a page reload that happened to straddle the check would
 * otherwise hand a connected player to a bot for good (no reclaim). The check
 * is therefore two cycles: the PRIMARY check (every AFK_CHECK_EVERY_CYCLES)
 * samples every idle human, and a CONFIRM check PRESENCE_CONFIRM_CYCLES later
 * re-samples ONLY those the primary found gone. "Offline" converts only when
 * both samples say so. A reload (page load + token mint + presence enter, a
 * few seconds) cannot span both. Cost: one batch Ably GET per check; the
 * confirm GET happens only when someone was actually missing at the primary.
 */

import type { GameState } from '~~/shared/types/game'
import { isBot } from '~~/server/game/ai/BotManager'
import { engineLog } from '~~/server/utils/log'

/** Silence (no deliberate order) before a DISCONNECTED player is converted. 2 min. */
const AFK_THRESHOLD_CYCLES = 30
/** A CONNECTED player gets double the window — "no order for 2 minutes" is
 *  normal for someone reading the shop or watching a fight. 4 min. */
const CONNECTED_AFK_THRESHOLD_CYCLES = AFK_THRESHOLD_CYCLES * 2
/** The PRIMARY AFK check (the connected rule + the first presence sample)
 *  runs on these cycles — shared by GameLoop and the tick so the two can
 *  never drift. */
export const AFK_CHECK_EVERY_CYCLES = 60
/** The CONFIRM sample runs this many cycles after a primary check (~20 s at
 *  4 s/cycle): long enough that no page reload spans both samples, short
 *  enough that a real disconnect is handed over barely later than before. */
export const PRESENCE_CONFIRM_CYCLES = 5

/** Is (post-increment) `cycle` a PRIMARY check? */
export function isAfkPrimaryCheck(cycle: number): boolean {
  return cycle > 0 && cycle % AFK_CHECK_EVERY_CYCLES === 0
}

/** The primary check a CONFIRM cycle belongs to, or null when `cycle` is not
 *  a confirm cycle. */
function confirmedPrimaryCycle(cycle: number): number | null {
  const primary = cycle - PRESENCE_CONFIRM_CYCLES
  return isAfkPrimaryCheck(primary) ? primary : null
}

/** Does processCycle run an AFK check on (post-increment) `cycle` — the
 *  primary or its confirm? The tick samples presence on exactly these. */
export function isAfkCheckCycle(cycle: number): boolean {
  return isAfkPrimaryCheck(cycle) || confirmedPrimaryCycle(cycle) !== null
}

/**
 * Humans worth a presence lookup for the AFK check on `atCycle`: not a bot,
 * not already taken over, and silent for at least the short threshold by then.
 * Dead players are included (they may respawn within the cycle). A superset of
 * what detectAFKPlayers will flag, so nobody it flags goes unsampled.
 *
 * On a CONFIRM cycle only the humans the primary sample recorded offline are
 * asked about again — usually nobody, so usually no Ably call at all.
 */
export function presenceCandidates(state: GameState, atCycle: number): string[] {
  const primary = confirmedPrimaryCycle(atCycle)
  const missing = primary === null ? null : new Set(state.presenceOffline?.[primary] ?? [])
  return Object.values(state.players)
    .filter(
      (p) =>
        !isBot(p.id) &&
        !p.aiControlled &&
        (missing === null || missing.has(p.id)) &&
        atCycle - (p.lastActionCycle ?? 0) >= AFK_THRESHOLD_CYCLES,
    )
    .map((p) => p.id)
}

/** Record which sampled humans Ably confirmed NOT present for `cycle`'s AFK
 *  check. An empty list records nothing (absent ⇒ connected), so the log grows
 *  only when someone is actually gone. */
export function withPresenceSample(state: GameState, cycle: number, offline: string[]): GameState {
  if (offline.length === 0) return state
  return {
    ...state,
    presenceOffline: { ...state.presenceOffline, [cycle]: [...offline].sort() },
  }
}

/** Has `playerId` been confirmed gone — absent from Ably presence at the
 *  primary check AND at this (confirm) cycle? False on any other cycle. */
export function isConfirmedOffline(state: GameState, playerId: string): boolean {
  const primary = confirmedPrimaryCycle(state.cycle)
  if (primary === null) return false
  const sampled = (cycle: number) => (state.presenceOffline?.[cycle] ?? []).includes(playerId)
  return sampled(primary) && sampled(state.cycle)
}

/**
 * Humans past the short AFK threshold (no deliberate order for
 * AFK_THRESHOLD_CYCLES). Synthesized standing-order continuations never stamp
 * lastActionCycle, but ISSUING the standing order does — so a walk or an
 * auto-attack ordered inside the window counts as activity.
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
    if (ticksSinceAction >= AFK_THRESHOLD_CYCLES) {
      afkPlayers.push({ playerId, ticksAFK: ticksSinceAction })
    }
  }

  return afkPlayers
}

/**
 * Should a player past the short AFK threshold actually be replaced by a bot?
 *
 *  - Disconnected (Ably missed them at BOTH samples of the check — GameLoop
 *    gates this with isConfirmedOffline): convert.
 *  - Connected (or unknown): convert only when BOTH
 *      · another human on the team would benefit (converting the only human
 *        in a bots match serves nobody and ruins their practice game), and
 *      · no deliberate order for the LONGER connected threshold.
 */
export function shouldConvertAFK(
  state: GameState,
  playerId: string,
  isConnected: boolean,
): boolean {
  if (!isConnected) return true

  const player = state.players[playerId]
  if (!player) return false

  const hasHumanTeammate = Object.values(state.players).some(
    (p) => p.id !== playerId && p.team === player.team && !isBot(p.id) && !p.aiControlled,
  )
  if (!hasHumanTeammate) return false

  return state.cycle - (player.lastActionCycle ?? 0) >= CONNECTED_AFK_THRESHOLD_CYCLES
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
 * Integration hook GameLoop calls per drained action. A no-op: activity is
 * lastActionCycle (stamped on GameState by GameLoop) and connection arrives as
 * state data (presenceOffline, stamped by the tick) — nothing to record here.
 */
export function markPlayerActiveSafe(_gameId: string, _playerId: string): void {
  // No-op — see module doc.
}
