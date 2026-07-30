import { describe, it, expect } from 'vitest'
import { summarizeSimResults, type SimResult } from '~~/server/game/dev/simStats'

const r = (
  winner: SimResult['winner'],
  ticks: number,
  chaff: string[],
  audit: string[],
): SimResult => ({ winner, ticks, chaffHeroes: chaff, auditHeroes: audit })

describe('summarizeSimResults', () => {
  it('tallies side wins and the decided-only win rate (stalls excluded)', () => {
    const s = summarizeSimResults([
      r('chaff', 100, ['echo'], ['daemon']),
      r('chaff', 200, ['echo'], ['daemon']),
      r('audit', 300, ['echo'], ['daemon']),
      r(null, 400, ['echo'], ['daemon']), // stall — counted as none, out of the rate
    ])
    expect(s.matches).toBe(4)
    expect(s.wins).toEqual({ chaff: 2, audit: 1, none: 1 })
    // decided = 3 → chaff 2/3, audit 1/3
    expect(s.winRate.chaff).toBeCloseTo(66.67, 1)
    expect(s.winRate.audit).toBeCloseTo(33.33, 1)
  })

  it('computes length min / max / median / avg', () => {
    const s = summarizeSimResults([
      r('chaff', 100, ['a'], ['b']),
      r('audit', 300, ['a'], ['b']),
      r('chaff', 200, ['a'], ['b']),
    ])
    expect(s.length.minTicks).toBe(100)
    expect(s.length.maxTicks).toBe(300)
    expect(s.length.medianTicks).toBe(200)
    expect(s.length.avgTicks).toBe(200)
  })

  it('computes per-hero win rate from appearances + wins, highest first', () => {
    const s = summarizeSimResults([
      r('chaff', 100, ['winner_hero'], ['loser_hero']),
      r('chaff', 100, ['winner_hero'], ['loser_hero']),
      r('audit', 100, ['loser_hero'], ['winner_hero']), // winner_hero on the winning side again
    ])
    const wh = s.heroWinRates.find((h) => h.heroId === 'winner_hero')!
    expect(wh).toMatchObject({ appearances: 3, wins: 3, winRate: 100 })
    const lh = s.heroWinRates.find((h) => h.heroId === 'loser_hero')!
    expect(lh).toMatchObject({ appearances: 3, wins: 0, winRate: 0 })
    expect(s.heroWinRates[0]!.heroId).toBe('winner_hero') // sorted by win rate desc
  })

  it('does NOT flag a small-sample side wobble as significant (within noise)', () => {
    // 6 chaff / 10 audit over 16 decided — inside ~2σ of a fair coin, so noise.
    const results = [
      ...Array.from({ length: 6 }, () => r('chaff', 100, ['a'], ['b'])),
      ...Array.from({ length: 10 }, () => r('audit', 100, ['a'], ['b'])),
    ]
    expect(summarizeSimResults(results).sideBiasSignificant).toBe(false)
  })

  it('flags a clear, large-sample side bias as significant', () => {
    // 45 chaff / 5 audit over 50 decided — far beyond 2σ, a real imbalance.
    const results = [
      ...Array.from({ length: 45 }, () => r('chaff', 100, ['a'], ['b'])),
      ...Array.from({ length: 5 }, () => r('audit', 100, ['a'], ['b'])),
    ]
    expect(summarizeSimResults(results).sideBiasSignificant).toBe(true)
  })

  it('flags a hero as significant only when its win-rate clears small-sample noise', () => {
    // "star" appears 40× (always chaff) and wins 35 → 87.5%, well beyond 2σ.
    // "filler" appears 40× (always audit) and wins 5 → 12.5%, also significant.
    const results = [
      ...Array.from({ length: 35 }, () => r('chaff', 100, ['star'], ['filler'])),
      ...Array.from({ length: 5 }, () => r('audit', 100, ['star'], ['filler'])),
    ]
    const byHero = (id: string) =>
      summarizeSimResults(results).heroWinRates.find((h) => h.heroId === id)!
    expect(byHero('star')).toMatchObject({ appearances: 40, wins: 35, significant: true })
    expect(byHero('filler')).toMatchObject({ appearances: 40, wins: 5, significant: true })
  })

  it('does NOT flag a hero off a handful of games', () => {
    // "rare" appears 3× — far too few to clear 2σ regardless of its record.
    const results = [
      r('chaff', 100, ['rare'], ['x']),
      r('chaff', 100, ['rare'], ['x']),
      r('audit', 100, ['x'], ['rare']),
    ]
    expect(
      summarizeSimResults(results).heroWinRates.find((h) => h.heroId === 'rare')!.significant,
    ).toBe(false)
  })

  it('handles an all-stall batch (no decided games → 0% rates)', () => {
    const s = summarizeSimResults([r(null, 500, ['a'], ['b']), r(null, 600, ['a'], ['b'])])
    expect(s.wins).toEqual({ chaff: 0, audit: 0, none: 2 })
    expect(s.winRate.chaff).toBe(0)
    expect(s.winRate.audit).toBe(0)
  })

  it('handles an empty batch without dividing by zero', () => {
    const s = summarizeSimResults([])
    expect(s.matches).toBe(0)
    expect(s.length).toEqual({ minTicks: 0, maxTicks: 0, avgTicks: 0, medianTicks: 0 })
    expect(s.heroWinRates).toEqual([])
  })
})
