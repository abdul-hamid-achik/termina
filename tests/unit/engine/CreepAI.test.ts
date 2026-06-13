import { describe, it, expect } from 'vitest'
import {
  runCreepAI,
  applyCreepActions,
  enforceCreepZoneCap,
  type CreepAction,
} from '../../../server/game/engine/CreepAI'
import { initializeAncients } from '../../../server/game/engine/AncientSystem'
import type { GameState, PlayerState, CreepState } from '../../../shared/types/game'
import { initializeZoneStates, initializeTowers } from '../../../server/game/map/zones'
import {
  MELEE_CREEP_ATTACK,
  RANGED_CREEP_ATTACK,
  SIEGE_CREEP_ATTACK,
  CREEP_BASE_IDLE_DESPAWN_TICKS,
  MAX_CREEPS_PER_ZONE_PER_TEAM,
} from '../../../shared/constants/balance'
import { calculatePhysicalDamage } from '../../../server/game/engine/DamageCalculator'

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
    ancients: initializeAncients(),
    events: [],
    ...overrides,
  }
}

/** Ancients with the dire one vulnerable (a dire T3 is presumed down). */
function vulnerableDireAncients() {
  const ancients = initializeAncients()
  return { radiant: ancients.radiant, dire: { ...ancients.dire, vulnerable: true } }
}

