import { describe, it, expect } from 'vitest'
import {
  distributePassiveGold,
  awardLastHit,
  awardDeny,
  awardKill,
  awardTowerKill,
} from '../../../server/game/engine/GoldDistributor'
import type { GameState, PlayerState } from '../../../shared/types/game'
import { initializeZoneStates, initializeTowers } from '../../../server/game/map/zones'
import {
  PASSIVE_GOLD_PER_TICK,
  CREEP_GOLD_MIN,
  CREEP_GOLD_MAX,
  SIEGE_CREEP_GOLD,
  KILL_BOUNTY_BASE,
  KILL_BOUNTY_PER_STREAK,
  ASSIST_GOLD,
  TOWER_GOLD,
} from '../../../shared/constants/balance'

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

describe('GoldDistributor', () => {
  describe('distributePassiveGold', () => {
    it('should give passive gold to alive players', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', gold: 100 }),
          p2: makePlayer({ id: 'p2', gold: 200, team: 'dire' }),
        },
      })

      const result = distributePassiveGold(state)
      expect(result.players['p1']!.gold).toBe(100 + PASSIVE_GOLD_PER_TICK)
      expect(result.players['p2']!.gold).toBe(200 + PASSIVE_GOLD_PER_TICK)
    })

    it('should not give gold to dead players', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', gold: 100, alive: false, hp: 0 }),
          p2: makePlayer({ id: 'p2', gold: 200 }),
        },
      })

      const result = distributePassiveGold(state)
      expect(result.players['p1']!.gold).toBe(100)
      expect(result.players['p2']!.gold).toBe(200 + PASSIVE_GOLD_PER_TICK)
    })

    it('should handle empty player list', () => {
      const state = makeGameState({ players: {} })
      const result = distributePassiveGold(state)
      expect(Object.keys(result.players)).toHaveLength(0)
    })
  })

  describe('awardLastHit', () => {
    it('should award gold for melee creep last hit (within range)', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ id: 'p1', gold: 100 }) },
      })

      const result = awardLastHit(state, 'p1', 'melee')
      const goldGained = result.players['p1']!.gold - 100
      expect(goldGained).toBeGreaterThanOrEqual(CREEP_GOLD_MIN)
      expect(goldGained).toBeLessThanOrEqual(CREEP_GOLD_MAX)
    })

    it('should award gold for ranged creep last hit (within range)', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ id: 'p1', gold: 100 }) },
      })

      const result = awardLastHit(state, 'p1', 'ranged')
      const goldGained = result.players['p1']!.gold - 100
      expect(goldGained).toBeGreaterThanOrEqual(CREEP_GOLD_MIN)
      expect(goldGained).toBeLessThanOrEqual(CREEP_GOLD_MAX)
    })

    it('should award fixed gold for siege creep last hit', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ id: 'p1', gold: 100 }) },
      })

      const result = awardLastHit(state, 'p1', 'siege')
      expect(result.players['p1']!.gold).toBe(100 + SIEGE_CREEP_GOLD)
    })

    it('should return state unchanged for unknown player', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ id: 'p1', gold: 100 }) },
      })

      const result = awardLastHit(state, 'unknown', 'melee')
      expect(result).toEqual(state)
    })

    it('should produce consistent siege gold across multiple calls', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ id: 'p1', gold: 0 }) },
      })

      const results: number[] = []
      for (let i = 0; i < 10; i++) {
        const result = awardLastHit(state, 'p1', 'siege')
        results.push(result.players['p1']!.gold)
      }
      // All siege creep gold should be exactly SIEGE_CREEP_GOLD
      expect(results.every((g) => g === SIEGE_CREEP_GOLD)).toBe(true)
    })
  })

  describe('awardDeny', () => {
    it('should award 50% of average creep gold for a deny', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ id: 'p1', gold: 100 }) },
      })

      const expectedDenyGold = Math.floor(((CREEP_GOLD_MIN + CREEP_GOLD_MAX) / 2) * 0.5)
      const result = awardDeny(state, 'p1')
      expect(result.players['p1']!.gold).toBe(100 + expectedDenyGold)
    })

    it('should return state unchanged for unknown player', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ id: 'p1', gold: 100 }) },
      })

      const result = awardDeny(state, 'unknown')
      expect(result).toEqual(state)
    })
  })

  describe('awardKill', () => {
    it('should award base kill bounty to killer with 0 kills', () => {
      const state = makeGameState({
        players: {
          killer: makePlayer({ id: 'killer', gold: 100, kills: 0 }),
          victim: makePlayer({ id: 'victim', team: 'dire', gold: 100 }),
        },
      })

      const result = awardKill(state, 'killer', 'victim', [])
      expect(result.players['killer']!.gold).toBe(100 + KILL_BOUNTY_BASE)
    })

    it('should award streak bonus based on killer kills', () => {
      const state = makeGameState({
        players: {
          killer: makePlayer({ id: 'killer', gold: 100, kills: 3 }),
          victim: makePlayer({ id: 'victim', team: 'dire', gold: 100 }),
        },
      })

      const expectedGold = KILL_BOUNTY_BASE + KILL_BOUNTY_PER_STREAK * 3
      const result = awardKill(state, 'killer', 'victim', [])
      expect(result.players['killer']!.gold).toBe(100 + expectedGold)
    })

    it('should cap streak bonus at 10 kills', () => {
      const state = makeGameState({
        players: {
          killer: makePlayer({ id: 'killer', gold: 100, kills: 15 }),
          victim: makePlayer({ id: 'victim', team: 'dire', gold: 100 }),
        },
      })

      const expectedGold = KILL_BOUNTY_BASE + KILL_BOUNTY_PER_STREAK * 10
      const result = awardKill(state, 'killer', 'victim', [])
      expect(result.players['killer']!.gold).toBe(100 + expectedGold)
    })

    it('should split assist gold among assisters', () => {
      const state = makeGameState({
        players: {
          killer: makePlayer({ id: 'killer', gold: 100, kills: 0 }),
          victim: makePlayer({ id: 'victim', team: 'dire', gold: 100 }),
          a1: makePlayer({ id: 'a1', gold: 100 }),
          a2: makePlayer({ id: 'a2', gold: 100 }),
        },
      })

      const result = awardKill(state, 'killer', 'victim', ['a1', 'a2'])
      const assistGoldEach = Math.floor(ASSIST_GOLD / 2)
      expect(result.players['a1']!.gold).toBe(100 + assistGoldEach)
      expect(result.players['a2']!.gold).toBe(100 + assistGoldEach)
    })

    it('should give full assist gold to single assister', () => {
      const state = makeGameState({
        players: {
          killer: makePlayer({ id: 'killer', gold: 100, kills: 0 }),
          victim: makePlayer({ id: 'victim', team: 'dire', gold: 100 }),
          a1: makePlayer({ id: 'a1', gold: 100 }),
        },
      })

      const result = awardKill(state, 'killer', 'victim', ['a1'])
      expect(result.players['a1']!.gold).toBe(100 + ASSIST_GOLD)
    })

    it('should not give assist gold when no assisters', () => {
      const state = makeGameState({
        players: {
          killer: makePlayer({ id: 'killer', gold: 100, kills: 0 }),
          victim: makePlayer({ id: 'victim', team: 'dire', gold: 100 }),
        },
      })

      const result = awardKill(state, 'killer', 'victim', [])
      // Only killer should get gold
      expect(result.players['killer']!.gold).toBe(100 + KILL_BOUNTY_BASE)
      expect(result.players['victim']!.gold).toBe(100)
    })

    it('should return state unchanged for unknown killer', () => {
      const state = makeGameState({
        players: {
          victim: makePlayer({ id: 'victim', team: 'dire', gold: 100 }),
        },
      })

      const result = awardKill(state, 'unknown', 'victim', [])
      expect(result).toEqual(state)
    })

    it('should return state unchanged for unknown victim', () => {
      const state = makeGameState({
        players: {
          killer: makePlayer({ id: 'killer', gold: 100, kills: 0 }),
        },
      })

      const result = awardKill(state, 'killer', 'unknown', [])
      expect(result).toEqual(state)
    })
  })

  describe('awardTowerKill', () => {
    it('should split tower gold evenly among nearby allies', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', gold: 100 }),
          p2: makePlayer({ id: 'p2', gold: 200 }),
        },
      })

      const result = awardTowerKill(state, 'mid-t1-dire', ['p1', 'p2'])
      const goldEach = Math.floor(TOWER_GOLD / 2)
      expect(result.players['p1']!.gold).toBe(100 + goldEach)
      expect(result.players['p2']!.gold).toBe(200 + goldEach)
    })

    it('should give all tower gold to a single ally', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', gold: 100 }),
        },
      })

      const result = awardTowerKill(state, 'mid-t1-dire', ['p1'])
      expect(result.players['p1']!.gold).toBe(100 + TOWER_GOLD)
    })

    it('should return state unchanged with no nearby allies', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', gold: 100 }),
        },
      })

      const result = awardTowerKill(state, 'mid-t1-dire', [])
      expect(result).toEqual(state)
    })

    it('should floor the gold split (no fractional gold)', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', gold: 0 }),
          p2: makePlayer({ id: 'p2', gold: 0 }),
          p3: makePlayer({ id: 'p3', gold: 0 }),
        },
      })

      const result = awardTowerKill(state, 'mid-t1-dire', ['p1', 'p2', 'p3'])
      const goldEach = Math.floor(TOWER_GOLD / 3)
      expect(result.players['p1']!.gold).toBe(goldEach)
      expect(result.players['p2']!.gold).toBe(goldEach)
      expect(result.players['p3']!.gold).toBe(goldEach)
    })
  })
})
