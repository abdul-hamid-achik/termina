/**
 * Elo rating for 5v5 matches.
 *
 * Each player is compared against the enemy team's average MMR — the
 * standard team-Elo approximation. Beating a stronger team pays more;
 * losing to a weaker one costs more. A flat result (±25) is what this
 * replaces.
 */

const K_FACTOR = 32
const MIN_MMR = 0

/** Expected score (win probability) for a player vs an opposing rating. */
export function expectedScore(playerMmr: number, opponentMmr: number): number {
  return 1 / (1 + Math.pow(10, (opponentMmr - playerMmr) / 400))
}

/**
 * MMR delta for one player given the enemy team's average MMR and the
 * match result. Bounded to ±K.
 */
export function calculateMmrChange(
  playerMmr: number,
  enemyTeamAvgMmr: number,
  won: boolean,
): number {
  const expected = expectedScore(playerMmr, enemyTeamAvgMmr)
  const actual = won ? 1 : 0
  return Math.round(K_FACTOR * (actual - expected))
}

/** Apply a delta without letting ratings go negative. */
export function applyMmrChange(currentMmr: number, change: number): number {
  return Math.max(MIN_MMR, currentMmr + change)
}

/** Average MMR of a list of players (1000 if empty). */
export function teamAverageMmr(mmrs: number[]): number {
  if (mmrs.length === 0) return 1000
  return mmrs.reduce((sum, m) => sum + m, 0) / mmrs.length
}
