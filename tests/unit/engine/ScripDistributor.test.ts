import { describe, it, expect } from 'vitest'
import {
  distributePassiveScrip,
  awardLastHit,
  awardKill,
  awardIceKill,
  comebackMultiplier,
  xpComebackMultiplier,
  playerNetWorth,
} from '~~/server/game/engine/ScripDistributor'
import type { GameState, PlayerState } from '~~/shared/types/game'
import { initializeZoneStates, initializeIce } from '~~/server/game/map/zones'
import { ITEMS } from '~~/shared/constants/items'
import {
  PASSIVE_SCRIP_PER_CYCLE,
  WAVE_SCRIP,
  BREACH_UNIT_SCRIP,
  KILL_BOUNTY_BASE,
  KILL_BOUNTY_PER_STREAK,
  ASSIST_SCRIP,
  ICE_SCRIP,
  COMEBACK_BONUS_MAX,
  COMEBACK_PENALTY_MAX,
  COMEBACK_FULL_GAP,
  XP_COMEBACK_BONUS_MAX,
  XP_COMEBACK_PENALTY_MAX,
  XP_COMEBACK_FULL_LEVEL_GAP,
} from '~~/shared/constants/balance'

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'Player1',
    team: 'chaff',
    heroId: 'echo',
    zone: 'mid-t1-chaff',
    integ: 500,
    maxInteg: 500,
    bw: 200,
    maxBw: 200,
    level: 1,
    xp: 0,
    scrip: 600,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnCycle: null,
    plate: 3,
    ice: 15,
    kills: 0,
    deaths: 0,
    assists: 0,
    damageDealt: 0,
    iceDamageDealt: 0,
    killStreak: 0,
    ...overrides,
  }
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    cycle: 1,
    phase: 'playing',
    teams: {
      chaff: { id: 'chaff', kills: 0, iceKills: 0, scrip: 0 },
      audit: { id: 'audit', kills: 0, iceKills: 0, scrip: 0 },
    },
    players: {},
    zones: initializeZoneStates(),
    waves: [],
    ice: initializeIce(),
    neutrals: [],
    caches: [],
    tenant: { alive: false, integ: 0, maxInteg: 5000, deathCycle: null },
    backup: null,
    events: [],
    ...overrides,
  }
}

