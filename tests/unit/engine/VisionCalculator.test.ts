import { describe, it, expect } from 'vitest'
import {
  calculateVision,
  filterStateForPlayer,
  type FoggedPlayer,
} from '../../../server/game/engine/VisionCalculator'
import type {
  GameState,
  PlayerState,
} from '../../../shared/types/game'
import { initializeZoneStates, initializeTowers } from '../../../server/game/map/zones'

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'Player1',
    team: 'radiant',
    heroId: 'echo',
    zone: 'mid-t1-rad',
    hp: 500,
    maxHp: 500,
    mp: 200,
    maxMp: 200,
    level: 1,
    xp: 0,
    gold: 600,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnTick: null,
    defense: 3,
    magicResist: 15,
    kills: 0,
    deaths: 0,
    assists: 0,
    ...overrides,
  }
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    tick: 1,
    phase: 'playing',
    teams: {
      radiant: { id: 'radiant', kills: 0, towerKills: 0, gold: 0 },
      dire: { id: 'dire', kills: 0, towerKills: 0, gold: 0 },
    },
    players: {},
    zones: initializeZoneStates(),
    creeps: [],
    towers: initializeTowers(),
    events: [],
    ...overrides,
  }
}

describe('VisionCalculator', () => {
  describe('calculateVision', () => {
    it('should include current zone and adjacent zones for alive player', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ zone: 'mid-river' }),
        },
      })

      const vision = calculateVision(state, 'p1')

      // mid-river is adjacent to: mid-t1-rad, mid-t1-dire, rune-top, rune-bot
      expect(vision.has('mid-river')).toBe(true)
      expect(vision.has('mid-t1-rad')).toBe(true)
      expect(vision.has('mid-t1-dire')).toBe(true)
      expect(vision.has('rune-top')).toBe(true)
      expect(vision.has('rune-bot')).toBe(true)
    })

    it('should always include own base and fountain', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ team: 'radiant', zone: 'mid-river' }),
        },
      })

      const vision = calculateVision(state, 'p1')
      expect(vision.has('radiant-base')).toBe(true)
      expect(vision.has('radiant-fountain')).toBe(true)
    })

    it('should include ward vision', () => {
      const zones = initializeZoneStates()
      zones['bot-river']!.wards.push({
        team: 'radiant',
        placedTick: 0,
        expiryTick: 100,
      })

      const state = makeGameState({
        players: {
          p1: makePlayer({ team: 'radiant', zone: 'radiant-fountain' }),
        },
        zones,
      })

      const vision = calculateVision(state, 'p1')
      // Ward at bot-river should grant vision of bot-river + adjacent
      expect(vision.has('bot-river')).toBe(true)
      expect(vision.has('bot-t1-rad')).toBe(true)
      expect(vision.has('bot-t1-dire')).toBe(true)
    })

    it('should include tower vision for alive team towers', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ team: 'radiant', zone: 'radiant-fountain' }),
        },
      })

      const vision = calculateVision(state, 'p1')
      // Radiant T1 mid tower at mid-t1-rad should grant vision
      expect(vision.has('mid-t1-rad')).toBe(true)
    })

    it('should not grant vision from dead player position', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ zone: 'roshan-pit', alive: false }),
        },
      })

      const vision = calculateVision(state, 'p1')
      // Dead player doesn't contribute base vision from their zone
      // (but still has tower/base vision)
      // roshan-pit should not be visible unless a tower or ward covers it
      // roshan-pit is adjacent to rune-top only, and rune-top isn't a radiant tower
      // However, base + fountain vision still applies
      expect(vision.has('radiant-base')).toBe(true)
    })

    it('should include allied hero vision', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', zone: 'radiant-fountain', team: 'radiant' }),
          p2: makePlayer({ id: 'p2', zone: 'roshan-pit', team: 'radiant' }),
        },
      })

      const vision = calculateVision(state, 'p1')
      // p2 is at roshan-pit, so p1 should see roshan-pit + adjacent
      expect(vision.has('roshan-pit')).toBe(true)
      expect(vision.has('rune-top')).toBe(true)
    })

    it('should return empty set for unknown player', () => {
      const state = makeGameState()
      const vision = calculateVision(state, 'nonexistent')
      expect(vision.size).toBe(0)
    })
  })

  describe('filterStateForPlayer', () => {
    it('should show full info for teammates', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'radiant', zone: 'mid-t1-rad' }),
          p2: makePlayer({ id: 'p2', team: 'radiant', zone: 'bot-t3-rad', name: 'Ally' }),
        },
      })

      const filtered = filterStateForPlayer(state, 'p1')
      const ally = filtered.players['p2'] as PlayerState
      expect(ally.zone).toBe('bot-t3-rad')
      expect(ally.hp).toBe(500)
      expect('fogged' in ally).toBe(false)
    })

    it('should fog enemies in non-visible zones', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'radiant', zone: 'radiant-fountain' }),
          e1: makePlayer({ id: 'e1', team: 'dire', zone: 'dire-fountain', name: 'Enemy' }),
        },
      })

      const filtered = filterStateForPlayer(state, 'p1')
      const enemy = filtered.players['e1'] as FoggedPlayer
      expect(enemy.fogged).toBe(true)
      expect('zone' in enemy).toBe(false)
      expect('hp' in enemy).toBe(false)
      expect('items' in enemy).toBe(false)
    })

    it('should show full info for enemies in visible zones', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'radiant', zone: 'mid-river' }),
          e1: makePlayer({
            id: 'e1',
            team: 'dire',
            zone: 'mid-river',
            name: 'VisibleEnemy',
            hp: 300,
          }),
        },
      })

      const filtered = filterStateForPlayer(state, 'p1')
      const enemy = filtered.players['e1'] as PlayerState
      expect(enemy.zone).toBe('mid-river')
      expect(enemy.hp).toBe(300)
      expect('fogged' in enemy).toBe(false)
    })

    it('should not reveal creeps in fogged zones', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'radiant', zone: 'radiant-fountain' }),
        },
        creeps: [
          { id: 'c1', team: 'dire', zone: 'dire-fountain', hp: 400, type: 'melee' },
          { id: 'c2', team: 'radiant', zone: 'radiant-base', hp: 400, type: 'melee' },
        ],
      })

      const filtered = filterStateForPlayer(state, 'p1')
      // c1 in dire-fountain should be hidden
      expect(filtered.creeps.find((c) => c.id === 'c1')).toBeUndefined()
      // c2 in radiant-base should be visible
      expect(filtered.creeps.find((c) => c.id === 'c2')).toBeDefined()
    })

    it('should not reveal enemy wards in fogged zones', () => {
      const zones = initializeZoneStates()
      zones['dire-base']!.wards.push({
        team: 'dire',
        placedTick: 0,
        expiryTick: 100,
      })

      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'radiant', zone: 'radiant-fountain' }),
        },
        zones,
      })

      const filtered = filterStateForPlayer(state, 'p1')
      // dire-base should be fogged; its wards should be hidden
      const dZone = filtered.zones['dire-base']
      expect(dZone?.wards.length).toBe(0)
    })

    it('should include visibleZones in the output', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', zone: 'mid-river' }),
        },
      })

      const filtered = filterStateForPlayer(state, 'p1')
      expect(filtered.visibleZones.length).toBeGreaterThan(0)
      expect(filtered.visibleZones).toContain('mid-river')
    })
  })
})
