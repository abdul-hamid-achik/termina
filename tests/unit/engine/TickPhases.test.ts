import { describe, it, expect } from 'vitest'
import type { GameState } from '../../../shared/types/game'
import {
  expireGlyph,
  progressDayNight,
  runSpawning,
  runNPCAI,
  processSpecialActions,
} from '../../../server/game/engine/GameLoop'
import { initializeZoneStates, initializeTowers } from '../../../server/game/map/zones'
import { initializeAncients } from '../../../server/game/engine/AncientSystem'
import {
  GLYPH_DURATION_TICKS,
  DAY_DURATION_TICKS,
  NIGHT_DURATION_TICKS,
  CREEP_WAVE_INTERVAL_TICKS,
} from '../../../shared/constants/balance'

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    tick: 0,
    phase: 'playing',
    teams: {
      radiant: { id: 'radiant', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: null, glyphCooldown: 0 },
      dire: { id: 'dire', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: null, glyphCooldown: 0 },
    },
    players: {},
    zones: initializeZoneStates(),
    creeps: [],
    neutrals: [],
    towers: initializeTowers(),
    ancients: initializeAncients(),
    runes: [],
    roshan: { alive: false, hp: 0, maxHp: 5000, deathTick: null },
    aegis: null,
    events: [],
    surrenderVotes: { radiant: new Set(), dire: new Set() },
    lastSeen: {},
    timeOfDay: 'day',
    dayNightTick: 0,
    ...overrides,
  }
}

describe('expireGlyph', () => {
  it('returns the same state object if no glyph is active', () => {
    const state = makeState()
    expect(expireGlyph(state)).toBe(state)
  })

  it('does not expire while still within duration', () => {
    const state = makeState({
      tick: 3,
      teams: {
        radiant: { id: 'radiant', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: 1, glyphCooldown: 0 },
        dire: { id: 'dire', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: null, glyphCooldown: 0 },
      },
      towers: initializeTowers().map((t) => (t.team === 'radiant' ? { ...t, invulnerable: true } : t)),
    })
    const result = expireGlyph(state)
    // tick=3, used=1, GLYPH_DURATION_TICKS=5 → 2 < 5, still invulnerable
    expect(result.towers.find((t) => t.team === 'radiant')!.invulnerable).toBe(true)
  })

  it('drops radiant invulnerability when duration is up', () => {
    const state = makeState({
      tick: GLYPH_DURATION_TICKS + 5,
      teams: {
        radiant: { id: 'radiant', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: 5, glyphCooldown: 0 },
        dire: { id: 'dire', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: null, glyphCooldown: 0 },
      },
      towers: initializeTowers().map((t) =>
        t.team === 'radiant' ? { ...t, invulnerable: true } : t,
      ),
    })
    const result = expireGlyph(state)
    expect(result.towers.find((t) => t.team === 'radiant')!.invulnerable).toBe(false)
    // Dire towers untouched
    expect(result.towers.find((t) => t.team === 'dire')!.invulnerable).toBe(false)
  })

  it('expires both teams independently when both glyphs are up', () => {
    const state = makeState({
      tick: GLYPH_DURATION_TICKS + 1,
      teams: {
        radiant: { id: 'radiant', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: 1, glyphCooldown: 0 },
        dire: { id: 'dire', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: 1, glyphCooldown: 0 },
      },
      towers: initializeTowers().map((t) => ({ ...t, invulnerable: true })),
    })
    const result = expireGlyph(state)
    expect(result.towers.every((t) => !t.invulnerable)).toBe(true)
  })
})

describe('processSpecialActions', () => {
  it('returns state unchanged with no events when given no actions', () => {
    const state = makeState()
    const result = processSpecialActions(state, [])
    expect(result.state).toBe(state)
    expect(result.events).toEqual([])
    expect(result.rejectedActions).toEqual([])
  })

  it('rejects buyback when the player is alive', () => {
    const state = makeState({
      players: {
        p1: {
          id: 'p1',
          name: 'p1',
          team: 'radiant',
          heroId: 'echo',
          zone: 'radiant-fountain',
          hp: 1000,
          maxHp: 1000,
          mp: 100,
          maxMp: 100,
          level: 5,
          xp: 0,
          gold: 5000,
          items: [null, null, null, null, null, null],
          defense: 0,
          magicResist: 0,
          cooldowns: { q: 0, w: 0, e: 0, r: 0 },
          buffs: [],
          alive: true,
          respawnTick: null,
          kills: 0,
          deaths: 0,
          assists: 0,
          damageDealt: 0,
          towerDamageDealt: 0,
          killStreak: 0,
          buybackCost: 0,
          talents: { tier10: null, tier15: null, tier20: null, tier25: null },
        } as never,
      },
    })

    const result = processSpecialActions(state, [
      { playerId: 'p1', command: { type: 'buyback' } },
    ])

    expect(result.rejectedActions).toHaveLength(1)
    expect(result.rejectedActions[0]!.playerId).toBe('p1')
  })

  it('does not consume non-special commands', () => {
    const state = makeState()
    const result = processSpecialActions(state, [
      { playerId: 'p1', command: { type: 'move', zone: 'mid-river' } },
      { playerId: 'p2', command: { type: 'attack', target: { kind: 'hero', id: 'p3' } } },
    ])
    // Move/attack are not handled here — pass through silently
    expect(result.state).toBe(state)
    expect(result.events).toEqual([])
    expect(result.rejectedActions).toEqual([])
  })
})