describe('ScripDistributor', () => {
  describe('distributePassiveScrip', () => {
    it('should give passive scrip to alive players', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', scrip: 100 }),
          p2: makePlayer({ id: 'p2', scrip: 200, team: 'audit' }),
        },
      })

      const result = distributePassiveScrip(state)
      expect(result.players['p1']!.scrip).toBe(100 + PASSIVE_SCRIP_PER_CYCLE)
      expect(result.players['p2']!.scrip).toBe(200 + PASSIVE_SCRIP_PER_CYCLE)
    })

    it('should not give scrip to dead players', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', scrip: 100, alive: false, integ: 0 }),
          p2: makePlayer({ id: 'p2', scrip: 200 }),
        },
      })

      const result = distributePassiveScrip(state)
      expect(result.players['p1']!.scrip).toBe(100)
      expect(result.players['p2']!.scrip).toBe(200 + PASSIVE_SCRIP_PER_CYCLE)
    })

    it('should handle empty player list', () => {
      const state = makeGameState({ players: {} })
      const result = distributePassiveScrip(state)
      expect(Object.keys(result.players)).toHaveLength(0)
    })
  })

  describe('awardLastHit', () => {
    it('should award fixed scrip for line wave last hit (no RNG)', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ id: 'p1', scrip: 100 }) },
      })

      const result = awardLastHit(state, 'p1', 'line')
      const goldGained = result.players['p1']!.scrip - 100
      expect(goldGained).toBe(WAVE_SCRIP)
    })

    it('should award fixed scrip for sweep wave last hit (no RNG)', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ id: 'p1', scrip: 100 }) },
      })

      const result = awardLastHit(state, 'p1', 'sweep')
      const goldGained = result.players['p1']!.scrip - 100
      expect(goldGained).toBe(WAVE_SCRIP)
    })

    it('should award fixed scrip for breach wave last hit', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ id: 'p1', scrip: 100 }) },
      })

      const result = awardLastHit(state, 'p1', 'breach')
      expect(result.players['p1']!.scrip).toBe(100 + BREACH_UNIT_SCRIP)
    })

    it('should return state unchanged for unknown player', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ id: 'p1', scrip: 100 }) },
      })

      const result = awardLastHit(state, 'unknown', 'line')
      expect(result).toEqual(state)
    })

    it('should produce consistent breach scrip across multiple calls', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ id: 'p1', scrip: 0 }) },
      })

      const results: number[] = []
      for (let i = 0; i < 10; i++) {
        const result = awardLastHit(state, 'p1', 'breach')
        results.push(result.players['p1']!.scrip)
      }
      // All breach wave scrip should be exactly BREACH_UNIT_SCRIP
      expect(results.every((g) => g === BREACH_UNIT_SCRIP)).toBe(true)
    })
  })

  describe('awardKill', () => {
    it('should award base kill bounty to killer with 0 kills', () => {
      const state = makeGameState({
        players: {
          killer: makePlayer({ id: 'killer', scrip: 100, kills: 0 }),
          victim: makePlayer({ id: 'victim', team: 'audit', scrip: 100 }),
        },
      })

      const result = awardKill(state, 'killer', 'victim', [])
      expect(result.players['killer']!.scrip).toBe(100 + KILL_BOUNTY_BASE)
    })

    it('applies the comeback BONUS to the bounty for a team far behind', () => {
      const state = makeGameState({
        players: {
          killer: makePlayer({ id: 'killer', team: 'chaff', scrip: 0 }),
          victim: makePlayer({ id: 'victim', team: 'audit', scrip: 10_000 }),
        },
      })
      const mult = comebackMultiplier(state, 'chaff') // far behind → 1.5
      expect(mult).toBeCloseTo(1.5, 5)
      const result = awardKill(state, 'killer', 'victim', [])
      expect(result.players['killer']!.scrip).toBe(Math.round(KILL_BOUNTY_BASE * mult))
    })

    it('applies the comeback PENALTY to the bounty for a team far ahead', () => {
      const state = makeGameState({
        players: {
          killer: makePlayer({ id: 'killer', team: 'chaff', scrip: 10_000 }),
          victim: makePlayer({ id: 'victim', team: 'audit', scrip: 0 }),
        },
      })
      const mult = comebackMultiplier(state, 'chaff') // far ahead → 0.7
      expect(mult).toBeCloseTo(0.7, 5)
      const result = awardKill(state, 'killer', 'victim', [])
      expect(result.players['killer']!.scrip).toBe(10_000 + Math.round(KILL_BOUNTY_BASE * mult))
    })

    it('should award shutdown bonus based on the victim kill streak', () => {
      const state = makeGameState({
        players: {
          killer: makePlayer({ id: 'killer', scrip: 100 }),
          victim: makePlayer({ id: 'victim', team: 'audit', scrip: 100, killStreak: 3 }),
        },
      })

      const expectedGold = KILL_BOUNTY_BASE + KILL_BOUNTY_PER_STREAK * 3
      const result = awardKill(state, 'killer', 'victim', [])
      expect(result.players['killer']!.scrip).toBe(100 + expectedGold)
    })

    it('should cap the shutdown bonus at a 10 streak', () => {
      const state = makeGameState({
        players: {
          killer: makePlayer({ id: 'killer', scrip: 100 }),
          victim: makePlayer({ id: 'victim', team: 'audit', scrip: 100, killStreak: 15 }),
        },
      })

      const expectedGold = KILL_BOUNTY_BASE + KILL_BOUNTY_PER_STREAK * 10
      const result = awardKill(state, 'killer', 'victim', [])
      expect(result.players['killer']!.scrip).toBe(100 + expectedGold)
    })

    it('killer own streak does not inflate the bounty', () => {
      const state = makeGameState({
        players: {
          killer: makePlayer({ id: 'killer', scrip: 100, kills: 8, killStreak: 8 }),
          victim: makePlayer({ id: 'victim', team: 'audit', scrip: 100, killStreak: 0 }),
        },
      })

      const result = awardKill(state, 'killer', 'victim', [])
      expect(result.players['killer']!.scrip).toBe(100 + KILL_BOUNTY_BASE)
    })

    it('should split assist scrip among assisters', () => {
      const state = makeGameState({
        players: {
          killer: makePlayer({ id: 'killer', scrip: 100, kills: 0 }),
          victim: makePlayer({ id: 'victim', team: 'audit', scrip: 100 }),
          a1: makePlayer({ id: 'a1', scrip: 100 }),
          a2: makePlayer({ id: 'a2', scrip: 100 }),
        },
      })

      const result = awardKill(state, 'killer', 'victim', ['a1', 'a2'])
      const assistGoldEach = Math.floor(ASSIST_SCRIP / 2)
      expect(result.players['a1']!.scrip).toBe(100 + assistGoldEach)
      expect(result.players['a2']!.scrip).toBe(100 + assistGoldEach)
    })

    it('should give full assist scrip to single assister', () => {
      const state = makeGameState({
        players: {
          killer: makePlayer({ id: 'killer', scrip: 100, kills: 0 }),
          victim: makePlayer({ id: 'victim', team: 'audit', scrip: 100 }),
          a1: makePlayer({ id: 'a1', scrip: 100 }),
        },
      })

      const result = awardKill(state, 'killer', 'victim', ['a1'])
      expect(result.players['a1']!.scrip).toBe(100 + ASSIST_SCRIP)
    })

    it('should not give assist scrip when no assisters', () => {
      const state = makeGameState({
        players: {
          killer: makePlayer({ id: 'killer', scrip: 100, kills: 0 }),
          victim: makePlayer({ id: 'victim', team: 'audit', scrip: 100 }),
        },
      })

      const result = awardKill(state, 'killer', 'victim', [])
      // Only killer should get scrip
      expect(result.players['killer']!.scrip).toBe(100 + KILL_BOUNTY_BASE)
      expect(result.players['victim']!.scrip).toBe(100)
    })

    it('should prevent killer from double-dipping assist gold', () => {
      // Balanced team net worth so the comeback multiplier is 1.
      // Chaff: killer(100) + a1(100) + a2(100) = 300
      // Audit: victim(100) + d1(100) + d2(100) = 300
      const state = makeGameState({
        players: {
          killer: makePlayer({ id: 'killer', scrip: 100, kills: 0 }),
          victim: makePlayer({ id: 'victim', team: 'audit', scrip: 100 }),
          a1: makePlayer({ id: 'a1', scrip: 100 }),
          a2: makePlayer({ id: 'a2', scrip: 100 }),
          d1: makePlayer({ id: 'd1', team: 'audit', scrip: 100 }),
          d2: makePlayer({ id: 'd2', team: 'audit', scrip: 100 }),
        },
      })

      // Killer is also in assisters list (should not get assist scrip)
      const result = awardKill(state, 'killer', 'victim', ['killer', 'a1', 'a2'])

      // Killer should only get kill bounty, not assist scrip
      expect(result.players['killer']!.scrip).toBe(100 + KILL_BOUNTY_BASE)

      // Assisters should split assist scrip (100 / 2 = 50 each)
      const assistGoldEach = Math.floor(ASSIST_SCRIP / 2)
      expect(result.players['a1']!.scrip).toBe(100 + assistGoldEach)
      expect(result.players['a2']!.scrip).toBe(100 + assistGoldEach)
    })

    it('should return state unchanged for unknown killer', () => {
      const state = makeGameState({
        players: {
          victim: makePlayer({ id: 'victim', team: 'audit', scrip: 100 }),
        },
      })

      const result = awardKill(state, 'unknown', 'victim', [])
      expect(result).toEqual(state)
    })

    it('should return state unchanged for unknown victim', () => {
      const state = makeGameState({
        players: {
          killer: makePlayer({ id: 'killer', scrip: 100, kills: 0 }),
        },
      })

      const result = awardKill(state, 'killer', 'unknown', [])
      expect(result).toEqual(state)
    })
  })

  describe('awardIceKill', () => {
    it('should split ice scrip evenly among nearby allies', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', scrip: 100 }),
          p2: makePlayer({ id: 'p2', scrip: 200 }),
        },
      })

      const result = awardIceKill(state, 'mid-t1-audit', ['p1', 'p2'])
      const goldEach = Math.floor(ICE_SCRIP / 2)
      expect(result.players['p1']!.scrip).toBe(100 + goldEach)
      expect(result.players['p2']!.scrip).toBe(200 + goldEach)
    })

    it('should give all ice scrip to a single ally', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', scrip: 100 }),
        },
      })

      const result = awardIceKill(state, 'mid-t1-audit', ['p1'])
      expect(result.players['p1']!.scrip).toBe(100 + ICE_SCRIP)
    })

    it('should return state unchanged with no nearby allies', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', scrip: 100 }),
        },
      })

      const result = awardIceKill(state, 'mid-t1-audit', [])
      expect(result).toEqual(state)
    })

    it('should floor the scrip split (no fractional scrip)', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', scrip: 0 }),
          p2: makePlayer({ id: 'p2', scrip: 0 }),
          p3: makePlayer({ id: 'p3', scrip: 0 }),
        },
      })

      const result = awardIceKill(state, 'mid-t1-audit', ['p1', 'p2', 'p3'])
      const goldEach = Math.floor(ICE_SCRIP / 3)
      expect(result.players['p1']!.scrip).toBe(goldEach)
      expect(result.players['p2']!.scrip).toBe(goldEach)
      expect(result.players['p3']!.scrip).toBe(goldEach)
    })
  })

  describe('comebackMultiplier', () => {
    it('returns ~1 when teams are equal in net worth', () => {
      const state = makeGameState({
        players: {
          r1: makePlayer({ id: 'r1', scrip: 1000 }),
          d1: makePlayer({ id: 'd1', team: 'audit', scrip: 1000 }),
        },
      })
      expect(comebackMultiplier(state, 'chaff')).toBe(1)
    })

    it('boosts kill scrip for the team that is far behind', () => {
      const state = makeGameState({
        players: {
          r1: makePlayer({ id: 'r1', scrip: 0 }),
          d1: makePlayer({ id: 'd1', team: 'audit', scrip: 10_000 }),
        },
      })
      // Chaff is 10k behind → ratio capped at 1, multiplier = 1 + 0.5 = 1.5
      expect(comebackMultiplier(state, 'chaff')).toBeCloseTo(1.5, 5)
    })

    it('penalizes kill scrip for the team that is far ahead', () => {
      const state = makeGameState({
        players: {
          r1: makePlayer({ id: 'r1', scrip: 10_000 }),
          d1: makePlayer({ id: 'd1', team: 'audit', scrip: 0 }),
        },
      })
      // Chaff is 10k ahead → ratio = -1, multiplier = 1 - 0.3 = 0.7
      expect(comebackMultiplier(state, 'chaff')).toBeCloseTo(0.7, 5)
    })

    it('scales linearly with the gap below the full-gap cap', () => {
      // Behind by HALF the full gap → half the bonus; ahead by half → half the penalty.
      const half = COMEBACK_FULL_GAP / 2
      const behind = makeGameState({
        players: {
          r1: makePlayer({ id: 'r1', scrip: 0 }),
          d1: makePlayer({ id: 'd1', team: 'audit', scrip: half }),
        },
      })
      expect(comebackMultiplier(behind, 'chaff')).toBeCloseTo(1 + 0.5 * COMEBACK_BONUS_MAX, 5)
      expect(comebackMultiplier(behind, 'audit')).toBeCloseTo(1 - 0.5 * COMEBACK_PENALTY_MAX, 5)
    })

    it('clamps at the cap beyond the full gap (no runaway)', () => {
      // Twice the full gap must not exceed the max bonus/penalty.
      const state = makeGameState({
        players: {
          r1: makePlayer({ id: 'r1', scrip: 0 }),
          d1: makePlayer({ id: 'd1', team: 'audit', scrip: COMEBACK_FULL_GAP * 2 }),
        },
      })
      expect(comebackMultiplier(state, 'chaff')).toBe(1 + COMEBACK_BONUS_MAX)
      expect(comebackMultiplier(state, 'audit')).toBe(1 - COMEBACK_PENALTY_MAX)
    })
  })

  describe('xpComebackMultiplier', () => {
    it('returns ~1 when teams are equal in average level', () => {
      const state = makeGameState({
        players: {
          r1: makePlayer({ id: 'r1', level: 10 }),
          d1: makePlayer({ id: 'd1', team: 'audit', level: 10 }),
        },
      })
      expect(xpComebackMultiplier(state, 'chaff')).toBe(1)
    })

    it('boosts kill XP for the team that is far behind in levels', () => {
      const state = makeGameState({
        players: {
          r1: makePlayer({ id: 'r1', level: 5 }),
          d1: makePlayer({ id: 'd1', team: 'audit', level: 5 + XP_COMEBACK_FULL_LEVEL_GAP }),
        },
      })
      // Chaff is a full level-gap behind → ratio capped at 1 → 1 + bonus max
      expect(xpComebackMultiplier(state, 'chaff')).toBeCloseTo(1 + XP_COMEBACK_BONUS_MAX, 5)
    })

    it('penalizes kill XP for the team that is far ahead in levels', () => {
      const state = makeGameState({
        players: {
          r1: makePlayer({ id: 'r1', level: 5 + XP_COMEBACK_FULL_LEVEL_GAP }),
          d1: makePlayer({ id: 'd1', team: 'audit', level: 5 }),
        },
      })
      // Chaff is a full level-gap ahead → ratio = -1 → 1 - penalty max
      expect(xpComebackMultiplier(state, 'chaff')).toBeCloseTo(1 - XP_COMEBACK_PENALTY_MAX, 5)
    })

    it('uses the team AVERAGE level (multiple players per side)', () => {
      const state = makeGameState({
        players: {
          r1: makePlayer({ id: 'r1', level: 4 }),
          r2: makePlayer({ id: 'r2', level: 6 }), // chaff avg = 5
          d1: makePlayer({ id: 'd1', team: 'audit', level: 10 }),
          d2: makePlayer({ id: 'd2', team: 'audit', level: 10 }), // audit avg = 10
        },
      })
      // Chaff behind by 5 avg levels = full gap → full bonus
      expect(xpComebackMultiplier(state, 'chaff')).toBeCloseTo(1 + XP_COMEBACK_BONUS_MAX, 5)
    })

    it('scales linearly with the level gap below the full-gap cap', () => {
      const halfGap = XP_COMEBACK_FULL_LEVEL_GAP / 2
      const behind = makeGameState({
        players: {
          r1: makePlayer({ id: 'r1', level: 10 }),
          d1: makePlayer({ id: 'd1', team: 'audit', level: 10 + halfGap }),
        },
      })
      expect(xpComebackMultiplier(behind, 'chaff')).toBeCloseTo(1 + 0.5 * XP_COMEBACK_BONUS_MAX, 5)
      expect(xpComebackMultiplier(behind, 'audit')).toBeCloseTo(
        1 - 0.5 * XP_COMEBACK_PENALTY_MAX,
        5,
      )
    })

    it('returns 1 when a team has no players (degenerate)', () => {
      const state = makeGameState({
        players: { r1: makePlayer({ id: 'r1', level: 10 }) },
      })
      expect(xpComebackMultiplier(state, 'chaff')).toBe(1)
    })
  })

  describe('playerNetWorth', () => {
    it('is just scrip when the player holds no items', () => {
      expect(playerNetWorth(makePlayer({ scrip: 750 }))).toBe(750)
    })

    it('adds each held item’s shop cost and ignores empty slots', () => {
      const [a, b] = Object.keys(ITEMS)
      const player = makePlayer({ scrip: 600, items: [a!, null, b!, null, null, null] })
      expect(playerNetWorth(player)).toBe(600 + ITEMS[a!]!.cost + ITEMS[b!]!.cost)
    })
  })
})
