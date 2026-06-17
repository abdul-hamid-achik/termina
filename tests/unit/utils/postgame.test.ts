import { describe, it, expect } from 'vitest'
import { impactScore, computeMvp, type MvpInput } from '../../../app/utils/postgame'

const p = (o: Partial<MvpInput> = {}): MvpInput => ({
  id: 'x',
  team: 'radiant',
  kills: 0,
  deaths: 0,
  assists: 0,
  heroDamage: 0,
  towerDamage: 0,
  ...o,
})

describe('impactScore', () => {
  it('weights takedowns above raw damage', () => {
    expect(impactScore(p({ kills: 5 }))).toBeGreaterThan(impactScore(p({ heroDamage: 1200 })))
  })

  it('penalises deaths', () => {
    expect(impactScore(p({ kills: 3 }))).toBeGreaterThan(impactScore(p({ kills: 3, deaths: 3 })))
  })

  it('counts assists and tower damage', () => {
    expect(impactScore(p({ assists: 3 }))).toBe(6)
    expect(impactScore(p({ towerDamage: 1000 }))).toBe(2)
  })
})

describe('computeMvp', () => {
  it('returns null for an empty roster', () => {
    expect(computeMvp([])).toBeNull()
  })

  it('crowns the highest-impact player across both teams', () => {
    const mvp = computeMvp([
      p({ id: 'a', kills: 2, assists: 1 }),
      p({ id: 'b', kills: 8, assists: 4, heroDamage: 3000 }),
      p({ id: 'c', kills: 5 }),
    ])
    expect(mvp?.id).toBe('b')
    expect(mvp?.score).toBe(impactScore(p({ kills: 8, assists: 4, heroDamage: 3000 })))
  })

  it('breaks a score tie in favour of the winning team', () => {
    const radiant = p({ id: 'r', team: 'radiant', kills: 3 })
    const dire = p({ id: 'd', team: 'dire', kills: 3 })
    expect(computeMvp([dire, radiant], 'radiant')?.id).toBe('r')
    expect(computeMvp([radiant, dire], 'dire')?.id).toBe('d')
  })

  it('keeps the first leader when there is no winner to break a tie', () => {
    const a = p({ id: 'a', kills: 3 })
    const b = p({ id: 'b', team: 'dire', kills: 3 })
    expect(computeMvp([a, b])?.id).toBe('a')
  })
})
