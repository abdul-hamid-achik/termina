import { describe, it, expect, beforeEach } from 'vitest'
import { Effect } from 'effect'
import { resolveActions, type PlayerAction } from '../../../server/game/engine/ActionResolver'
import { processRoshanDamage, runRoshanAI } from '../../../server/game/engine/RoshanAI'
import type { GameState, PlayerState, RoshanState } from '../../../shared/types/game'
import { initializeZoneStates, initializeTowers } from '../../../server/game/map/zones'
import { initializeRoshan } from '../../../server/game/map/spawner'

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
    neutrals: [],
    towers: initializeTowers(),
    runes: [],
    roshan: initializeRoshan(),
    aegis: null,
    events: [],
    ...overrides,
  }
}

describe('RoshanAI', () => {
  describe('runRoshanAI', () => {
    it('should return no actions when Roshan is dead', () => {
      const state = makeGameState({
        roshan: { alive: false, hp: 0, maxHp: 5000, deathTick: 10 },
        players: {
          p1: makePlayer({ id: 'p1', zone: 'roshan-pit' }),
        },
      })

      const actions = runRoshanAI(state)
      expect(actions).toHaveLength(0)
    })

    it('should attack heroes in roshan-pit', () => {
      const state = makeGameState({
        roshan: { alive: true, hp: 5000, maxHp: 5000, deathTick: null },
        players: {
          p1: makePlayer({ id: 'p1', zone: 'roshan-pit', hp: 300 }),
        },
      })

      const actions = runRoshanAI(state)
      expect(actions).toHaveLength(1)
      expect(actions[0]!.targetId).toBe('p1')
      expect(actions[0]!.damage).toBeGreaterThan(0)
    })

    it('should target lowest HP hero in pit', () => {
      const state = makeGameState({
        roshan: { alive: true, hp: 5000, maxHp: 5000, deathTick: null },
        players: {
          p1: makePlayer({ id: 'p1', zone: 'roshan-pit', hp: 400 }),
          p2: makePlayer({ id: 'p2', zone: 'roshan-pit', hp: 100, team: 'radiant' }),
        },
      })

      const actions = runRoshanAI(state)
      expect(actions).toHaveLength(1)
      expect(actions[0]!.targetId).toBe('p2')
    })

    it('should not attack heroes outside roshan-pit', () => {
      const state = makeGameState({
        roshan: { alive: true, hp: 5000, maxHp: 5000, deathTick: null },
        players: {
          p1: makePlayer({ id: 'p1', zone: 'mid-river' }),
        },
      })

      const actions = runRoshanAI(state)
      expect(actions).toHaveLength(0)
    })
  })

  describe('processRoshanDamage', () => {
    it('should apply damage to Roshan HP when heroes attack Roshan', () => {
      const state = makeGameState({
        roshan: { alive: true, hp: 5000, maxHp: 5000, deathTick: null },
      })

      const damageDealt = new Map<string, number>()
      damageDealt.set('p1', 500)
      damageDealt.set('p2', 300)

      const result = processRoshanDamage(state, damageDealt)

      expect(result.state.roshan.hp).toBe(4200)
      expect(result.roshanKilled).toBe(false)
    })

    it('should handle Roshan death when HP reaches 0', () => {
      const state = makeGameState({
        tick: 100,
        roshan: { alive: true, hp: 500, maxHp: 5000, deathTick: null },
        players: {
          p1: makePlayer({ id: 'p1', zone: 'roshan-pit' }),
          p2: makePlayer({ id: 'p2', zone: 'roshan-pit', team: 'dire' }),
        },
      })

      const damageDealt = new Map<string, number>()
      damageDealt.set('p1', 300)
      damageDealt.set('p2', 300)

      const result = processRoshanDamage(state, damageDealt)

      expect(result.roshanKilled).toBe(true)
      expect(result.aegisDropped).toBe(true)
      expect(result.state.roshan.alive).toBe(false)
      expect(result.state.roshan.hp).toBe(0)
    })

    it('should distribute gold to damage dealers on Roshan kill', () => {
      const state = makeGameState({
        tick: 100,
        roshan: { alive: true, hp: 500, maxHp: 5000, deathTick: null },
        players: {
          p1: makePlayer({ id: 'p1', zone: 'roshan-pit', gold: 0 }),
          p2: makePlayer({ id: 'p2', zone: 'roshan-pit', team: 'dire', gold: 0 }),
        },
      })

      const damageDealt = new Map<string, number>()
      damageDealt.set('p1', 300)
      damageDealt.set('p2', 200)

      const result = processRoshanDamage(state, damageDealt)

      const totalGold = result.state.players['p1']!.gold + result.state.players['p2']!.gold
      expect(totalGold).toBeGreaterThan(0)
    })

    it('should drop aegis in roshan-pit on death', () => {
      const state = makeGameState({
        tick: 100,
        roshan: { alive: true, hp: 500, maxHp: 5000, deathTick: null },
        players: {
          p1: makePlayer({ id: 'p1', zone: 'roshan-pit' }),
        },
      })

      const damageDealt = new Map<string, number>()
      damageDealt.set('p1', 500)

      const result = processRoshanDamage(state, damageDealt)

      expect(result.aegisDropped).toBe(true)
      expect(result.state.aegis).not.toBeNull()
      expect(result.state.aegis!.zone).toBe('roshan-pit')
    })

    it('should not apply damage when Roshan is dead', () => {
      const state = makeGameState({
        roshan: { alive: false, hp: 0, maxHp: 5000, deathTick: 10 },
      })

      const damageDealt = new Map<string, number>()
      damageDealt.set('p1', 500)

      const result = processRoshanDamage(state, damageDealt)

      expect(result.state.roshan.hp).toBe(0)
      expect(result.roshanKilled).toBe(false)
    })
  })

  describe('resolveActions - Roshan attacks', () => {
    it('should apply damage to Roshan HP when heroes attack Roshan via ActionResolver', () => {
      const initialRoshan: RoshanState = { alive: true, hp: 5000, maxHp: 5000, deathTick: null }
      const state = makeGameState({
        roshan: initialRoshan,
        players: {
          p1: makePlayer({ id: 'p1', zone: 'roshan-pit', heroId: 'echo' }),
        },
      })

      const actions: PlayerAction[] = [
        { playerId: 'p1', command: { type: 'attack', target: { kind: 'roshan' } } },
      ]

      const result = Effect.runSync(resolveActions(state, actions))

      const damageEvents = result.events.filter(
        (e) => e._tag === 'damage' && 'targetId' in e && e.targetId === 'roshan',
      )
      expect(damageEvents.length).toBeGreaterThan(0)
      if (damageEvents.length > 0 && 'amount' in damageEvents[0]!) {
        expect((damageEvents[0] as { amount: number }).amount).toBeGreaterThan(0)
      }
    })
  })
})
