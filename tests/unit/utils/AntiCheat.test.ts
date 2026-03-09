import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  runAntiCheatChecks,
  validateVision,
  validateCooldowns,
  validateActionTiming,
  validatePlayerStats,
  getPlayerViolations,
  getCriticalViolators,
  clearPlayerViolations,
  cleanupAntiCheat,
} from '~~/server/utils/AntiCheat'
import type { GameState, PlayerState } from '~~/shared/types/game'
import type { Command } from '~~/shared/types/commands'
import { initializeZoneStates, initializeTowers } from '~~/server/game/map/zones'

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'test_player',
    name: 'TestPlayer',
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
    events: [],
    ...overrides,
  }
}

describe('AntiCheat', () => {
  beforeEach(() => {
    cleanupAntiCheat()
  })

  afterEach(() => {
    cleanupAntiCheat()
  })

  describe('validateVision', () => {
    it('should allow movement to adjacent zones', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', zone: 'mid-t1-rad' }),
        },
      })

      const command: Command = { type: 'move', zone: 'mid-t2-rad' }
      const violation = validateVision(state, 'p1', command)
      expect(violation).toBeNull()
    })

    it('should detect vision bypass attempts', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', zone: 'mid-t1-rad' }),
        },
      })

      // Attempt to move to non-adjacent zone (enemy base)
      const command: Command = { type: 'move', zone: 'dire-fountain' }
      const violation = validateVision(state, 'p1', command)
      expect(violation).not.toBeNull()
      expect(violation?.violationType).toBe('INVALID_MOVE')
    })

    it('should detect ward placement in invisible zones', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', zone: 'mid-t1-rad' }),
        },
      })

      const command: Command = { type: 'ward', zone: 'dire-fountain' }
      const violation = validateVision(state, 'p1', command)
      expect(violation).not.toBeNull()
      expect(violation?.violationType).toBe('VISION_BYPASS')
    })
  })

  describe('validateCooldowns', () => {
    it('should allow casting when abilities are off cooldown', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            heroId: 'echo',
            cooldowns: { q: 0, w: 0, e: 0, r: 0 },
          }),
        },
      })

      const command: Command = { type: 'cast', ability: 'q' }
      const violation = validateCooldowns(state, 'p1', command)
      expect(violation).toBeNull()
    })

    it('should detect cooldown manipulation', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            heroId: 'echo',
            cooldowns: { q: 5, w: 0, e: 0, r: 0 },
          }),
        },
      })

      const command: Command = { type: 'cast', ability: 'q' }
      const violation = validateCooldowns(state, 'p1', command)
      expect(violation).not.toBeNull()
      expect(violation?.violationType).toBe('COOLDOWN_MANIPULATION')
    })
  })

  describe('validateActionTiming', () => {
    it('should detect casting while stunned', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            buffs: [{ id: 'stun', stacks: 1, ticksRemaining: 2, source: 'enemy' }],
          }),
        },
      })

      const command: Command = { type: 'cast', ability: 'q' }
      const violation = validateActionTiming(state, 'p1', command)
      expect(violation).not.toBeNull()
      expect(violation?.violationType).toBe('IMPOSSIBLE_ACTION')
    })

    it('should detect attacking while stunned', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            buffs: [{ id: 'stun', stacks: 1, ticksRemaining: 2, source: 'enemy' }],
          }),
        },
      })

      const command: Command = { type: 'attack', target: { kind: 'hero', name: 'enemy' } }
      const violation = validateActionTiming(state, 'p1', command)
      expect(violation).not.toBeNull()
      expect(violation?.violationType).toBe('IMPOSSIBLE_ACTION')
    })

    it('should detect casting while silenced', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            buffs: [{ id: 'silence', stacks: 1, ticksRemaining: 2, source: 'enemy' }],
          }),
        },
      })

      const command: Command = { type: 'cast', ability: 'q' }
      const violation = validateActionTiming(state, 'p1', command)
      expect(violation).not.toBeNull()
      expect(violation?.violationType).toBe('IMPOSSIBLE_ACTION')
    })
  })

  describe('validatePlayerStats', () => {
    it('should allow valid player stats', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', hp: 500, maxHp: 500, mp: 200, maxMp: 200 }),
        },
      })

      const violation = validatePlayerStats(state, 'p1')
      expect(violation).toBeNull()
    })

    it('should detect HP exceeding max', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', hp: 600, maxHp: 500 }),
        },
      })

      const violation = validatePlayerStats(state, 'p1')
      expect(violation).not.toBeNull()
      expect(violation?.violationType).toBe('STAT_MISMATCH')
      expect(violation?.severity).toBe('critical')
    })

    it('should detect MP exceeding max', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', mp: 300, maxMp: 200 }),
        },
      })

      const violation = validatePlayerStats(state, 'p1')
      expect(violation).not.toBeNull()
      expect(violation?.violationType).toBe('STAT_MISMATCH')
    })

    it('should detect level exceeding max', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', level: 30 }),
        },
      })

      const violation = validatePlayerStats(state, 'p1')
      expect(violation).not.toBeNull()
      expect(violation?.violationType).toBe('STAT_MISMATCH')
    })

    it('should detect negative gold', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', gold: -100 }),
        },
      })

      const violation = validatePlayerStats(state, 'p1')
      expect(violation).not.toBeNull()
      expect(violation?.violationType).toBe('STAT_MISMATCH')
    })

    it('should detect more than 6 items', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            items: ['item1', 'item2', 'item3', 'item4', 'item5', 'item6', 'item7'] as unknown as (
              | string
              | null
            )[],
          }),
        },
      })

      const violation = validatePlayerStats(state, 'p1')
      expect(violation).not.toBeNull()
      expect(violation?.violationType).toBe('STAT_MISMATCH')
    })
  })

  describe('runAntiCheatChecks', () => {
    it('should run all validations and return violations', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            hp: 600,
            maxHp: 500,
            cooldowns: { q: 5, w: 0, e: 0, r: 0 },
          }),
        },
      })

      const command: Command = { type: 'cast', ability: 'q' }
      const violations = runAntiCheatChecks(state, 'p1', command)

      expect(violations.length).toBeGreaterThan(0)
      expect(violations.some((v) => v.violationType === 'COOLDOWN_MANIPULATION')).toBe(true)
      expect(violations.some((v) => v.violationType === 'STAT_MISMATCH')).toBe(true)
    })

    it('should record violations for player', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', hp: 600, maxHp: 500 }),
        },
      })

      const command: Command = { type: 'move', zone: 'mid-t2-rad' }
      runAntiCheatChecks(state, 'p1', command)

      const playerViolations = getPlayerViolations('p1')
      expect(playerViolations.length).toBeGreaterThan(0)
    })
  })

  describe('getCriticalViolators', () => {
    it('should return players with critical or multiple high violations', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', hp: 600, maxHp: 500 }), // Critical
          p2: makePlayer({ id: 'p2' }),
          p3: makePlayer({ id: 'p3' }),
        },
      })

      // Generate critical violation for p1
      runAntiCheatChecks(state, 'p1', { type: 'move', zone: 'mid-t2-rad' })

      // Generate 3 high violations for p2 (vision bypass)
      for (let i = 0; i < 3; i++) {
        runAntiCheatChecks(state, 'p2', { type: 'ward', zone: 'dire-fountain' })
      }

      // Generate 1 low violation for p3
      const command: Command = { type: 'move', zone: 'mid-t2-rad' }
      runAntiCheatChecks(state, 'p3', command)

      const criticalViolators = getCriticalViolators()
      expect(
        criticalViolators.some(
          (v: { playerId: string; violationCount: number }) => v.playerId === 'p1',
        ),
      ).toBe(true)
      expect(
        criticalViolators.some(
          (v: { playerId: string; violationCount: number }) => v.playerId === 'p2',
        ),
      ).toBe(true)
      expect(
        criticalViolators.some(
          (v: { playerId: string; violationCount: number }) => v.playerId === 'p3',
        ),
      ).toBe(false)
    })
  })

  describe('cleanup', () => {
    it('should clear violations for specific player', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', hp: 600, maxHp: 500 }),
          p2: makePlayer({ id: 'p2', hp: 600, maxHp: 500 }),
        },
      })

      runAntiCheatChecks(state, 'p1', { type: 'move', zone: 'mid-t2-rad' })
      runAntiCheatChecks(state, 'p2', { type: 'move', zone: 'mid-t2-rad' })

      clearPlayerViolations('p1')

      expect(getPlayerViolations('p1')).toHaveLength(0)
      expect(getPlayerViolations('p2')).not.toHaveLength(0)
    })

    it('should clear all violations on cleanup', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', hp: 600, maxHp: 500 }),
          p2: makePlayer({ id: 'p2', hp: 600, maxHp: 500 }),
        },
      })

      runAntiCheatChecks(state, 'p1', { type: 'move', zone: 'mid-t2-rad' })
      runAntiCheatChecks(state, 'p2', { type: 'move', zone: 'mid-t2-rad' })

      cleanupAntiCheat()

      expect(getPlayerViolations('p1')).toHaveLength(0)
      expect(getPlayerViolations('p2')).toHaveLength(0)
    })
  })
})
