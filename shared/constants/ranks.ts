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

/**
 * Ordered low → high. A player's tier is the last entry whose minMmr they meet.
 *
 * The ladder is standing on the wire, not a shelf of metals. Iron → Diamond is
 * the ladder every competitive game ships and it said nothing about a
 * cable-landing city; it also carried a `scrip` id under the name "Gold", left
 * behind when the currency sweep hit the id and missed the label.
 *
 * The register climbs from having no record at all to being the reason the
 * cables come ashore here:
 *   UNLISTED   — no file on you
 *   STRINGER   — freelance, paid per job
 *   RUNNER     — trusted to carry
 *   FIXER      — trusted to arrange
 *   SHOTCALLER — trusted to decide
 *   DEEPWATER  — out past the shelf, where the trunks run
 *   LANDFALL   — where the twelve trunks come ashore. There is no higher ground.
 */
export const RANK_TIERS: RankTier[] = [
  { id: 'unlisted', name: 'Unlisted', minMmr: 0 },
  { id: 'stringer', name: 'Stringer', minMmr: 700 },
  { id: 'runner', name: 'Runner', minMmr: 1000 },
  { id: 'fixer', name: 'Fixer', minMmr: 1300 },
  { id: 'shotcaller', name: 'Shotcaller', minMmr: 1600 },
  { id: 'deepwater', name: 'Deepwater', minMmr: 1900 },
  { id: 'landfall', name: 'Landfall', minMmr: 2200 },
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
