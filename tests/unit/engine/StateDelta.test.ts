import { describe, it, expect } from 'vitest'
import { computeDelta } from '../../../server/game/engine/StateDelta'
import type { PlayerVisibleState } from '../../../shared/types/game'

function makeState(overrides: Partial<PlayerVisibleState> = {}): PlayerVisibleState {
  return {
    tick: 1,
    phase: 'playing',
    teams: {
      radiant: { id: 'radiant', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: null },
      dire: { id: 'dire', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: null },
    },
    players: {},
    zones: {},
    creeps: [],
    neutrals: [],
    towers: [],
    ancients: {
      radiant: { team: 'radiant', hp: 750, maxHp: 750, alive: true, vulnerable: false },
      dire: { team: 'dire', hp: 750, maxHp: 750, alive: true, vulnerable: false },
    },
    runes: [],
    roshan: { alive: true, hp: 500, maxHp: 500, deathTick: null },
    aegis: null,
    events: [],
    visibleZones: [],
    timeOfDay: 'day',
    dayNightTick: 0,
    ...overrides,
  }
}

describe('StateDelta', () => {
  describe('computeDelta', () => {
    it('returns the full state when lastSent is null (first tick / post-reconnect)', () => {
      const current = makeState({ tick: 5 })
      const delta = computeDelta(current, null)
      // Full state — all fields present.
      expect(delta).toEqual(current)
    })

    it('always includes tick and the always-changed fields (players, zones, creeps, events, visibleZones)', () => {
      const prev = makeState({ tick: 1 })
      const current = makeState({ tick: 2 })
      const delta = computeDelta(current, prev) as Partial<PlayerVisibleState>

      expect(delta.tick).toBe(2)
      expect(delta).toHaveProperty('players')
      expect(delta).toHaveProperty('zones')
      expect(delta).toHaveProperty('creeps')
      expect(delta).toHaveProperty('events')
      expect(delta).toHaveProperty('visibleZones')
    })

    it('omits unchanged pass-through fields (teams, towers, ancients, roshan, etc.)', () => {
      const teams = {
        radiant: { id: 'radiant', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: null },
        dire: { id: 'dire', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: null },
      }
      const towers = [] as PlayerVisibleState['towers']
      const roshan = { alive: true, hp: 500, maxHp: 500, deathTick: null }
      const prev = makeState({ tick: 1, teams, towers, roshan })
      const current = makeState({ tick: 2, teams, towers, roshan })
      const delta = computeDelta(current, prev) as Partial<PlayerVisibleState>

      // Same reference → omitted from delta.
      expect(delta).not.toHaveProperty('teams')
      expect(delta).not.toHaveProperty('towers')
      expect(delta).not.toHaveProperty('roshan')
    })

    it('includes changed pass-through fields (teams, towers, etc.)', () => {
      const prev = makeState({ tick: 1 })
      const newTeams = {
        radiant: { id: 'radiant', kills: 1, towerKills: 0, gold: 0, glyphUsedTick: null },
        dire: { id: 'dire', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: null },
      }
      const current = makeState({ tick: 2, teams: newTeams })
      const delta = computeDelta(current, prev) as Partial<PlayerVisibleState>

      // Different reference → included in delta.
      expect(delta).toHaveProperty('teams')
      expect(delta.teams).toBe(newTeams)
    })

    it('includes timeOfDay when the day/night cycle flips', () => {
      const prev = makeState({ tick: 300, timeOfDay: 'day' })
      const current = makeState({ tick: 301, timeOfDay: 'night' })
      const delta = computeDelta(current, prev) as Partial<PlayerVisibleState>

      expect(delta.timeOfDay).toBe('night')
    })

    it('omits timeOfDay when it has not changed', () => {
      const prev = makeState({ tick: 100, timeOfDay: 'day' })
      const current = makeState({ tick: 101, timeOfDay: 'day' })
      const delta = computeDelta(current, prev) as Partial<PlayerVisibleState>

      expect(delta).not.toHaveProperty('timeOfDay')
    })
  })
})