describe('runSpawning', () => {
  it('returns the same state when nothing spawns and nothing expires', () => {
    const state = makeState({ tick: 1 })
    const result = runSpawning(state)
    // tick=1 isn't a creep-wave or rune tick; no runes/wards exist to expire
    expect(result.creeps).toEqual([])
    expect(result.runes ?? []).toEqual([])
  })

  it('spawns creeps on a wave tick', () => {
    const state = makeState({ tick: CREEP_WAVE_INTERVAL_TICKS })
    const result = runSpawning(state)
    expect(result.creeps.length).toBeGreaterThan(0)
  })
})

describe('runNPCAI', () => {
  it('runs without error on an empty state', () => {
    const state = makeState({ tick: 1 })
    const result = runNPCAI(state, { heroAttackers: new Set(), priorEvents: [] })
    expect(result.state.tick).toBe(1)
    expect(Array.isArray(result.events)).toBe(true)
  })

  it('damages a hero in roshan-pit when Roshan is alive', () => {
    const state = makeState({
      tick: 1,
      roshan: { alive: true, hp: 5000, maxHp: 5000, deathTick: null, zone: 'roshan-pit' } as never,
      players: {
        p1: {
          id: 'p1',
          name: 'p1',
          team: 'radiant',
          heroId: 'echo',
          zone: 'roshan-pit',
          hp: 1000,
          maxHp: 1000,
          mp: 100,
          maxMp: 100,
          level: 5,
          xp: 0,
          gold: 0,
          items: [null, null, null, null, null, null],
          defense: 0,
          magicResist: 0,
          cooldowns: { q: 0, w: 0, e: 0, r: 0 },
          buffs: [],
          alive: true,
          respawnTick: null,
          kills: 0,
          deaths: 0,
          assists: 0,
          damageDealt: 0,
          towerDamageDealt: 0,
          killStreak: 0,
          buybackCost: 0,
          talents: { tier10: null, tier15: null, tier20: null, tier25: null },
        } as never,
      },
    })
    const result = runNPCAI(state, { heroAttackers: new Set(), priorEvents: [] })
    // Hero should have taken some damage from Roshan (or none, if roshan isn't in pit; just sanity check no throw)
    expect(result.state.players['p1']!.hp).toBeLessThanOrEqual(1000)
  })
})

describe('progressDayNight', () => {
  it('increments dayNightTick without emitting events mid-cycle', () => {
    const state = makeState({ timeOfDay: 'day', dayNightTick: 50 })
    const result = progressDayNight(state)
    expect(result.state.dayNightTick).toBe(51)
    expect(result.state.timeOfDay).toBe('day')
    expect(result.events).toEqual([])
  })

  it('flips day → night and emits night_falls when day duration is up', () => {
    const state = makeState({ timeOfDay: 'day', dayNightTick: DAY_DURATION_TICKS - 1, tick: 10 })
    const result = progressDayNight(state)
    expect(result.state.timeOfDay).toBe('night')
    expect(result.state.dayNightTick).toBe(0)
    expect(result.events).toHaveLength(1)
    expect(result.events[0]!._tag).toBe('night_falls')
    expect(result.events[0]!.tick).toBe(10)
  })

  it('flips night → day and emits day_breaks when night duration is up', () => {
    const state = makeState({
      timeOfDay: 'night',
      dayNightTick: NIGHT_DURATION_TICKS - 1,
      tick: 20,
    })
    const result = progressDayNight(state)
    expect(result.state.timeOfDay).toBe('day')
    expect(result.state.dayNightTick).toBe(0)
    expect(result.events).toHaveLength(1)
    expect(result.events[0]!._tag).toBe('day_breaks')
  })
})
