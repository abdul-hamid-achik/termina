import { describe, it, expect } from 'vitest'
import type { GameState, PlayerState, GameEvent } from '~~/shared/types/game'
import { resolveHeroPassive } from '~~/server/game/heroes/regex'

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  const player = {
    id: 'p1',
    name: 'Regex',
    team: 'chaff',
    heroId: 'regex',
    zone: 'mid-river',
    integ: 450,
    maxInteg: 450,
    bw: 400,
    maxBw: 400,
    level: 7,
    xp: 0,
    scrip: 600,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnCycle: null,
    plate: 1,
    ice: 18,
    kills: 0,
    deaths: 0,
    assists: 0,
    damageDealt: 0,
    iceDamageDealt: 0,
    killStreak: 0,
    ...overrides,
  }
  if (player.team === 'audit' && !player.buffs.some((b) => b.id === 'breached')) {
    return {
      ...player,
      buffs: [...player.buffs, { id: 'breached', stacks: 1, cyclesRemaining: 99, source: 'test' }],
    }
  }
  return player
}

function makeState(players: PlayerState[], cycle: number): GameState {
  const map: Record<string, PlayerState> = {}
  for (const p of players) map[p.id] = p
  return {
    cycle,
    phase: 'playing',
    teams: {
      chaff: { id: 'chaff', kills: 0, iceKills: 0, scrip: 0 },
      audit: { id: 'audit', kills: 0, iceKills: 0, scrip: 0 },
    },
    players: map,
    zones: { 'mid-river': { id: 'mid-river', wards: [], waves: [] } },
    waves: [],
    neutrals: [],
    ice: [],
    caches: [],
    tenant: { alive: false, integ: 0, maxInteg: 0, deathCycle: null },
    backup: null,
    events: [],
  } as unknown as GameState
}

function castEvent(playerId: string, targetId: string, cycle: number, damage: number): GameEvent {
  return {
    cycle,
    type: 'ability_cast',
    payload: { playerId, ability: 'q', targetId, damage, damageType: 'code' },
  } as GameEvent
}

describe('Regex passive: Pattern Cache', () => {
  it('FIRST cast on a target deals NO bonus and arms the cache', () => {
    const player = makePlayer()
    const enemy = makePlayer({ id: 'e1', name: 'Enemy', team: 'audit', heroId: 'echo' })
    const state = makeState([player, enemy], 10)

    const after = resolveHeroPassive(state, 'p1', castEvent('p1', 'e1', 10, 100))

    // No bonus damage applied on the first cast.
    expect(after.players['e1']!.integ).toBe(enemy.integ)
    // Cache armed: target stored in `destination` (single buff, stable
    // source=p1 so it overwrites across target switches), cycle stored as stacks.
    const tgt = after.players['p1']!.buffs.find((b) => b.id === 'patternCacheTarget')
    const tk = after.players['p1']!.buffs.find((b) => b.id === 'patternCacheTick')
    expect(tgt?.destination).toBe('e1')
    expect(tk?.stacks).toBe(10)
  })

  it('SECOND cast on the SAME target within 3 ticks deals +15% bonus code damage', () => {
    const enemy = makePlayer({ id: 'e1', name: 'Enemy', team: 'audit', heroId: 'echo', level: 1 })

    // First cast arms the cache at cycle 10.
    const armed = resolveHeroPassive(
      makeState([makePlayer(), enemy], 10),
      'p1',
      castEvent('p1', 'e1', 10, 100),
    )
    expect(armed.players['e1']!.integ).toBe(enemy.integ) // sanity: no bonus yet

    // Second cast at cycle 12 (within 3 ticks) on same target with damage=200.
    const second = resolveHeroPassive({ ...armed, cycle: 12 }, 'p1', castEvent('p1', 'e1', 12, 200))

    const integLost = enemy.integ - second.players['e1']!.integ
    expect(integLost).toBeGreaterThan(0)

    // Bonus is round(200 * 0.15) = 30 raw code, then mitigated. Compare the
    // realized INTEG loss to the INTEG loss the SAME mitigated path produces for a
    // round(100*0.15)=15 raw bonus from a hypothetical damage=100 cast: the
    // ratio of realized losses must equal the ratio of raw bonuses (200 vs 100).
    const secondHalf = resolveHeroPassive(
      { ...armed, cycle: 12 },
      'p1',
      castEvent('p1', 'e1', 12, 100),
    )
    const hpLostHalf = enemy.integ - secondHalf.players['e1']!.integ
    expect(hpLostHalf).toBeGreaterThan(0)
    // raw bonus 30 vs 15 → realized INTEG loss should be ~2x (mitigation is linear).
    expect(integLost).toBe(hpLostHalf * 2)
  })

  it('does NOT bonus when the second cast targets a DIFFERENT hero', () => {
    const e1 = makePlayer({ id: 'e1', name: 'E1', team: 'audit', heroId: 'echo' })
    const e2 = makePlayer({ id: 'e2', name: 'E2', team: 'audit', heroId: 'echo' })

    const armed = resolveHeroPassive(
      makeState([makePlayer(), e1, e2], 10),
      'p1',
      castEvent('p1', 'e1', 10, 100),
    )
    // Second cast at cycle 12 on e2 (different target) — no bonus to e2.
    const second = resolveHeroPassive({ ...armed, cycle: 12 }, 'p1', castEvent('p1', 'e2', 12, 200))
    expect(second.players['e2']!.integ).toBe(e2.integ)
  })

  it('STILL bonuses on a re-targeted hero after a switch (regression: never-expiring stale cache)', () => {
    // Bug: patternCacheTarget was keyed by source=targetId with cyclesRemaining
    // 999, so after targeting a second hero the cache held two buffs and find()
    // read the stale first one — the +15% PERMANENTLY stopped firing. Now the
    // cache tracks the latest target, so repeating a target re-arms + bonuses.
    const e1 = makePlayer({ id: 'e1', name: 'E1', team: 'audit', heroId: 'echo', level: 1 })
    const e2 = makePlayer({ id: 'e2', name: 'E2', team: 'audit', heroId: 'echo', level: 1 })

    let state = makeState([makePlayer(), e1, e2], 10)
    state = resolveHeroPassive(state, 'p1', castEvent('p1', 'e1', 10, 100)) // arm on e1
    state = resolveHeroPassive({ ...state, cycle: 11 }, 'p1', castEvent('p1', 'e2', 11, 100)) // switch → arm on e2
    // Exactly one cache-target buff, pointing at the latest target.
    const targets = state.players['p1']!.buffs.filter((b) => b.id === 'patternCacheTarget')
    expect(targets).toHaveLength(1)
    expect(targets[0]!.destination).toBe('e2')
    // Repeat e2 within the window → bonus fires (INTEG drops below the cast's normal hit).
    const repeat = resolveHeroPassive({ ...state, cycle: 12 }, 'p1', castEvent('p1', 'e2', 12, 200))
    expect(repeat.players['e2']!.integ).toBeLessThan(e2.integ)
  })

  it('does NOT bonus when the second cast is MORE than 3 ticks later', () => {
    const enemy = makePlayer({ id: 'e1', name: 'Enemy', team: 'audit', heroId: 'echo' })
    const armed = resolveHeroPassive(
      makeState([makePlayer(), enemy], 10),
      'p1',
      castEvent('p1', 'e1', 10, 100),
    )
    // cycle 14 → 14-10 = 4 > 3, stale cache, no bonus.
    const second = resolveHeroPassive({ ...armed, cycle: 14 }, 'p1', castEvent('p1', 'e1', 14, 200))
    expect(second.players['e1']!.integ).toBe(enemy.integ)
  })
})
