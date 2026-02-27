import { describe, it, expect, beforeEach } from 'vitest'
import { Effect } from 'effect'
import { processTick, submitAction } from '../../../server/game/engine/GameLoop'
import type { GameState, PlayerState } from '../../../shared/types/game'
import { initializeZoneStates, initializeTowers } from '../../../server/game/map/zones'
import { resetCreepIdCounter } from '../../../server/game/map/spawner'

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
    kills: 0,
    deaths: 0,
    assists: 0,
    ...overrides,
  }
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    tick: 0,
    phase: 'playing',
    teams: {
      radiant: { id: 'radiant', kills: 0, towerKills: 0, gold: 0 },
      dire: { id: 'dire', kills: 0, towerKills: 0, gold: 0 },
    },
    players: {
      p1: makePlayer({ id: 'p1', team: 'radiant', zone: 'radiant-fountain' }),
      p2: makePlayer({ id: 'p2', team: 'dire', zone: 'dire-fountain', name: 'Player2' }),
    },
    zones: initializeZoneStates(),
    creeps: [],
    towers: initializeTowers(),
    events: [],
    ...overrides,
  }
}

describe('GameLoop', () => {
  beforeEach(() => {
    resetCreepIdCounter()
  })

  describe('processTick', () => {
    it('should increment the tick counter', () => {
      const state = makeGameState({ tick: 5 })
      const result = Effect.runSync(processTick('game1', state))
      expect(result.state.tick).toBe(6)
    })

    it('should distribute passive gold to alive players', () => {
      const state = makeGameState()
      const result = Effect.runSync(processTick('game1', state))

      // Both players start with 600g, should get +1 passive gold
      expect(result.state.players['p1']!.gold).toBe(601)
      expect(result.state.players['p2']!.gold).toBe(601)
    })

    it('should not give passive gold to dead players', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', alive: false, hp: 0, respawnTick: 10 }),
          p2: makePlayer({ id: 'p2', team: 'dire', zone: 'dire-fountain' }),
        },
      })
      const result = Effect.runSync(processTick('game1', state))
      expect(result.state.players['p1']!.gold).toBe(600) // no gold for dead
      expect(result.state.players['p2']!.gold).toBe(601) // alive gets gold
    })

    it('should process submitted actions', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', zone: 'mid-t1-rad' }),
          p2: makePlayer({ id: 'p2', team: 'dire', zone: 'dire-fountain' }),
        },
      })

      submitAction('game-test', 'p1', { type: 'move', zone: 'mid-river' })
      const result = Effect.runSync(processTick('game-test', state))
      expect(result.state.players['p1']!.zone).toBe('mid-river')
    })

    it('should spawn creep waves at wave intervals', () => {
      // Tick 7 -> tick 8 (first wave spawns at tick 8)
      const state = makeGameState({ tick: 7 })
      const result = Effect.runSync(processTick('game2', state))
      expect(result.state.tick).toBe(8)
      // Should have spawned creeps (3 melee + 1 ranged per lane per team = 24 creeps)
      expect(result.state.creeps.length).toBeGreaterThan(0)
    })

    it('should not spawn creeps on non-wave ticks', () => {
      const state = makeGameState({ tick: 5 })
      const result = Effect.runSync(processTick('game3', state))
      expect(result.state.tick).toBe(6)
      expect(result.state.creeps.length).toBe(0)
    })

    it('should heal players in fountain', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            zone: 'radiant-fountain',
            hp: 100,
            maxHp: 500,
            mp: 50,
            maxMp: 200,
          }),
          p2: makePlayer({ id: 'p2', team: 'dire', zone: 'dire-fountain' }),
        },
      })

      const result = Effect.runSync(processTick('game4', state))
      // Fountain heals 25% per tick: 500 * 0.25 = 125
      expect(result.state.players['p1']!.hp).toBe(225)
      // Mana: 200 * 0.25 = 50
      expect(result.state.players['p1']!.mp).toBe(100)
    })

    it('should respawn dead players when respawn tick is reached', () => {
      const state = makeGameState({
        tick: 9,
        players: {
          p1: makePlayer({
            id: 'p1',
            alive: false,
            hp: 0,
            maxHp: 500,
            maxMp: 200,
            respawnTick: 10,
          }),
          p2: makePlayer({ id: 'p2', team: 'dire', zone: 'dire-fountain' }),
        },
      })

      const result = Effect.runSync(processTick('game5', state))
      expect(result.state.tick).toBe(10)
      const p1 = result.state.players['p1']!
      expect(p1.alive).toBe(true)
      expect(p1.hp).toBe(500) // Full HP
      expect(p1.zone).toBe('radiant-fountain')
    })

    it('should detect win when all enemy towers destroyed', () => {
      const towers = initializeTowers().map((t) =>
        t.team === 'dire' ? { ...t, hp: 0, alive: false } : t,
      )

      const state = makeGameState({
        towers,
        players: {
          p1: makePlayer({ id: 'p1' }),
          p2: makePlayer({ id: 'p2', team: 'dire', zone: 'dire-fountain' }),
        },
      })

      const result = Effect.runSync(processTick('game6', state))
      expect(result.state.phase).toBe('ended')
    })

    it('should handle only one action per player per tick', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', zone: 'mid-t1-rad' }),
          p2: makePlayer({ id: 'p2', team: 'dire', zone: 'dire-fountain' }),
        },
      })

      // Submit two actions for same player — second should override
      submitAction('game-override', 'p1', { type: 'move', zone: 'mid-t2-rad' })
      submitAction('game-override', 'p1', { type: 'move', zone: 'mid-river' })

      const result = Effect.runSync(processTick('game-override', state))
      expect(result.state.players['p1']!.zone).toBe('mid-river')
    })
  })
})
