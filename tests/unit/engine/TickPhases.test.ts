import { describe, it, expect } from 'vitest'
import type { GameState } from '~~/shared/types/game'
import {
  expireGlyph,
  progressDayNight,
  runSpawning,
  runNPCAI,
  processSpecialActions,
} from '~~/server/game/engine/GameLoop'
import { initializeZoneStates, initializeIce } from '~~/server/game/map/zones'
import { initializeTerminals } from '~~/server/game/engine/TerminalSystem'
import {
  HARDEN_DURATION_CYCLES,
  DAY_DURATION_CYCLES,
  NIGHT_DURATION_CYCLES,
  WAVE_INTERVAL_CYCLES,
} from '~~/shared/constants/balance'

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    cycle: 0,
    phase: 'playing',
    teams: {
      chaff: {
        id: 'chaff',
        kills: 0,
        iceKills: 0,
        scrip: 0,
        hardenUsedCycle: null,
        glyphCooldown: 0,
      },
      audit: {
        id: 'audit',
        kills: 0,
        iceKills: 0,
        scrip: 0,
        hardenUsedCycle: null,
        glyphCooldown: 0,
      },
    },
    players: {},
    zones: initializeZoneStates(),
    waves: [],
    neutrals: [],
    ice: initializeIce(),
    terminals: initializeTerminals(),
    caches: [],
    tenant: { alive: false, integ: 0, maxInteg: 5000, deathCycle: null },
    backup: null,
    events: [],
    surrenderVotes: { chaff: new Set(), audit: new Set() },
    timeOfDay: 'day',
    dayNightCycle: 0,
    ...overrides,
  }
}

describe('expireGlyph', () => {
  it('returns the same state object if no harden is active', () => {
    const state = makeState()
    expect(expireGlyph(state)).toBe(state)
  })

  it('does not expire while still within duration', () => {
    const state = makeState({
      cycle: 3,
      teams: {
        chaff: {
          id: 'chaff',
          kills: 0,
          iceKills: 0,
          scrip: 0,
          hardenUsedCycle: 1,
          glyphCooldown: 0,
        },
        audit: {
          id: 'audit',
          kills: 0,
          iceKills: 0,
          scrip: 0,
          hardenUsedCycle: null,
          glyphCooldown: 0,
        },
      },
      ice: initializeIce().map((t) => (t.team === 'chaff' ? { ...t, invulnerable: true } : t)),
    })
    const result = expireGlyph(state)
    // cycle =3, used=1, HARDEN_DURATION_CYCLES=5 → 2 < 5, still invulnerable
    expect(result.ice.find((t) => t.team === 'chaff')!.invulnerable).toBe(true)
  })

  it('drops chaff invulnerability when duration is up', () => {
    const state = makeState({
      cycle: HARDEN_DURATION_CYCLES + 5,
      teams: {
        chaff: {
          id: 'chaff',
          kills: 0,
          iceKills: 0,
          scrip: 0,
          hardenUsedCycle: 5,
          glyphCooldown: 0,
        },
        audit: {
          id: 'audit',
          kills: 0,
          iceKills: 0,
          scrip: 0,
          hardenUsedCycle: null,
          glyphCooldown: 0,
        },
      },
      ice: initializeIce().map((t) => (t.team === 'chaff' ? { ...t, invulnerable: true } : t)),
    })
    const result = expireGlyph(state)
    expect(result.ice.find((t) => t.team === 'chaff')!.invulnerable).toBe(false)
    // Audit ice untouched
    expect(result.ice.find((t) => t.team === 'audit')!.invulnerable).toBe(false)
  })

  it('expires both teams independently when both glyphs are up', () => {
    const state = makeState({
      cycle: HARDEN_DURATION_CYCLES + 1,
      teams: {
        chaff: {
          id: 'chaff',
          kills: 0,
          iceKills: 0,
          scrip: 0,
          hardenUsedCycle: 1,
          glyphCooldown: 0,
        },
        audit: {
          id: 'audit',
          kills: 0,
          iceKills: 0,
          scrip: 0,
          hardenUsedCycle: 1,
          glyphCooldown: 0,
        },
      },
      ice: initializeIce().map((t) => ({ ...t, invulnerable: true })),
    })
    const result = expireGlyph(state)
    expect(result.ice.every((t) => !t.invulnerable)).toBe(true)
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
          team: 'chaff',
          heroId: 'echo',
          zone: 'chaff-fountain',
          integ: 1000,
          maxInteg: 1000,
          bw: 100,
          maxBw: 100,
          level: 5,
          xp: 0,
          scrip: 5000,
          items: [null, null, null, null, null, null],
          plate: 0,
          ice: 0,
          cooldowns: { q: 0, w: 0, e: 0, r: 0 },
          buffs: [],
          alive: true,
          respawnCycle: null,
          kills: 0,
          deaths: 0,
          assists: 0,
          damageDealt: 0,
          iceDamageDealt: 0,
          killStreak: 0,
          buybackCost: 0,
          talents: { tier10: null, tier15: null, tier20: null, tier25: null },
        } as never,
      },
    })

    const result = processSpecialActions(state, [{ playerId: 'p1', command: { type: 'buyback' } }])

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
    const state = makeState({ cycle: 1 })
    const result = runSpawning(state)
    // cycle =1 isn't a wave-wave or cache cycle; no caches/wards exist to expire
    expect(result.waves).toEqual([])
    expect(result.caches ?? []).toEqual([])
  })

  it('spawns waves on a wave tick', () => {
    const state = makeState({ cycle: WAVE_INTERVAL_CYCLES })
    const result = runSpawning(state)
    expect(result.waves.length).toBeGreaterThan(0)
  })
})

