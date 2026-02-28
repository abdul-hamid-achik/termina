import { describe, it, expect } from 'vitest'
import { runTowerAI, applyTowerActions, type TowerAction } from '../../../server/game/engine/TowerAI'
import type { GameState, PlayerState, CreepState } from '../../../shared/types/game'
import { initializeZoneStates, initializeTowers } from '../../../server/game/map/zones'
import { TOWER_ATTACK } from '../../../shared/constants/balance'

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
    ...overrides,
  }
}

function makeCreep(overrides: Partial<CreepState> = {}): CreepState {
  return {
    id: 'c1',
    team: 'radiant',
    zone: 'mid-t1-rad',
    hp: 400,
    type: 'melee',
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

describe('TowerAI', () => {
  describe('runTowerAI', () => {
    it('should not generate actions for dead towers', () => {
      const towers = initializeTowers().map((t) => ({ ...t, hp: 0, alive: false }))
      const state = makeGameState({
        towers,
        players: {
          p1: makePlayer({ id: 'p1', team: 'dire', zone: 'mid-t1-rad' }),
        },
      })

      const actions = runTowerAI(state)
      expect(actions).toHaveLength(0)
    })

    it('should not generate actions when no enemies in tower zone', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'radiant', zone: 'mid-t1-rad' }),
        },
      })

      const actions = runTowerAI(state)
      // Radiant player in radiant tower zone — not an enemy
      expect(actions).toHaveLength(0)
    })

    it('should target enemy heroes in tower zone', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'dire', zone: 'mid-t1-rad' }),
        },
      })

      const actions = runTowerAI(state)
      const midT1Action = actions.find((a) => a.towerZone === 'mid-t1-rad')
      expect(midT1Action).toBeDefined()
      expect(midT1Action!.targetType).toBe('hero')
      expect(midT1Action!.targetId).toBe('p1')
      expect(midT1Action!.damage).toBe(TOWER_ATTACK)
    })

    it('should target enemy creeps in tower zone', () => {
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'dire', zone: 'mid-t1-rad' }),
        ],
      })

      const actions = runTowerAI(state)
      const midT1Action = actions.find((a) => a.towerZone === 'mid-t1-rad')
      expect(midT1Action).toBeDefined()
      expect(midT1Action!.targetType).toBe('creep')
      expect(midT1Action!.targetId).toBe('c1')
    })

    it('should prioritize heroes over creeps (when no hero attacker context)', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'dire', zone: 'mid-t1-rad' }),
        },
        creeps: [
          makeCreep({ id: 'c1', team: 'dire', zone: 'mid-t1-rad' }),
        ],
      })

      const actions = runTowerAI(state)
      const midT1Action = actions.find((a) => a.towerZone === 'mid-t1-rad')
      expect(midT1Action!.targetType).toBe('hero')
      expect(midT1Action!.targetId).toBe('p1')
    })

    it('should prioritize hero attacking allied hero in tower zone (priority 1)', () => {
      const state = makeGameState({
        players: {
          ally: makePlayer({ id: 'ally', team: 'radiant', zone: 'mid-t1-rad' }),
          attacker: makePlayer({ id: 'attacker', team: 'dire', zone: 'mid-t1-rad', name: 'Attacker' }),
          bystander: makePlayer({ id: 'bystander', team: 'dire', zone: 'mid-t1-rad', name: 'Bystander' }),
        },
      })

      // attacker is attacking ally
      const heroAttackers = new Map<string, string>()
      heroAttackers.set('attacker', 'ally')

      const actions = runTowerAI(state, heroAttackers)
      const midT1Action = actions.find((a) => a.towerZone === 'mid-t1-rad')
      expect(midT1Action!.targetType).toBe('hero')
      expect(midT1Action!.targetId).toBe('attacker')
    })

    it('should not target dead enemy heroes', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'dire', zone: 'mid-t1-rad', alive: false, hp: 0 }),
        },
      })

      const actions = runTowerAI(state)
      const midT1Action = actions.find((a) => a.towerZone === 'mid-t1-rad')
      expect(midT1Action).toBeUndefined()
    })

    it('should not target dead creeps', () => {
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'dire', zone: 'mid-t1-rad', hp: 0 }),
        ],
      })

      const actions = runTowerAI(state)
      const midT1Action = actions.find((a) => a.towerZone === 'mid-t1-rad')
      expect(midT1Action).toBeUndefined()
    })

    it('should generate actions for multiple towers simultaneously', () => {
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'dire', zone: 'mid-t1-rad' }),
          makeCreep({ id: 'c2', team: 'dire', zone: 'top-t1-rad' }),
          makeCreep({ id: 'c3', team: 'radiant', zone: 'bot-t1-dire' }),
        ],
      })

      const actions = runTowerAI(state)
      // Mid T1 rad should target c1, Top T1 rad should target c2, Bot T1 dire should target c3
      expect(actions.find((a) => a.towerZone === 'mid-t1-rad')!.targetId).toBe('c1')
      expect(actions.find((a) => a.towerZone === 'top-t1-rad')!.targetId).toBe('c2')
      expect(actions.find((a) => a.towerZone === 'bot-t1-dire')!.targetId).toBe('c3')
    })

    it('should fall back to hero when hero attacker targets non-ally', () => {
      const state = makeGameState({
        players: {
          attacker: makePlayer({ id: 'attacker', team: 'dire', zone: 'mid-t1-rad', name: 'Attacker' }),
        },
      })

      // Attacker is attacking a non-present player (not in this zone)
      const heroAttackers = new Map<string, string>()
      heroAttackers.set('attacker', 'someone-else')

      const actions = runTowerAI(state, heroAttackers)
      const midT1Action = actions.find((a) => a.towerZone === 'mid-t1-rad')
      // Should still target the enemy hero (priority 2 fallback)
      expect(midT1Action!.targetType).toBe('hero')
      expect(midT1Action!.targetId).toBe('attacker')
    })
  })

  describe('applyTowerActions', () => {
    it('should apply damage to heroes', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'dire', zone: 'mid-t1-rad', hp: 500 }),
        },
      })

      const actions: TowerAction[] = [
        { towerZone: 'mid-t1-rad', targetType: 'hero', targetId: 'p1', damage: TOWER_ATTACK },
      ]

      const result = applyTowerActions(state, actions)
      expect(result.players['p1']!.hp).toBe(500 - TOWER_ATTACK)
      expect(result.players['p1']!.alive).toBe(true)
    })

    it('should kill heroes when HP drops to 0', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'dire', zone: 'mid-t1-rad', hp: 50 }),
        },
      })

      const actions: TowerAction[] = [
        { towerZone: 'mid-t1-rad', targetType: 'hero', targetId: 'p1', damage: TOWER_ATTACK },
      ]

      const result = applyTowerActions(state, actions)
      expect(result.players['p1']!.hp).toBe(0)
      expect(result.players['p1']!.alive).toBe(false)
    })

    it('should apply damage to creeps', () => {
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'dire', zone: 'mid-t1-rad', hp: 400 }),
        ],
      })

      const actions: TowerAction[] = [
        { towerZone: 'mid-t1-rad', targetType: 'creep', targetId: 'c1', damage: TOWER_ATTACK },
      ]

      const result = applyTowerActions(state, actions)
      const c1 = result.creeps.find((c) => c.id === 'c1')
      expect(c1!.hp).toBe(400 - TOWER_ATTACK)
    })

    it('should remove dead creeps after damage', () => {
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'dire', zone: 'mid-t1-rad', hp: 50 }),
        ],
      })

      const actions: TowerAction[] = [
        { towerZone: 'mid-t1-rad', targetType: 'creep', targetId: 'c1', damage: TOWER_ATTACK },
      ]

      const result = applyTowerActions(state, actions)
      expect(result.creeps.find((c) => c.id === 'c1')).toBeUndefined()
    })

    it('should clamp hero HP to 0 (not negative)', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'dire', zone: 'mid-t1-rad', hp: 1 }),
        },
      })

      const actions: TowerAction[] = [
        { towerZone: 'mid-t1-rad', targetType: 'hero', targetId: 'p1', damage: TOWER_ATTACK },
      ]

      const result = applyTowerActions(state, actions)
      expect(result.players['p1']!.hp).toBe(0)
    })

    it('should handle multiple tower actions', () => {
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'dire', zone: 'mid-t1-rad', hp: 400 }),
          makeCreep({ id: 'c2', team: 'radiant', zone: 'mid-t1-dire', hp: 400 }),
        ],
      })

      const actions: TowerAction[] = [
        { towerZone: 'mid-t1-rad', targetType: 'creep', targetId: 'c1', damage: TOWER_ATTACK },
        { towerZone: 'mid-t1-dire', targetType: 'creep', targetId: 'c2', damage: TOWER_ATTACK },
      ]

      const result = applyTowerActions(state, actions)
      const c1 = result.creeps.find((c) => c.id === 'c1')
      const c2 = result.creeps.find((c) => c.id === 'c2')
      expect(c1!.hp).toBe(400 - TOWER_ATTACK)
      expect(c2!.hp).toBe(400 - TOWER_ATTACK)
    })

    it('should not damage already dead heroes', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'dire', zone: 'mid-t1-rad', hp: 0, alive: false }),
        },
      })

      const actions: TowerAction[] = [
        { towerZone: 'mid-t1-rad', targetType: 'hero', targetId: 'p1', damage: TOWER_ATTACK },
      ]

      const result = applyTowerActions(state, actions)
      expect(result.players['p1']!.hp).toBe(0)
    })
  })
})
