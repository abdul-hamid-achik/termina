/**
 * Competitive rank tiers, derived purely from a player's seasonal MMR
 * (players.seasonMmr). No DB column stores the rank — it's computed on read so
 * tier thresholds can be retuned without a migration. The seasonal ladder
 * starts at 1000, so the bands are centered around that baseline.
 */

export interface RankTier {
  /** Stable id (for keys/icons). */
  id: string
  /** Display name. */
  name: string
  /** Inclusive lower MMR bound for this tier. */
  minMmr: number
}

/** Ordered low → high. A player's tier is the last entry whose minMmr they meet. */
export const RANK_TIERS: RankTier[] = [
  { id: 'iron', name: 'Iron', minMmr: 0 },
  { id: 'bronze', name: 'Bronze', minMmr: 700 },
  { id: 'silver', name: 'Silver', minMmr: 1000 },
  { id: 'scrip', name: 'Gold', minMmr: 1300 },
  { id: 'platinum', name: 'Platinum', minMmr: 1600 },
  { id: 'diamond', name: 'Diamond', minMmr: 1900 },
  { id: 'terminal', name: 'Terminal', minMmr: 2200 },
]

/**
 * Season games a player must finish before they appear on the ladder.
 *
 * Without this the leaderboard is a registration list: every account that has
 * ever signed up sits at the 1000 baseline with 0-0 and a SILVER tier, so the
 * board opens on a wall of identical rows that say nothing about anybody. A
 * placement requirement is also what makes the top of the board mean something
 * on day one — an unplayed 1000 would otherwise outrank a real player who lost
 * their first match.
 */
export const PLACEMENT_GAMES = 3

/** Resolve the rank tier for a given (seasonal) MMR. */
export function getRankTier(mmr: number): RankTier {
  let tier = RANK_TIERS[0]!
  for (const t of RANK_TIERS) {
    if (mmr >= t.minMmr) tier = t
  }
  return tier
}
