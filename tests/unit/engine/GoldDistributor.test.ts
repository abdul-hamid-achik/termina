import { describe, it, expect } from 'vitest'
import {
  distributePassiveGold,
  awardLastHit,
  awardKill,
  awardTowerKill,
  comebackMultiplier,
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
    damageDealt: 0,
    towerDamageDealt: 0,
    killStreak: 0,
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
    neutrals: [],
    runes: [],
    roshan: { alive: false, hp: 0, maxHp: 5000, deathTick: null },
    aegis: null,
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

    it('applies the comeback BONUS to the bounty for a team far behind', () => {
      const state = makeGameState({
        players: {
          killer: makePlayer({ id: 'killer', team: 'radiant', gold: 0 }),
          victim: makePlayer({ id: 'victim', team: 'dire', gold: 10_000 }),
        },
      })
      const mult = comebackMultiplier(state, 'radiant') // far behind → 1.5
      expect(mult).toBeCloseTo(1.5, 5)
      const result = awardKill(state, 'killer', 'victim', [])
      expect(result.players['killer']!.gold).toBe(Math.round(KILL_BOUNTY_BASE * mult))
    })

    it('applies the comeback PENALTY to the bounty for a team far ahead', () => {
      const state = makeGameState({
        players: {
          killer: makePlayer({ id: 'killer', team: 'radiant', gold: 10_000 }),
          victim: makePlayer({ id: 'victim', team: 'dire', gold: 0 }),
        },
      })
      const mult = comebackMultiplier(state, 'radiant') // far ahead → 0.7
      expect(mult).toBeCloseTo(0.7, 5)
      const result = awardKill(state, 'killer', 'victim', [])
      expect(result.players['killer']!.gold).toBe(10_000 + Math.round(KILL_BOUNTY_BASE * mult))
    })

    it('should award shutdown bonus based on the victim kill streak', () => {
      const state = makeGameState({
        players: {
          killer: makePlayer({ id: 'killer', gold: 100 }),
          victim: makePlayer({ id: 'victim', team: 'dire', gold: 100, killStreak: 3 }),
        },
      })

      const expectedGold = KILL_BOUNTY_BASE + KILL_BOUNTY_PER_STREAK * 3
      const result = awardKill(state, 'killer', 'victim', [])
      expect(result.players['killer']!.gold).toBe(100 + expectedGold)
    })

    it('should cap the shutdown bonus at a 10 streak', () => {
      const state = makeGameState({
        players: {
          killer: makePlayer({ id: 'killer', gold: 100 }),
          victim: makePlayer({ id: 'victim', team: 'dire', gold: 100, killStreak: 15 }),
        },
      })

      const expectedGold = KILL_BOUNTY_BASE + KILL_BOUNTY_PER_STREAK * 10
      const result = awardKill(state, 'killer', 'victim', [])
      expect(result.players['killer']!.gold).toBe(100 + expectedGold)
    })

    it('killer own streak does not inflate the bounty', () => {
      const state = makeGameState({
        players: {
          killer: makePlayer({ id: 'killer', gold: 100, kills: 8, killStreak: 8 }),
          victim: makePlayer({ id: 'victim', team: 'dire', gold: 100, killStreak: 0 }),
        },
      })

      const result = awardKill(state, 'killer', 'victim', [])
      expect(result.players['killer']!.gold).toBe(100 + KILL_BOUNTY_BASE)
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

    it('should prevent killer from double-dipping assist gold', () => {
      // Balanced team net worth so the comeback multiplier is 1.
      // Radiant: killer(100) + a1(100) + a2(100) = 300
      // Dire: victim(100) + d1(100) + d2(100) = 300
      const state = makeGameState({
        players: {
          killer: makePlayer({ id: 'killer', gold: 100, kills: 0 }),
          victim: makePlayer({ id: 'victim', team: 'dire', gold: 100 }),
          a1: makePlayer({ id: 'a1', gold: 100 }),
          a2: makePlayer({ id: 'a2', gold: 100 }),
          d1: makePlayer({ id: 'd1', team: 'dire', gold: 100 }),
          d2: makePlayer({ id: 'd2', team: 'dire', gold: 100 }),
        },
      })

      // Killer is also in assisters list (should not get assist gold)
      const result = awardKill(state, 'killer', 'victim', ['killer', 'a1', 'a2'])

      // Killer should only get kill bounty, not assist gold
      expect(result.players['killer']!.gold).toBe(100 + KILL_BOUNTY_BASE)

      // Assisters should split assist gold (100 / 2 = 50 each)
      const assistGoldEach = Math.floor(ASSIST_GOLD / 2)
      expect(result.players['a1']!.gold).toBe(100 + assistGoldEach)
      expect(result.players['a2']!.gold).toBe(100 + assistGoldEach)
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

  describe('comebackMultiplier', () => {
    it('returns ~1 when teams are equal in net worth', () => {
      const state = makeGameState({
        players: {
          r1: makePlayer({ id: 'r1', gold: 1000 }),
          d1: makePlayer({ id: 'd1', team: 'dire', gold: 1000 }),
        },
      })
      expect(comebackMultiplier(state, 'radiant')).toBe(1)
    })

    it('boosts kill gold for the team that is far behind', () => {
      const state = makeGameState({
        players: {
          r1: makePlayer({ id: 'r1', gold: 0 }),
          d1: makePlayer({ id: 'd1', team: 'dire', gold: 10_000 }),
        },
      })
      // Radiant is 10k behind → ratio capped at 1, multiplier = 1 + 0.5 = 1.5
      expect(comebackMultiplier(state, 'radiant')).toBeCloseTo(1.5, 5)
    })

    it('penalizes kill gold for the team that is far ahead', () => {
      const state = makeGameState({
        players: {
          r1: makePlayer({ id: 'r1', gold: 10_000 }),
          d1: makePlayer({ id: 'd1', team: 'dire', gold: 0 }),
        },
      })
      // Radiant is 10k ahead → ratio = -1, multiplier = 1 - 0.3 = 0.7
      expect(comebackMultiplier(state, 'radiant')).toBeCloseTo(0.7, 5)
    })
  })
})
