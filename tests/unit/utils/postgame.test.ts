import { describe, it, expect } from 'vitest'
import {
  impactScore,
  computeMvp,
  deriveAdvice,
  type AdviceStats,
  type MvpInput,
} from '~~/app/utils/postgame'
import { useCommands } from '~~/app/composables/useCommands'

const p = (o: Partial<MvpInput> = {}): MvpInput => ({
  id: 'x',
  team: 'chaff',
  kills: 0,
  deaths: 0,
  assists: 0,
  heroDamage: 0,
  iceDamage: 0,
  ...o,
})

describe('impactScore', () => {
  it('weights takedowns above raw damage', () => {
    expect(impactScore(p({ kills: 5 }))).toBeGreaterThan(impactScore(p({ heroDamage: 1200 })))
  })

  it('penalises deaths', () => {
    expect(impactScore(p({ kills: 3 }))).toBeGreaterThan(impactScore(p({ kills: 3, deaths: 3 })))
  })

  it('counts assists and ice damage', () => {
    expect(impactScore(p({ assists: 3 }))).toBe(6)
    expect(impactScore(p({ iceDamage: 1000 }))).toBe(2)
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
    const chaff = p({ id: 'r', team: 'chaff', kills: 3 })
    const audit = p({ id: 'd', team: 'audit', kills: 3 })
    expect(computeMvp([audit, chaff], 'chaff')?.id).toBe('r')
    expect(computeMvp([chaff, audit], 'audit')?.id).toBe('d')
  })

  it('keeps the first leader when there is no winner to break a tie', () => {
    const a = p({ id: 'a', kills: 3 })
    const b = p({ id: 'b', team: 'audit', kills: 3 })
    expect(computeMvp([a, b])?.id).toBe('a')
  })
})

describe('computeMvp: the winning team (playtest 3)', () => {
  it('never crowns a loser over a victory, however well they played', () => {
    const loserBot = p({ id: 'bot_zeta', team: 'audit', kills: 12, heroDamage: 9000 })
    const winner = p({ id: 'me', team: 'chaff', kills: 1 })
    expect(computeMvp([loserBot, winner], 'chaff')?.id).toBe('me')
  })

  it('falls back to the whole roster when the winner has nobody listed', () => {
    const a = p({ id: 'a', team: 'audit', kills: 2 })
    expect(computeMvp([a], 'chaff')?.id).toBe('a')
  })
})

describe('deriveAdvice', () => {
  const stats = (o: Partial<AdviceStats> = {}): AdviceStats => ({
    kills: 4,
    deaths: 1,
    assists: 3,
    scrip: 100,
    heroDamage: 5000,
    lastHits: 60,
    burns: 4,
    items: [],
    ...o,
  })
  const ids = (s: AdviceStats, rate: number | null = 3) =>
    deriveAdvice(s, { csPerMinute: rate, enemyHandle: 'daemon', shopItem: 'edge_kit' }).map(
      (a) => a.id,
    )

  it('the playtest game: unspent, deaths, no hero damage — not wave:0 drills', () => {
    const playtest = stats({
      kills: 0,
      assists: 0,
      deaths: 2,
      heroDamage: 0,
      scrip: 1724,
      lastHits: 3,
      burns: 0,
    })
    expect(ids(playtest, 0.6)).toEqual(['unspent', 'deaths', 'no-hero-damage'])
  })

  it('each problem maps to its command', () => {
    const all = deriveAdvice(stats({ scrip: 900, deaths: 7, heroDamage: 0 }), {
      csPerMinute: 3,
      enemyHandle: 'daemon',
      shopItem: 'edge_kit',
    })
    const byId = Object.fromEntries(all.map((a) => [a.id, a]))
    expect(byId.unspent?.command).toBe('buy edge_kit')
    expect(byId.deaths?.command).toBe('move terminal')
    expect(byId['no-hero-damage']?.command).toBe('breach daemon')
    expect(byId['no-hero-damage']?.followUp).toBe('cast q')
  })

  it('low farm → the strip; burns only once the farm is fine', () => {
    expect(ids(stats({ lastHits: 5, burns: 0 }), 0.5)).toEqual(['last-hits'])
    expect(ids(stats({ burns: 0 }), 3)).toEqual(['burns'])
  })

  it('a few deaths that bought takedowns are not the problem', () => {
    expect(ids(stats({ deaths: 3, kills: 2, assists: 4 }))).not.toContain('deaths')
  })

  it('a clean game still gets one next step, and never more than three lines', () => {
    expect(ids(stats())).toEqual(['next'])
    const worst = stats({ scrip: 5000, deaths: 9, kills: 0, heroDamage: 0, lastHits: 0, burns: 0 })
    expect(ids(worst, 0)).toHaveLength(3)
  })

  it('every command it offers parses', () => {
    const { parse } = useCommands()
    const all = [
      ...deriveAdvice(stats({ scrip: 5000, deaths: 9, kills: 0, heroDamage: 0 }), {
        csPerMinute: 0,
        enemyHandle: 'daemon',
        shopItem: 'edge_kit',
      }),
      ...deriveAdvice(stats({ lastHits: 2, burns: 0 }), { csPerMinute: 0.2 }),
      ...deriveAdvice(stats({ burns: 0 }), { csPerMinute: 3 }),
      ...deriveAdvice(stats(), { csPerMinute: 3 }),
    ]
    for (const a of all) {
      for (const cmd of [a.command, a.followUp].filter(Boolean) as string[]) {
        expect(parse(cmd, 'chaff').error, `${a.id}: ${cmd}`).toBeNull()
      }
    }
  })
})
