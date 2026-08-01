import type { GameMode } from '~~/shared/types/game'

/**
 * Rejection-message escalation (playability ledger): the same rejection repeats
 * verbatim while a player keeps making the same mistake, so a player wrong
 * twice needs a different message the third time. Only the THIRD identical
 * rejection gets a hint suffix — the first two stay as-is (they are already
 * specific), and a player who keeps failing after the hint is past help.
 *
 * Keyed by gameId|playerId|normalised-reason so two players failing in the
 * same match, or two different mistakes, never cross-contaminate. Tutorial
 * lock messages are excluded at the call site (they are teaching, not failure).
 */

const counts = new Map<string, number>()

function keyOf(gameId: string, playerId: string, reason: string): string {
  const norm = reason.toLowerCase().replace(/\s+/g, ' ').trim()
  return `${gameId}|${playerId}|${norm}`
}

export function escalateRejection(
  gameId: string,
  mode: GameMode | undefined,
  playerId: string,
  reason: string,
): string {
  if (mode === 'tutorial') return reason
  const key = keyOf(gameId, playerId, reason)
  const n = (counts.get(key) ?? 0) + 1
  counts.set(key, n)
  return n === 3 ? `${reason} — third time: type \`help\` (or \`?\`) for the command list` : reason
}

/** Drop a game's counters when it ends, so a future match starts clean. */
export function clearRejectionEscalation(gameId: string): void {
  const prefix = `${gameId}|`
  for (const k of counts.keys()) {
    if (k.startsWith(prefix)) counts.delete(k)
  }
}
