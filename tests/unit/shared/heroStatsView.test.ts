import { describe, it, expect } from 'vitest'
import { topHeroStats } from '../../../shared/heroStatsView'
import type { HeroStatRow } from '../../../shared/heroStatsView'

const row = (over: Partial<HeroStatRow>): HeroStatRow => ({
  heroId: 'x',
  gamesPlayed: 0,
  wins: 0,
  totalKills: 0,
  totalDeaths: 0,
  totalAssists: 0,
  ...over,
})

describe('topHeroStats', () => {
  it('computes whole-percent win-rate and 1-decimal KDA', () => {
    const [v] = topHeroStats([
      row({
        heroId: 'echo',
        gamesPlayed: 8,
        wins: 5,
        totalKills: 40,
        totalDeaths: 10,
        totalAssists: 20,
      }),
    ])
    expect(v).toEqual({ heroId: 'echo', games: 8, wins: 5, winRate: 63, kda: 6 }) // 5/8=62.5→63; (40+20)/10=6
  })

  it('floors deaths at 1 so a deathless record is not ÷0', () => {
    const [v] = topHeroStats([
      row({ heroId: 'a', gamesPlayed: 1, wins: 1, totalKills: 3, totalDeaths: 0, totalAssists: 2 }),
    ])
    expect(v!.kda).toBe(5) // (3+2)/1
  })

  it('sorts by games played, then win-rate, and caps at the limit', () => {
    const sorted = topHeroStats(
      [
        row({ heroId: 'few', gamesPlayed: 2, wins: 2 }),
        row({ heroId: 'most', gamesPlayed: 10, wins: 3 }),
        row({ heroId: 'mid-a', gamesPlayed: 5, wins: 4 }), // 80%
        row({ heroId: 'mid-b', gamesPlayed: 5, wins: 1 }), // 20%
      ],
      3,
    )
    expect(sorted.map((s) => s.heroId)).toEqual(['most', 'mid-a', 'mid-b'])
  })

  it('drops heroes with zero games and returns [] for an empty record', () => {
    expect(topHeroStats([row({ heroId: 'unplayed', gamesPlayed: 0 })])).toEqual([])
    expect(topHeroStats([])).toEqual([])
  })
})
