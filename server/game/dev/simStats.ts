/**
 * Aggregation for the headless bot-match simulator (`scripts/simulate-game.ts`).
 *
 * One game tells you little; balance lives in the DISTRIBUTION across many games.
 * This turns a batch of match outcomes into the numbers an owner actually needs
 * to make balance calls: side win-rate (is chaff/audit biased?), game-length
 * spread (is pacing too fast/slow/stally?), and per-hero win-rate (which heroes
 * over/under-perform). Pure + unit-tested so the simulator stays a thin caller.
 */

export interface SimResult {
  winner: 'chaff' | 'audit' | null
  /** Game length in ticks (×4s = wall-clock). */
  ticks: number
  chaffHeroes: string[]
  auditHeroes: string[]
}

interface HeroWinRate {
  heroId: string
  appearances: number
  wins: number
  /** Percent of this hero's games that its team won (0 when it never appeared). */
  winRate: number
  /**
   * True only when the win-rate clears ~2 std devs of 50% for this hero's
   * appearance count — i.e. a real over/under-performer, not small-sample noise.
   * With few appearances (the common case in a small batch) this stays false, so
   * a hero isn't tuned off a handful of games.
   */
  significant: boolean
}

export interface SimSummary {
  matches: number
  wins: { chaff: number; audit: number; none: number }
  /** Percent of DECIDED games (excludes stalls/no-winner). */
  winRate: { chaff: number; audit: number }
  /**
   * True only when the side win-rate clears ~2 std devs of a fair coin for the
   * decided sample — i.e. the imbalance is unlikely to be noise. A small batch
   * (e.g. 10/16) reads as NOT significant, so it isn't mistaken for a real bias.
   */
  sideBiasSignificant: boolean
  length: { minTicks: number; maxTicks: number; avgTicks: number; medianTicks: number }
  /** Per-hero win-rate, highest first (heroes that appeared at least once). */
  heroWinRates: HeroWinRate[]
}

export function summarizeSimResults(results: SimResult[]): SimSummary {
  const matches = results.length
  const wins = { chaff: 0, audit: 0, none: 0 }
  const lengths: number[] = []
  const appearances = new Map<string, number>()
  const heroWins = new Map<string, number>()

  for (const r of results) {
    if (r.winner === 'chaff') wins.chaff++
    else if (r.winner === 'audit') wins.audit++
    else wins.none++
    lengths.push(r.ticks)

    const tally = (heroes: string[], won: boolean) => {
      for (const h of heroes) {
        appearances.set(h, (appearances.get(h) ?? 0) + 1)
        if (won) heroWins.set(h, (heroWins.get(h) ?? 0) + 1)
      }
    }
    tally(r.chaffHeroes, r.winner === 'chaff')
    tally(r.auditHeroes, r.winner === 'audit')
  }

  const decided = wins.chaff + wins.audit
  // 2σ test against a fair coin: only flag a side bias unlikely to be noise.
  const chaffShare = decided > 0 ? wins.chaff / decided : 0.5
  const twoSigma = decided > 0 ? 2 * Math.sqrt(0.25 / decided) : Infinity
  const sideBiasSignificant = decided > 0 && Math.abs(chaffShare - 0.5) > twoSigma

  const sorted = [...lengths].sort((a, b) => a - b)
  const total = lengths.reduce((s, t) => s + t, 0)

  const heroWinRates: HeroWinRate[] = [...appearances.entries()]
    .map(([heroId, appears]) => {
      const won = heroWins.get(heroId) ?? 0
      const share = won / appears
      const significant = Math.abs(share - 0.5) > 2 * Math.sqrt(0.25 / appears)
      return { heroId, appearances: appears, wins: won, winRate: share * 100, significant }
    })
    .sort((a, b) => b.winRate - a.winRate || b.appearances - a.appearances)

  return {
    matches,
    wins,
    winRate: {
      chaff: decided > 0 ? (wins.chaff / decided) * 100 : 0,
      audit: decided > 0 ? (wins.audit / decided) * 100 : 0,
    },
    sideBiasSignificant,
    length: {
      minTicks: sorted[0] ?? 0,
      maxTicks: sorted[sorted.length - 1] ?? 0,
      avgTicks: matches > 0 ? Math.round(total / matches) : 0,
      medianTicks: sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)]! : 0,
    },
    heroWinRates,
  }
}
