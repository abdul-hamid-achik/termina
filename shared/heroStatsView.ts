// Pure presentation of a player's per-hero record for the profile page.
// Lives in shared/ so the view logic (sort + win-rate + KDA + top-N) is unit
// tested independently of the page and the DB row shape.

/** The per-hero stat row as stored (subset of the hero_stats table). */
export interface HeroStatRow {
  heroId: string
  gamesPlayed: number
  wins: number
  totalKills: number
  totalDeaths: number
  totalAssists: number
}

/** A hero's record shaped for display. */
export interface HeroStatView {
  heroId: string
  games: number
  wins: number
  winRate: number // whole-number percent
  kda: number // (kills + assists) / max(1, deaths), 1 decimal
}

/** Average KDA ratio — deaths floored at 1 so a deathless record isn't ÷0. */
function kdaRatio(kills: number, deaths: number, assists: number): number {
  return Math.round(((kills + assists) / Math.max(1, deaths)) * 10) / 10
}

/**
 * A player's most-played heroes, shaped for display: win-rate + KDA computed,
 * sorted by games played (ties broken by win-rate), capped at `limit`. Rows with
 * zero games are dropped (nothing to show). Pure — safe to unit test.
 */
export function topHeroStats(stats: HeroStatRow[], limit = 6): HeroStatView[] {
  return stats
    .filter((s) => s.gamesPlayed > 0)
    .map((s) => ({
      heroId: s.heroId,
      games: s.gamesPlayed,
      wins: s.wins,
      winRate: Math.round((s.wins / s.gamesPlayed) * 100),
      kda: kdaRatio(s.totalKills, s.totalDeaths, s.totalAssists),
    }))
    .sort((a, b) => b.games - a.games || b.winRate - a.winRate)
    .slice(0, limit)
}
