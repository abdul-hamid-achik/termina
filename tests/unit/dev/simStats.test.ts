import { describe, it, expect } from 'vitest'
import { summarizeSimResults, type SimResult } from '../../../server/game/dev/simStats'

const r = (
  winner: SimResult['winner'],
  ticks: number,
  rad: string[],
  dire: string[],
): SimResult => ({ winner, ticks, radiantHeroes: rad, direHeroes: dire })

describe('summarizeSimResults', () => {
  it('tallies side wins and the decided-only win rate (stalls excluded)', () => {
    const s = summarizeSimResults([
      r('radiant', 100, ['echo'], ['daemon']),
      r('radiant', 200, ['echo'], ['daemon']),
      r('dire', 300, ['echo'], ['daemon']),
      r(null, 400, ['echo'], ['daemon']), // stall — counted as none, out of the rate
    ])
    expect(s.matches).toBe(4)
    expect(s.wins).toEqual({ radiant: 2, dire: 1, none: 1 })
    // decided = 3 → radiant 2/3, dire 1/3
    expect(s.winRate.radiant).toBeCloseTo(66.67, 1)
    expect(s.winRate.dire).toBeCloseTo(33.33, 1)
  })

  it('computes length min / max / median / avg', () => {
    const s = summarizeSimResults([
      r('radiant', 100, ['a'], ['b']),
      r('dire', 300, ['a'], ['b']),
      r('radiant', 200, ['a'], ['b']),
    ])
    expect(s.length.minTicks).toBe(100)
    expect(s.length.maxTicks).toBe(300)
    expect(s.length.medianTicks).toBe(200)
    expect(s.length.avgTicks).toBe(200)
  })

  it('computes per-hero win rate from appearances + wins, highest first', () => {
    const s = summarizeSimResults([
      r('radiant', 100, ['winner_hero'], ['loser_hero']),
      r('radiant', 100, ['winner_hero'], ['loser_hero']),
      r('dire', 100, ['loser_hero'], ['winner_hero']), // winner_hero on the winning side again
    ])
    const wh = s.heroWinRates.find((h) => h.heroId === 'winner_hero')!
    expect(wh).toMatchObject({ appearances: 3, wins: 3, winRate: 100 })
    const lh = s.heroWinRates.find((h) => h.heroId === 'loser_hero')!
    expect(lh).toMatchObject({ appearances: 3, wins: 0, winRate: 0 })
    expect(s.heroWinRates[0]!.heroId).toBe('winner_hero') // sorted by win rate desc
  })

  it('does NOT flag a small-sample side wobble as significant (within noise)', () => {
    // 6 radiant / 10 dire over 16 decided — inside ~2σ of a fair coin, so noise.
    const results = [
      ...Array.from({ length: 6 }, () => r('radiant', 100, ['a'], ['b'])),
      ...Array.from({ length: 10 }, () => r('dire', 100, ['a'], ['b'])),
    ]
    expect(summarizeSimResults(results).sideBiasSignificant).toBe(false)
  })

  it('flags a clear, large-sample side bias as significant', () => {
    // 45 radiant / 5 dire over 50 decided — far beyond 2σ, a real imbalance.
    const results = [
      ...Array.from({ length: 45 }, () => r('radiant', 100, ['a'], ['b'])),
      ...Array.from({ length: 5 }, () => r('dire', 100, ['a'], ['b'])),
    ]
    expect(summarizeSimResults(results).sideBiasSignificant).toBe(true)
  })

  it('handles an all-stall batch (no decided games → 0% rates)', () => {
    const s = summarizeSimResults([r(null, 500, ['a'], ['b']), r(null, 600, ['a'], ['b'])])
    expect(s.wins).toEqual({ radiant: 0, dire: 0, none: 2 })
    expect(s.winRate.radiant).toBe(0)
    expect(s.winRate.dire).toBe(0)
  })

  it('handles an empty batch without dividing by zero', () => {
    const s = summarizeSimResults([])
    expect(s.matches).toBe(0)
    expect(s.length).toEqual({ minTicks: 0, maxTicks: 0, avgTicks: 0, medianTicks: 0 })
    expect(s.heroWinRates).toEqual([])
  })
})
