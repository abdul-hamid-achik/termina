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
  { id: 'gold', name: 'Gold', minMmr: 1300 },
  { id: 'platinum', name: 'Platinum', minMmr: 1600 },
  { id: 'diamond', name: 'Diamond', minMmr: 1900 },
  { id: 'terminal', name: 'Terminal', minMmr: 2200 },
]

/** Resolve the rank tier for a given (seasonal) MMR. */
export function getRankTier(mmr: number): RankTier {
  let tier = RANK_TIERS[0]!
  for (const t of RANK_TIERS) {
    if (mmr >= t.minMmr) tier = t
  }
  return tier
}