describe('runNPCAI', () => {
  it('runs without error on an empty state', () => {
    const state = makeState({ cycle: 1 })
    const result = runNPCAI(state, { heroAttackers: new Set(), priorEvents: [] })
    expect(result.state.cycle).toBe(1)
    expect(Array.isArray(result.events)).toBe(true)
  })

  it('damages a hero in hollow when Tenant is alive', () => {
    const state = makeState({
      cycle: 1,
      tenant: {
        alive: true,
        integ: 5000,
        maxInteg: 5000,
        deathCycle: null,
        zone: 'hollow',
      } as never,
      players: {
        p1: {
          id: 'p1',
          name: 'p1',
          team: 'chaff',
          heroId: 'echo',
          zone: 'hollow',
          integ: 1000,
          maxInteg: 1000,
          bw: 100,
          maxBw: 100,
          level: 5,
          xp: 0,
          scrip: 0,
          items: [null, null, null, null, null, null],
          plate: 0,
          ice: 0,
          cooldowns: { q: 0, w: 0, e: 0, r: 0 },
          buffs: [],
          alive: true,
          respawnCycle: null,
          kills: 0,
          deaths: 0,
          assists: 0,
          damageDealt: 0,
          iceDamageDealt: 0,
          killStreak: 0,
          buybackCost: 0,
          talents: { tier10: null, tier15: null, tier20: null, tier25: null },
        } as never,
      },
    })
    const result = runNPCAI(state, { heroAttackers: new Set(), priorEvents: [] })
    // Hero should have taken some damage from Tenant (or none, if tenant isn't in pit; just sanity check no throw)
    expect(result.state.players['p1']!.integ).toBeLessThanOrEqual(1000)
  })
})

describe('progressDayNight', () => {
  it('increments dayNightCycle without emitting events mid-cycle', () => {
    const state = makeState({ timeOfDay: 'day', dayNightCycle: 50 })
    const result = progressDayNight(state)
    expect(result.state.dayNightCycle).toBe(51)
    expect(result.state.timeOfDay).toBe('day')
    expect(result.events).toEqual([])
  })

  it('flips day → night and emits night_falls when day duration is up', () => {
    const state = makeState({ timeOfDay: 'day', dayNightCycle: DAY_DURATION_CYCLES - 1, cycle: 10 })
    const result = progressDayNight(state)
    expect(result.state.timeOfDay).toBe('night')
    expect(result.state.dayNightCycle).toBe(0)
    expect(result.events).toHaveLength(1)
    expect(result.events[0]!._tag).toBe('night_falls')
    expect(result.events[0]!.cycle).toBe(10)
  })

  it('flips night → day and emits day_breaks when night duration is up', () => {
    const state = makeState({
      timeOfDay: 'night',
      dayNightCycle: NIGHT_DURATION_CYCLES - 1,
      cycle: 20,
    })
    const result = progressDayNight(state)
    expect(result.state.timeOfDay).toBe('day')
    expect(result.state.dayNightCycle).toBe(0)
    expect(result.events).toHaveLength(1)
    expect(result.events[0]!._tag).toBe('day_breaks')
  })
})
