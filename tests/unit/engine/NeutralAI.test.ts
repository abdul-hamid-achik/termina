import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  spawnNeutralCreeps,
  runNeutralAI,
  applyNeutralActions,
  resetNeutralIdCounter,
} from '../../../server/game/engine/NeutralAI'
import type { GameState, PlayerState, NeutralCreepState } from '../../../shared/types/game'
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
    tick: 60,
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

describe('NeutralAI', () => {
  beforeEach(() => {
    resetNeutralIdCounter()
  })

  afterEach(() => {
    resetNeutralIdCounter()
  })

  describe('spawnNeutralCreeps', () => {
    it('should spawn neutrals at tick 60', () => {
      const neutrals = spawnNeutralCreeps(60)
      expect(neutrals.length).toBeGreaterThan(0)
    })

    it('should not spawn neutrals at non-interval ticks', () => {
      const neutrals = spawnNeutralCreeps(50)
      expect(neutrals.length).toBe(0)
    })

    it('should generate unique neutral IDs per game instance', () => {
      const neutrals1 = spawnNeutralCreeps(60)
      resetNeutralIdCounter()
      const neutrals2 = spawnNeutralCreeps(60)

      const ids1 = new Set(neutrals1.map((n) => n.id))
      const ids2 = new Set(neutrals2.map((n) => n.id))

      expect(ids1.size).toBe(neutrals1.length)
      expect(ids2.size).toBe(neutrals2.length)

      const overlap = [...ids1].filter((id) => ids2.has(id))
      expect(overlap.length).toBe(0)
    })

    it('should spawn neutrals in jungle zones', () => {
      const neutrals = spawnNeutralCreeps(60)
      const jungleZones = ['jungle-rad-top', 'jungle-rad-bot', 'jungle-dire-top', 'jungle-dire-bot']

      for (const neutral of neutrals) {
        expect(jungleZones).toContain(neutral.zone)
      }
    })

    it('should spawn neutrals with valid types', () => {
      const neutrals = spawnNeutralCreeps(60)
      const validTypes = ['kobold', 'ogre_mage', 'centaur', 'ancient_dragon', 'ancient_rock_golem']

      for (const neutral of neutrals) {
        expect(validTypes).toContain(neutral.type)
      }
    })
  })

  describe('runNeutralAI', () => {
    it('should attack heroes in the same zone', () => {
      const state = makeGameState({
        neutrals: [
          {
            id: 'neutral_1',
            zone: 'jungle-rad-top',
            hp: 100,
            maxHp: 100,
            type: 'kobold',
            alive: true,
          },
        ],
        players: {
          p1: makePlayer({ id: 'p1', zone: 'jungle-rad-top', hp: 500 }),
        },
      })

      const actions = runNeutralAI(state)
      expect(actions.length).toBeGreaterThan(0)
      expect(actions[0]!.neutralId).toBe('neutral_1')
      expect(actions[0]!.targetId).toBe('p1')
    })

    it('should not attack heroes in different zones', () => {
      const state = makeGameState({
        neutrals: [
          {
            id: 'neutral_1',
            zone: 'jungle-rad-top',
            hp: 100,
            maxHp: 100,
            type: 'kobold',
            alive: true,
          },
        ],
        players: {
          p1: makePlayer({ id: 'p1', zone: 'mid-river' }),
        },
      })

      const actions = runNeutralAI(state)
      expect(actions.length).toBe(0)
    })

    it('should not attack when neutral is dead', () => {
      const state = makeGameState({
        neutrals: [
          {
            id: 'neutral_1',
            zone: 'jungle-rad-top',
            hp: 0,
            maxHp: 100,
            type: 'kobold',
            alive: false,
          },
        ],
        players: {
          p1: makePlayer({ id: 'p1', zone: 'jungle-rad-top' }),
        },
      })

      const actions = runNeutralAI(state)
      expect(actions.length).toBe(0)
    })
  })

  describe('applyNeutralActions', () => {
    it('should apply damage to players from neutral attacks', () => {
      const state = makeGameState({
        neutrals: [
          {
            id: 'neutral_1',
            zone: 'jungle-rad-top',
            hp: 100,
            maxHp: 100,
            type: 'kobold',
            alive: true,
          },
        ],
        players: {
          p1: makePlayer({ id: 'p1', zone: 'jungle-rad-top', hp: 500 }),
        },
      })

      const actions = [{ neutralId: 'neutral_1', targetId: 'p1', damage: 50 }]
      const result = applyNeutralActions(state, actions)

      expect(result.players['p1']!.hp).toBe(450)
    })
  })
})
