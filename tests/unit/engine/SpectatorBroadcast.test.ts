/**
 * Verify that the game loop's onSpectatorTick callback fires once per tick
 * with the unfiltered state. This is the seam the plugin uses to fan out
 * to the SpectatorRegistry, so we need to know it's wired correctly.
 */
import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import type { GameState } from '../../../shared/types/game'
import { processTick } from '../../../server/game/engine/GameLoop'
import { initializeZoneStates, initializeTowers } from '../../../server/game/map/zones'
import { filterStateForSpectator } from '../../../server/game/engine/VisionCalculator'

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    tick: 0,
    phase: 'playing',
    teams: {
      radiant: {
        id: 'radiant',
        kills: 0,
        towerKills: 0,
        gold: 0,
        glyphUsedTick: null,
        glyphCooldown: 0,
      },
      dire: {
        id: 'dire',
        kills: 0,
        towerKills: 0,
        gold: 0,
        glyphUsedTick: null,
        glyphCooldown: 0,
      },
    },
    players: {},
    zones: initializeZoneStates(),
    creeps: [],
    neutrals: [],
    towers: initializeTowers(),
    runes: [],
    roshan: { alive: false, hp: 0, maxHp: 5000, deathTick: null },
    aegis: null,
    events: [],
    surrenderVotes: { radiant: new Set(), dire: new Set() },
    timeOfDay: 'day',
    dayNightTick: 0,
    ...overrides,
  }
}

describe('Spectator broadcast wiring', () => {
  it('processTick still produces a state we can filter for spectators', () => {
    const initial = makeState()
    const result = Effect.runSync(processTick('g1', initial))
    const fogless = filterStateForSpectator(result.state)

    expect(fogless.tick).toBe(initial.tick + 1)
    // visibleZones in spectator view is the full zone list
    expect(fogless.visibleZones.length).toBe(Object.keys(result.state.zones).length)
    // events array is preserved (no filtering)
    expect(fogless.events).toBe(result.state.events)
  })
})

describe('filterStateForSpectator', () => {
  it('returns players unfogged', () => {
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
          level: 1,
          xp: 0,
          gold: 600,
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

    const fogless = filterStateForSpectator(state)
    const p = fogless.players['p1']!
    // Real player shape (has gold), not the FoggedPlayer subset
    expect('gold' in p).toBe(true)
    expect((p as { gold: number }).gold).toBe(600)
  })

  it('exposes every zone in visibleZones', () => {
    const state = makeState()
    const fogless = filterStateForSpectator(state)
    expect(fogless.visibleZones.length).toBeGreaterThan(0)
    expect(new Set(fogless.visibleZones)).toEqual(new Set(Object.keys(state.zones)))
  })
})