describe('CreepAI', () => {
  describe('runCreepAI', () => {
    it('should move creeps forward along lane when no enemies present', () => {
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'radiant', zone: 'mid-t3-rad' }),
        ],
      })

      const actions = runCreepAI(state)
      expect(actions).toHaveLength(1)
      expect(actions[0]!.creepId).toBe('c1')
      expect(actions[0]!.action).toBe('move')
      expect(actions[0]!.targetZone).toBe('mid-t2-rad')
    })

    it('should move dire creeps forward along their lane', () => {
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'dire', zone: 'mid-t3-dire' }),
        ],
      })

      const actions = runCreepAI(state)
      expect(actions).toHaveLength(1)
      expect(actions[0]!.action).toBe('move')
      expect(actions[0]!.targetZone).toBe('mid-t2-dire')
    })

    it('should attack enemy creeps in the same zone (priority 1)', () => {
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'radiant', zone: 'mid-river' }),
          makeCreep({ id: 'c2', team: 'dire', zone: 'mid-river' }),
        ],
      })

      const actions = runCreepAI(state)
      // Both creeps should attack each other
      const c1Action = actions.find((a) => a.creepId === 'c1')
      const c2Action = actions.find((a) => a.creepId === 'c2')

      expect(c1Action!.action).toBe('attack_creep')
      expect(c1Action!.targetId).toBe('c2')
      expect(c2Action!.action).toBe('attack_creep')
      expect(c2Action!.targetId).toBe('c1')
    })

    it('should use correct damage for melee creeps', () => {
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'radiant', zone: 'mid-river', type: 'melee' }),
          makeCreep({ id: 'c2', team: 'dire', zone: 'mid-river' }),
        ],
      })

      const actions = runCreepAI(state)
      const c1Action = actions.find((a) => a.creepId === 'c1')
      expect(c1Action!.damage).toBe(MELEE_CREEP_ATTACK)
    })

    it('should use correct damage for ranged creeps', () => {
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'radiant', zone: 'mid-river', type: 'ranged' }),
          makeCreep({ id: 'c2', team: 'dire', zone: 'mid-river' }),
        ],
      })

      const actions = runCreepAI(state)
      const c1Action = actions.find((a) => a.creepId === 'c1')
      expect(c1Action!.damage).toBe(RANGED_CREEP_ATTACK)
    })

    it('should use correct damage for siege creeps', () => {
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'radiant', zone: 'mid-river', type: 'siege' }),
          makeCreep({ id: 'c2', team: 'dire', zone: 'mid-river' }),
        ],
      })

      const actions = runCreepAI(state)
      const c1Action = actions.find((a) => a.creepId === 'c1')
      expect(c1Action!.damage).toBe(SIEGE_CREEP_ATTACK)
    })

    it('should attack enemy heroes when no enemy creeps in zone (priority 2)', () => {
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'radiant', zone: 'mid-river' }),
        ],
        players: {
          p1: makePlayer({ id: 'p1', team: 'dire', zone: 'mid-river' }),
        },
      })

      const actions = runCreepAI(state)
      expect(actions).toHaveLength(1)
      expect(actions[0]!.action).toBe('attack_hero')
      expect(actions[0]!.targetId).toBe('p1')
    })

    it('should not attack dead heroes', () => {
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'radiant', zone: 'mid-river' }),
        ],
        players: {
          p1: makePlayer({ id: 'p1', team: 'dire', zone: 'mid-river', alive: false, hp: 0 }),
        },
      })

      const actions = runCreepAI(state)
      // No enemy heroes alive, so should move
      expect(actions[0]!.action).not.toBe('attack_hero')
    })

    it('should attack enemy tower in zone when no enemy creeps or heroes (priority 3)', () => {
      // Place a radiant creep in a dire tower zone
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'radiant', zone: 'mid-t1-dire' }),
        ],
      })

      const actions = runCreepAI(state)
      expect(actions).toHaveLength(1)
      expect(actions[0]!.action).toBe('attack_tower')
      expect(actions[0]!.targetZone).toBe('mid-t1-dire')
    })

    it('should prefer enemy creeps over enemy heroes', () => {
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'radiant', zone: 'mid-river' }),
          makeCreep({ id: 'c2', team: 'dire', zone: 'mid-river' }),
        ],
        players: {
          p1: makePlayer({ id: 'p1', team: 'dire', zone: 'mid-river' }),
        },
      })

      const actions = runCreepAI(state)
      const c1Action = actions.find((a) => a.creepId === 'c1')
      expect(c1Action!.action).toBe('attack_creep')
      expect(c1Action!.targetId).toBe('c2')
    })

    it('should prefer enemy creeps over enemy towers', () => {
      // Radiant creep in dire tower zone with enemy creep
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'radiant', zone: 'mid-t1-dire' }),
          makeCreep({ id: 'c2', team: 'dire', zone: 'mid-t1-dire' }),
        ],
      })

      const actions = runCreepAI(state)
      const c1Action = actions.find((a) => a.creepId === 'c1')
      expect(c1Action!.action).toBe('attack_creep')
    })

    it('should skip dead creeps', () => {
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'radiant', zone: 'mid-river', hp: 0 }),
        ],
      })

      const actions = runCreepAI(state)
      expect(actions).toHaveLength(0)
    })

    it('should idle (wait_in_base) for creeps stuck in base zones', () => {
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'radiant', zone: 'radiant-base' }),
        ],
      })

      const actions = runCreepAI(state)
      // Creep is at the end of route in a base — it idles toward despawn
      expect(actions).toHaveLength(1)
      expect(actions[0]!.action).toBe('wait_in_base')
    })

    it('should handle creeps on all three lanes', () => {
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'radiant', zone: 'top-t3-rad' }),
          makeCreep({ id: 'c2', team: 'radiant', zone: 'mid-t3-rad' }),
          makeCreep({ id: 'c3', team: 'radiant', zone: 'bot-t3-rad' }),
        ],
      })

      const actions = runCreepAI(state)
      expect(actions).toHaveLength(3)
      expect(actions[0]!.targetZone).toBe('top-t2-rad')
      expect(actions[1]!.targetZone).toBe('mid-t2-rad')
      expect(actions[2]!.targetZone).toBe('bot-t2-rad')
    })

    it('should not attack dead enemy creeps', () => {
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'radiant', zone: 'mid-river' }),
          makeCreep({ id: 'c2', team: 'dire', zone: 'mid-river', hp: 0 }),
        ],
      })

      const actions = runCreepAI(state)
      const c1Action = actions.find((a) => a.creepId === 'c1')
      // Dead enemy creep shouldn't be targeted; creep should move
      expect(c1Action!.action).toBe('move')
    })

    it('should not attack dead towers', () => {
      const towers = initializeTowers().map((t) =>
        t.zone === 'mid-t1-dire' ? { ...t, hp: 0, alive: false } : t,
      )

      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'radiant', zone: 'mid-t1-dire' }),
        ],
        towers,
      })

      const actions = runCreepAI(state)
      const c1Action = actions.find((a) => a.creepId === 'c1')
      // Tower is dead, creep should move forward
      expect(c1Action!.action).toBe('move')
    })
  })

  describe('applyCreepActions', () => {
    it('should move creeps to target zones', () => {
      const state = makeGameState({
        creeps: [makeCreep({ id: 'c1', zone: 'mid-t3-rad' })],
      })

      const actions: CreepAction[] = [
        { creepId: 'c1', action: 'move', targetZone: 'mid-t2-rad' },
      ]

      const result = applyCreepActions(state, actions).state
      expect(result.creeps[0]!.zone).toBe('mid-t2-rad')
    })

    it('should apply damage to enemy creeps', () => {
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'radiant', zone: 'mid-river', hp: 400 }),
          makeCreep({ id: 'c2', team: 'dire', zone: 'mid-river', hp: 400 }),
        ],
      })

      const actions: CreepAction[] = [
        { creepId: 'c1', action: 'attack_creep', targetId: 'c2', damage: MELEE_CREEP_ATTACK },
      ]

      const result = applyCreepActions(state, actions).state
      const c2 = result.creeps.find((c) => c.id === 'c2')
      expect(c2!.hp).toBe(400 - MELEE_CREEP_ATTACK)
    })

    it('should remove dead creeps after applying actions', () => {
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'radiant', zone: 'mid-river', hp: 400 }),
          makeCreep({ id: 'c2', team: 'dire', zone: 'mid-river', hp: 10 }),
        ],
      })

      const actions: CreepAction[] = [
        { creepId: 'c1', action: 'attack_creep', targetId: 'c2', damage: MELEE_CREEP_ATTACK },
      ]

      const result = applyCreepActions(state, actions).state
      expect(result.creeps.find((c) => c.id === 'c2')).toBeUndefined()
    })

    it('should apply damage to heroes with defense reduction', () => {
      const state = makeGameState({
        creeps: [makeCreep({ id: 'c1', team: 'radiant', zone: 'mid-river' })],
        players: {
          p1: makePlayer({ id: 'p1', team: 'dire', zone: 'mid-river', hp: 500, defense: 3 }),
        },
      })

      const actions: CreepAction[] = [
        { creepId: 'c1', action: 'attack_hero', targetId: 'p1', damage: MELEE_CREEP_ATTACK },
      ]

      const result = applyCreepActions(state, actions).state
      const expectedDamage = calculatePhysicalDamage(MELEE_CREEP_ATTACK, 3)
      expect(result.players['p1']!.hp).toBe(500 - expectedDamage)
      expect(result.players['p1']!.alive).toBe(true)
    })

    it('should kill heroes when HP reaches 0', () => {
      const state = makeGameState({
        creeps: [makeCreep({ id: 'c1', team: 'radiant', zone: 'mid-river' })],
        players: {
          p1: makePlayer({ id: 'p1', team: 'dire', zone: 'mid-river', hp: 1, defense: 0 }),
        },
      })

      const actions: CreepAction[] = [
        { creepId: 'c1', action: 'attack_hero', targetId: 'p1', damage: MELEE_CREEP_ATTACK },
      ]

      const result = applyCreepActions(state, actions).state
      expect(result.players['p1']!.hp).toBe(0)
      expect(result.players['p1']!.alive).toBe(false)
    })

    it('should apply damage to towers', () => {
      const state = makeGameState({
        creeps: [makeCreep({ id: 'c1', team: 'radiant', zone: 'mid-t1-dire' })],
      })

      const tower = state.towers.find((t) => t.zone === 'mid-t1-dire')!
      const initialHp = tower.hp

      const actions: CreepAction[] = [
        { creepId: 'c1', action: 'attack_tower', targetZone: 'mid-t1-dire', damage: MELEE_CREEP_ATTACK },
      ]

      const result = applyCreepActions(state, actions).state
      const updatedTower = result.towers.find((t) => t.zone === 'mid-t1-dire')!
      expect(updatedTower.hp).toBe(initialHp - MELEE_CREEP_ATTACK)
    })

    it('should destroy towers when HP reaches 0', () => {
      const towers = initializeTowers().map((t) =>
        t.zone === 'mid-t1-dire' ? { ...t, hp: 10 } : t,
      )

      const state = makeGameState({
        creeps: [makeCreep({ id: 'c1', team: 'radiant', zone: 'mid-t1-dire' })],
        towers,
      })

      const actions: CreepAction[] = [
        { creepId: 'c1', action: 'attack_tower', targetZone: 'mid-t1-dire', damage: MELEE_CREEP_ATTACK },
      ]

      const result = applyCreepActions(state, actions).state
      const updatedTower = result.towers.find((t) => t.zone === 'mid-t1-dire')!
      expect(updatedTower.hp).toBe(0)
      expect(updatedTower.alive).toBe(false)
    })

    it('should not apply actions from dead creeps', () => {
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'radiant', zone: 'mid-river', hp: 0 }),
          makeCreep({ id: 'c2', team: 'dire', zone: 'mid-river', hp: 400 }),
        ],
      })

      const actions: CreepAction[] = [
        { creepId: 'c1', action: 'attack_creep', targetId: 'c2', damage: MELEE_CREEP_ATTACK },
      ]

      const result = applyCreepActions(state, actions).state
      // c1 is dead, so c2 should not take damage (c1 also removed)
      const c2 = result.creeps.find((c) => c.id === 'c2')
      expect(c2!.hp).toBe(400)
    })

    it('should clamp creep HP to 0 (not negative)', () => {
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'radiant', zone: 'mid-river', hp: 400 }),
          makeCreep({ id: 'c2', team: 'dire', zone: 'mid-river', hp: 5 }),
        ],
      })

      const actions: CreepAction[] = [
        { creepId: 'c1', action: 'attack_creep', targetId: 'c2', damage: SIEGE_CREEP_ATTACK },
      ]

      const result = applyCreepActions(state, actions).state
      // c2 should be removed (hp <= 0)
      expect(result.creeps.find((c) => c.id === 'c2')).toBeUndefined()
    })
  })

  describe('Ancient siege behavior', () => {
    it('attacks a vulnerable enemy Ancient from the enemy base', () => {
      const state = makeGameState({
        ancients: vulnerableDireAncients(),
        creeps: [makeCreep({ id: 'c1', team: 'radiant', zone: 'dire-base' })],
      })

      const actions = runCreepAI(state)
      expect(actions).toHaveLength(1)
      expect(actions[0]!.action).toBe('attack_ancient')
      expect(actions[0]!.damage).toBe(MELEE_CREEP_ATTACK)
    })

    it('prefers the vulnerable Ancient over enemy heroes in base', () => {
      const state = makeGameState({
        ancients: vulnerableDireAncients(),
        creeps: [makeCreep({ id: 'c1', team: 'radiant', zone: 'dire-base' })],
        players: {
          p1: makePlayer({ id: 'p1', team: 'dire', zone: 'dire-base' }),
        },
      })

      const actions = runCreepAI(state)
      expect(actions[0]!.action).toBe('attack_ancient')
    })

    it('still fights enemy creeps before the Ancient', () => {
      const state = makeGameState({
        ancients: vulnerableDireAncients(),
        creeps: [
          makeCreep({ id: 'c1', team: 'radiant', zone: 'dire-base' }),
          makeCreep({ id: 'c2', team: 'dire', zone: 'dire-base' }),
        ],
      })

      const actions = runCreepAI(state)
      const c1Action = actions.find((a) => a.creepId === 'c1')
      expect(c1Action!.action).toBe('attack_creep')
    })

    it('does not attack an invulnerable Ancient — attacks heroes instead', () => {
      const state = makeGameState({
        creeps: [makeCreep({ id: 'c1', team: 'radiant', zone: 'dire-base' })],
        players: {
          p1: makePlayer({ id: 'p1', team: 'dire', zone: 'dire-base' }),
        },
      })

      const actions = runCreepAI(state)
      expect(actions[0]!.action).toBe('attack_hero')
      expect(actions[0]!.targetId).toBe('p1')
    })

    it('does not attack a dead Ancient', () => {
      const ancients = initializeAncients()
      const state = makeGameState({
        ancients: {
          radiant: ancients.radiant,
          dire: { ...ancients.dire, hp: 0, alive: false, vulnerable: true },
        },
        creeps: [makeCreep({ id: 'c1', team: 'radiant', zone: 'dire-base' })],
      })

      const actions = runCreepAI(state)
      expect(actions[0]!.action).not.toBe('attack_ancient')
    })

    it('applies Ancient damage and emits events via applyCreepActions', () => {
      const state = makeGameState({
        ancients: vulnerableDireAncients(),
        creeps: [makeCreep({ id: 'c1', team: 'radiant', zone: 'dire-base' })],
      })

      const actions: CreepAction[] = [
        { creepId: 'c1', action: 'attack_ancient', damage: MELEE_CREEP_ATTACK },
      ]

      const result = applyCreepActions(state, actions)
      expect(result.state.ancients.dire.hp).toBe(
        result.state.ancients.dire.maxHp - MELEE_CREEP_ATTACK,
      )
      expect(result.events).toHaveLength(1)
      expect(result.events[0]!._tag).toBe('damage')
    })

    it('destroys the Ancient and emits a structure-kill event', () => {
      const ancients = initializeAncients()
      const state = makeGameState({
        ancients: {
          radiant: ancients.radiant,
          dire: { ...ancients.dire, hp: 5, vulnerable: true },
        },
        creeps: [makeCreep({ id: 'c1', team: 'radiant', zone: 'dire-base' })],
      })

      const actions: CreepAction[] = [
        { creepId: 'c1', action: 'attack_ancient', damage: MELEE_CREEP_ATTACK },
      ]

      const result = applyCreepActions(state, actions)
      expect(result.state.ancients.dire.alive).toBe(false)
      expect(result.state.ancients.dire.hp).toBe(0)
      const killEvent = result.events.find((e) => e._tag === 'tower_kill')
      expect(killEvent).toBeDefined()
    })

    it('does not damage an invulnerable Ancient even if an action sneaks through', () => {
      const state = makeGameState({
        creeps: [makeCreep({ id: 'c1', team: 'radiant', zone: 'dire-base' })],
      })

      const actions: CreepAction[] = [
        { creepId: 'c1', action: 'attack_ancient', damage: MELEE_CREEP_ATTACK },
      ]

      const result = applyCreepActions(state, actions)
      expect(result.state.ancients.dire.hp).toBe(result.state.ancients.dire.maxHp)
      expect(result.events).toHaveLength(0)
    })
  })

  describe('base idle despawn (garbage collection)', () => {
    it('waits in base while under the idle threshold', () => {
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'radiant', zone: 'dire-base', baseIdleTicks: 0 }),
        ],
      })

      const actions = runCreepAI(state)
      expect(actions[0]!.action).toBe('wait_in_base')
    })

    it('despawns once idle ticks reach the threshold', () => {
      const state = makeGameState({
        creeps: [
          makeCreep({
            id: 'c1',
            team: 'radiant',
            zone: 'dire-base',
            baseIdleTicks: CREEP_BASE_IDLE_DESPAWN_TICKS - 1,
          }),
        ],
      })

      const actions = runCreepAI(state)
      expect(actions[0]!.action).toBe('despawn')
    })

    it('wait_in_base increments the idle counter', () => {
      const state = makeGameState({
        creeps: [makeCreep({ id: 'c1', team: 'radiant', zone: 'dire-base' })],
      })

      const result = applyCreepActions(state, [{ creepId: 'c1', action: 'wait_in_base' }])
      expect(result.state.creeps[0]!.baseIdleTicks).toBe(1)
    })

    it('despawn removes the creep from state', () => {
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'radiant', zone: 'dire-base' }),
          makeCreep({ id: 'c2', team: 'radiant', zone: 'mid-river' }),
        ],
      })

      const result = applyCreepActions(state, [{ creepId: 'c1', action: 'despawn' }])
      expect(result.state.creeps.find((c) => c.id === 'c1')).toBeUndefined()
      expect(result.state.creeps.find((c) => c.id === 'c2')).toBeDefined()
    })

    it('does not idle-despawn while the vulnerable Ancient is attackable', () => {
      const state = makeGameState({
        ancients: vulnerableDireAncients(),
        creeps: [
          makeCreep({
            id: 'c1',
            team: 'radiant',
            zone: 'dire-base',
            baseIdleTicks: CREEP_BASE_IDLE_DESPAWN_TICKS,
          }),
        ],
      })

      const actions = runCreepAI(state)
      expect(actions[0]!.action).toBe('attack_ancient')
    })
  })

  describe('enforceCreepZoneCap', () => {
    it('returns the same state object when under the cap', () => {
      const state = makeGameState({
        creeps: [makeCreep({ id: 'c1', team: 'radiant', zone: 'mid-river' })],
      })
      expect(enforceCreepZoneCap(state)).toBe(state)
    })

    it('despawns the oldest creeps first when over the cap', () => {
      const creeps = Array.from({ length: MAX_CREEPS_PER_ZONE_PER_TEAM + 5 }, (_, i) =>
        makeCreep({ id: `c${i}`, team: 'radiant', zone: 'mid-river' }),
      )
      const state = makeGameState({ creeps })

      const result = enforceCreepZoneCap(state)
      expect(result.creeps).toHaveLength(MAX_CREEPS_PER_ZONE_PER_TEAM)
      // Oldest (lowest index) should be gone, newest kept
      expect(result.creeps.find((c) => c.id === 'c0')).toBeUndefined()
      expect(result.creeps.find((c) => c.id === 'c4')).toBeUndefined()
      expect(result.creeps.find((c) => c.id === 'c5')).toBeDefined()
      expect(
        result.creeps.find((c) => c.id === `c${MAX_CREEPS_PER_ZONE_PER_TEAM + 4}`),
      ).toBeDefined()
    })

    it('caps per team per zone independently', () => {
      const radiant = Array.from({ length: MAX_CREEPS_PER_ZONE_PER_TEAM + 2 }, (_, i) =>
        makeCreep({ id: `r${i}`, team: 'radiant', zone: 'mid-river' }),
      )
      const dire = Array.from({ length: 3 }, (_, i) =>
        makeCreep({ id: `d${i}`, team: 'dire', zone: 'top-river' }),
      )
      const state = makeGameState({ creeps: [...radiant, ...dire] })

      const result = enforceCreepZoneCap(state)
      expect(result.creeps.filter((c) => c.team === 'radiant')).toHaveLength(
        MAX_CREEPS_PER_ZONE_PER_TEAM,
      )
      expect(result.creeps.filter((c) => c.team === 'dire')).toHaveLength(3)
    })

    it('preserves spawn order of the survivors', () => {
      const creeps = Array.from({ length: MAX_CREEPS_PER_ZONE_PER_TEAM + 1 }, (_, i) =>
        makeCreep({ id: `c${i}`, team: 'radiant', zone: 'mid-river' }),
      )
      const state = makeGameState({ creeps })

      const result = enforceCreepZoneCap(state)
      const ids = result.creeps.map((c) => Number(c.id.slice(1)))
      const sorted = [...ids].sort((a, b) => a - b)
      expect(ids).toEqual(sorted)
    })
  })
})
