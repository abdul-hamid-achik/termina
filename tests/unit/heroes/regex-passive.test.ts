import { describe, it, expect } from 'vitest'
import type { GameState, PlayerState, GameEvent } from '~~/shared/types/game'
import { resolveHeroPassive } from '~~/server/game/heroes/regex'

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'Regex',
    team: 'radiant',
    heroId: 'regex',
    zone: 'mid-river',
    hp: 450,
    maxHp: 450,
    mp: 400,
    maxMp: 400,
    level: 7,
    xp: 0,
    gold: 600,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnTick: null,
    defense: 1,
    magicResist: 18,
    kills: 0,
    deaths: 0,
    assists: 0,
    damageDealt: 0,
    towerDamageDealt: 0,
    killStreak: 0,
    ...overrides,
  }
}

function makeState(players: PlayerState[], tick: number): GameState {
  const map: Record<string, PlayerState> = {}
  for (const p of players) map[p.id] = p
  return {
    tick,
    phase: 'playing',
    teams: {
      radiant: { id: 'radiant', kills: 0, towerKills: 0, gold: 0 },
      dire: { id: 'dire', kills: 0, towerKills: 0, gold: 0 },
    },
    players: map,
    zones: { 'mid-river': { id: 'mid-river', wards: [], creeps: [] } },
    creeps: [],
    neutrals: [],
    towers: [],
    runes: [],
    roshan: { alive: false, hp: 0, maxHp: 0, deathTick: null },
    aegis: null,
    events: [],
  } as unknown as GameState
}

function castEvent(playerId: string, targetId: string, tick: number, damage: number): GameEvent {
  return {
    tick,
    type: 'ability_cast',
    payload: { playerId, ability: 'q', targetId, damage, damageType: 'magical' },
  } as GameEvent
}

describe('Regex passive: Pattern Cache', () => {
  it('FIRST cast on a target deals NO bonus and arms the cache', () => {
    const player = makePlayer()
    const enemy = makePlayer({ id: 'e1', name: 'Enemy', team: 'dire', heroId: 'echo' })
    const state = makeState([player, enemy], 10)

    const after = resolveHeroPassive(state, 'p1', castEvent('p1', 'e1', 10, 100))

    // No bonus damage applied on the first cast.
    expect(after.players['e1']!.hp).toBe(enemy.hp)
    // Cache armed: target stored as source, tick stored as stacks.
    const tgt = after.players['p1']!.buffs.find((b) => b.id === 'patternCacheTarget')
    const tk = after.players['p1']!.buffs.find((b) => b.id === 'patternCacheTick')
    expect(tgt?.source).toBe('e1')
    expect(tk?.stacks).toBe(10)
  })

  it('SECOND cast on the SAME target within 3 ticks deals +15% bonus magical damage', () => {
    const enemy = makePlayer({ id: 'e1', name: 'Enemy', team: 'dire', heroId: 'echo' })

    // First cast arms the cache at tick 10.
    const armed = resolveHeroPassive(
      makeState([makePlayer(), enemy], 10),
      'p1',
      castEvent('p1', 'e1', 10, 100),
    )
    expect(armed.players['e1']!.hp).toBe(enemy.hp) // sanity: no bonus yet

    // Second cast at tick 12 (within 3 ticks) on same target with damage=200.
    const second = resolveHeroPassive({ ...armed, tick: 12 }, 'p1', castEvent('p1', 'e1', 12, 200))

    const hpLost = enemy.hp - second.players['e1']!.hp
    expect(hpLost).toBeGreaterThan(0)

    // Bonus is round(200 * 0.15) = 30 raw magical, then mitigated. Compare the
    // realized HP loss to the HP loss the SAME mitigated path produces for a
    // round(100*0.15)=15 raw bonus from a hypothetical damage=100 cast: the
    // ratio of realized losses must equal the ratio of raw bonuses (200 vs 100).
    const secondHalf = resolveHeroPassive(
      { ...armed, tick: 12 },
      'p1',
      castEvent('p1', 'e1', 12, 100),
    )
    const hpLostHalf = enemy.hp - secondHalf.players['e1']!.hp
    expect(hpLostHalf).toBeGreaterThan(0)
    // raw bonus 30 vs 15 → realized HP loss should be ~2x (mitigation is linear).
    expect(hpLost).toBe(hpLostHalf * 2)
  })

  it('does NOT bonus when the second cast targets a DIFFERENT hero', () => {
    const e1 = makePlayer({ id: 'e1', name: 'E1', team: 'dire', heroId: 'echo' })
    const e2 = makePlayer({ id: 'e2', name: 'E2', team: 'dire', heroId: 'echo' })

    const armed = resolveHeroPassive(
      makeState([makePlayer(), e1, e2], 10),
      'p1',
      castEvent('p1', 'e1', 10, 100),
    )
    // Second cast at tick 12 on e2 (different target) — no bonus to e2.
    const second = resolveHeroPassive({ ...armed, tick: 12 }, 'p1', castEvent('p1', 'e2', 12, 200))
    expect(second.players['e2']!.hp).toBe(e2.hp)
  })

  it('does NOT bonus when the second cast is MORE than 3 ticks later', () => {
    const enemy = makePlayer({ id: 'e1', name: 'Enemy', team: 'dire', heroId: 'echo' })
    const armed = resolveHeroPassive(
      makeState([makePlayer(), enemy], 10),
      'p1',
      castEvent('p1', 'e1', 10, 100),
    )
    // tick 14 → 14-10 = 4 > 3, stale cache, no bonus.
    const second = resolveHeroPassive({ ...armed, tick: 14 }, 'p1', castEvent('p1', 'e1', 14, 200))
    expect(second.players['e1']!.hp).toBe(enemy.hp)
  })
})
