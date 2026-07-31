import { describe, it, expect } from 'vitest'
import { computeDelta } from '~~/server/game/engine/StateDelta'
import type { PlayerVisibleState } from '~~/shared/types/game'

function makeState(overrides: Partial<PlayerVisibleState> = {}): PlayerVisibleState {
  return {
    cycle: 1,
    phase: 'playing',
    teams: {
      chaff: { id: 'chaff', kills: 0, iceKills: 0, scrip: 0, hardenUsedCycle: null },
      audit: { id: 'audit', kills: 0, iceKills: 0, scrip: 0, hardenUsedCycle: null },
    },
    players: {},
    zones: {},
    waves: [],
    neutrals: [],
    ice: [],
    terminals: {
      chaff: { team: 'chaff', integ: 750, maxInteg: 750, alive: true, vulnerable: false },
      audit: { team: 'audit', integ: 750, maxInteg: 750, alive: true, vulnerable: false },
    },
    caches: [],
    tenant: { alive: true, integ: 500, maxInteg: 500, deathCycle: null },
    backup: null,
    events: [],
    visibleZones: [],
    timeOfDay: 'day',
    dayNightCycle: 0,
    ...overrides,
  }
}

describe('StateDelta', () => {
  describe('computeDelta', () => {
    it('returns the full state when lastSent is null (first tick / post-reconnect)', () => {
      const current = makeState({ cycle: 5 })
      const delta = computeDelta(current, null)
      // Full state — all fields present.
      expect(delta).toEqual(current)
    })

    it('always includes tick and the always-changed fields (players, zones, waves, events, visibleZones)', () => {
      const prev = makeState({ cycle: 1 })
      const current = makeState({ cycle: 2 })
      const delta = computeDelta(current, prev) as Partial<PlayerVisibleState>

      expect(delta.cycle).toBe(2)
      expect(delta).toHaveProperty('players')
      expect(delta).toHaveProperty('zones')
      expect(delta).toHaveProperty('waves')
      expect(delta).toHaveProperty('events')
      expect(delta).toHaveProperty('visibleZones')
    })

    it('omits unchanged pass-through fields (teams, ice, terminals, tenant, etc.)', () => {
      const teams = {
        chaff: { id: 'chaff', kills: 0, iceKills: 0, scrip: 0, hardenUsedCycle: null },
        audit: { id: 'audit', kills: 0, iceKills: 0, scrip: 0, hardenUsedCycle: null },
      }
      const ice = [] as PlayerVisibleState['ice']
      const tenant = { alive: true, integ: 500, maxInteg: 500, deathCycle: null }
      const prev = makeState({ cycle: 1, teams, ice, tenant })
      const current = makeState({ cycle: 2, teams, ice, tenant })
      const delta = computeDelta(current, prev) as Partial<PlayerVisibleState>

      // Same reference → omitted from delta.
      expect(delta).not.toHaveProperty('teams')
      expect(delta).not.toHaveProperty('ice')
      expect(delta).not.toHaveProperty('tenant')
    })

    it('includes changed pass-through fields (teams, ice, etc.)', () => {
      const prev = makeState({ cycle: 1 })
      const newTeams = {
        chaff: { id: 'chaff', kills: 1, iceKills: 0, scrip: 0, hardenUsedCycle: null },
        audit: { id: 'audit', kills: 0, iceKills: 0, scrip: 0, hardenUsedCycle: null },
      }
      const current = makeState({ cycle: 2, teams: newTeams })
      const delta = computeDelta(current, prev) as Partial<PlayerVisibleState>

      // Different reference → included in delta.
      expect(delta).toHaveProperty('teams')
      expect(delta.teams).toBe(newTeams)
    })

    it('includes timeOfDay when the day/night cycle flips', () => {
      const prev = makeState({ cycle: 300, timeOfDay: 'day' })
      const current = makeState({ cycle: 301, timeOfDay: 'night' })
      const delta = computeDelta(current, prev) as Partial<PlayerVisibleState>

      expect(delta.timeOfDay).toBe('night')
    })

    it('omits timeOfDay when it has not changed', () => {
      const prev = makeState({ cycle: 100, timeOfDay: 'day' })
      const current = makeState({ cycle: 101, timeOfDay: 'day' })
      const delta = computeDelta(current, prev) as Partial<PlayerVisibleState>

      expect(delta).not.toHaveProperty('timeOfDay')
    })
  })
})
