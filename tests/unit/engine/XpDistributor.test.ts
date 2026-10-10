import { describe, it, expect } from 'vitest'
import {
  awardXp,
  awardZoneXp,
  catchupXp,
  xpCatchupMultiplier,
} from '~~/server/game/engine/XpDistributor'
import type { PlayerState } from '~~/shared/types/game'
import { XP_CATCHUP_MAX, XP_CATCHUP_PER_LEVEL } from '~~/shared/constants/balance'

function hero(id: string, overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id,
    name: id,
    team: 'chaff',
    heroId: 'echo',
    zone: 'coldstore-t1-chaff',
    integ: 500,
    maxInteg: 500,
    bw: 200,
    maxBw: 200,
    level: 1,
    xp: 0,
    scrip: 600,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnCycle: null,
    plate: 3,
    ice: 15,
    kills: 0,
    deaths: 0,
    assists: 0,
    damageDealt: 0,
    iceDamageDealt: 0,
    killStreak: 0,
    ...overrides,
  }
}

function roster(...ps: PlayerState[]): Record<string, PlayerState> {
  return Object.fromEntries(ps.map((p) => [p.id, p]))
}

describe('xpCatchupMultiplier — individual catch-up against your own team', () => {
  it('is +XP_CATCHUP_PER_LEVEL per level behind the teammates’ average', () => {
    // Teammates average 3; me at 2 → one level behind.
    const players = roster(
      hero('me', { level: 2 }),
      hero('a', { level: 2 }),
      hero('b', { level: 4 }),
    )
    expect(xpCatchupMultiplier(players, 'me')).toBeCloseTo(1 + XP_CATCHUP_PER_LEVEL, 10)
  })

  it('scales with FRACTIONAL levels behind', () => {
    // Teammates average (2+3)/2 = 2.5; me at 2 → 0.5 behind → ×1.25.
    const players = roster(
      hero('me', { level: 2 }),
      hero('a', { level: 2 }),
      hero('b', { level: 3 }),
    )
    expect(xpCatchupMultiplier(players, 'me')).toBeCloseTo(1 + 0.5 * XP_CATCHUP_PER_LEVEL, 10)
  })

  it('excludes the hero themself from the average (L1 vs one L3 ally is 2 behind, not 1)', () => {
    const players = roster(hero('me', { level: 1 }), hero('a', { level: 3 }))
    expect(xpCatchupMultiplier(players, 'me')).toBeCloseTo(1 + 2 * XP_CATCHUP_PER_LEVEL, 10)
  })

  it('counts DEAD teammates — dying does not drop you out of the average', () => {
    const players = roster(
      hero('me', { level: 1 }),
      hero('a', { level: 1 }),
      hero('dead', { level: 3, alive: false, integ: 0 }),
    )
    // Avg (1+3)/2 = 2 → 1 behind.
    expect(xpCatchupMultiplier(players, 'me')).toBeCloseTo(1 + XP_CATCHUP_PER_LEVEL, 10)
  })

  it('ignores the enemy team entirely', () => {
    const players = roster(
      hero('me', { level: 3 }),
      hero('a', { level: 3 }),
      hero('enemy', { team: 'audit', level: 12 }),
    )
    expect(xpCatchupMultiplier(players, 'me')).toBe(1)
  })

  it('is capped at XP_CATCHUP_MAX', () => {
    const players = roster(hero('me', { level: 1 }), hero('a', { level: 10 }))
    expect(xpCatchupMultiplier(players, 'me')).toBe(XP_CATCHUP_MAX)
  })

  it('never drops below 1 for a hero AHEAD of their team', () => {
    const players = roster(hero('me', { level: 9 }), hero('a', { level: 2 }))
    expect(xpCatchupMultiplier(players, 'me')).toBe(1)
  })

  it('is exactly 1 at the average, alone on a team, or for an unknown id', () => {
    expect(
      xpCatchupMultiplier(roster(hero('me', { level: 4 }), hero('a', { level: 4 })), 'me'),
    ).toBe(1)
    expect(
      xpCatchupMultiplier(roster(hero('me'), hero('enemy', { team: 'audit', level: 9 })), 'me'),
    ).toBe(1)
    expect(xpCatchupMultiplier(roster(hero('a')), 'ghost')).toBe(1)
  })
})

describe('catchupXp / awardXp — the one funnel every XP grant goes through', () => {
  it('rounds base × multiplier, and leaves the base exact when not behind', () => {
    const behind = roster(
      hero('me', { level: 2 }),
      hero('a', { level: 2 }),
      hero('b', { level: 3 }),
    )
    // 20 × 1.25 = 25
    expect(catchupXp(behind, 'me', 20)).toBe(25)
    // 33 × 1.25 = 41.25 → 41
    expect(catchupXp(behind, 'me', 33)).toBe(41)
    const level = roster(hero('me', { level: 3 }), hero('a', { level: 3 }))
    expect(catchupXp(level, 'me', 37)).toBe(37)
  })

  it('awardXp adds the boosted amount immutably and leaves everyone else alone', () => {
    const players = roster(hero('me', { level: 1, xp: 50 }), hero('a', { level: 3, xp: 400 }))
    const next = awardXp(players, 'me', 20)
    expect(next.me!.xp).toBe(50 + 20 * XP_CATCHUP_MAX)
    expect(next.a).toBe(players.a)
    expect(players.me!.xp).toBe(50) // input untouched
  })

  it('awardXp returns the SAME object for a zero grant or an unknown hero', () => {
    const players = roster(hero('me'))
    expect(awardXp(players, 'me', 0)).toBe(players)
    expect(awardXp(players, 'ghost', 40)).toBe(players)
  })
})

describe('awardZoneXp applies each recipient’s OWN catch-up', () => {
  it('a behind hero draws more presence XP than a level-with-team ally in the same zone', () => {
    const players = roster(
      hero('low', { level: 1 }),
      hero('mid', { level: 3 }),
      hero('high', { level: 5 }),
    )
    const next = awardZoneXp(players, 'coldstore-t1-chaff', 'chaff', 20)
    // low: allies avg 4 → 3 behind → capped ×2.0
    expect(next.low!.xp).toBe(40)
    // mid: allies avg 3 → level → ×1
    expect(next.mid!.xp).toBe(20)
    // high: ahead → ×1
    expect(next.high!.xp).toBe(20)
  })

  it('still returns the same object when nobody qualifies', () => {
    const players = roster(hero('a', { zone: 'hollow' }))
    expect(awardZoneXp(players, 'coldstore-t1-chaff', 'chaff', 20)).toBe(players)
  })
})
