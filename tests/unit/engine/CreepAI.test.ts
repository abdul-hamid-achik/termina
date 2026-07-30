import { describe, it, expect } from 'vitest'
import {
  runCreepAI,
  applyCreepActions,
  enforceCreepZoneCap,
  type CreepAction,
} from '~~/server/game/engine/CreepAI'
import { initializeAncients } from '~~/server/game/engine/AncientSystem'
import type { GameState, PlayerState, CreepState } from '~~/shared/types/game'
import { initializeZoneStates, initializeIce } from '~~/server/game/map/zones'
import {
  MELEE_CREEP_ATTACK,
  RANGED_CREEP_ATTACK,
  SIEGE_CREEP_ATTACK,
  CREEP_BASE_IDLE_DESPAWN_TICKS,
  CREEP_ESCALATION_INTERVAL_TICKS,
  CREEP_XP_SHARED,
  MAX_CREEPS_PER_ZONE_PER_TEAM,
  creepAttack,
} from '~~/shared/constants/balance'
import { calculatePhysicalDamage } from '~~/server/game/engine/DamageCalculator'
import { getEffectiveDefense } from '~~/server/game/engine/EffectiveStats'

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'Player1',
    team: 'chaff',
    heroId: 'echo',
    zone: 'mid-t1-chaff',
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
    iceDamageDealt: 0,
    killStreak: 0,
    ...overrides,
  }
}

function makeCreep(overrides: Partial<CreepState> = {}): CreepState {
  return {
    id: 'c1',
    team: 'chaff',
    zone: 'mid-t1-chaff',
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
      chaff: { id: 'chaff', kills: 0, iceKills: 0, gold: 0 },
      audit: { id: 'audit', kills: 0, iceKills: 0, gold: 0 },
    },
    players: {},
    zones: initializeZoneStates(),
    creeps: [],
    ice: initializeIce(),
    ancients: initializeAncients(),
    events: [],
    ...overrides,
  }
}

/** Ancients with the audit one vulnerable (a audit T3 is presumed down). */
function vulnerableAuditAncients() {
  const ancients = initializeAncients()
  return { chaff: ancients.chaff, audit: { ...ancients.audit, vulnerable: true } }
}

describe('CreepAI', () => {
  describe('runCreepAI', () => {
    it('should move creeps forward along lane when no enemies present', () => {
      const state = makeGameState({
        creeps: [makeCreep({ id: 'c1', team: 'chaff', zone: 'mid-t3-chaff' })],
      })

      const actions = runCreepAI(state)
      expect(actions).toHaveLength(1)
      expect(actions[0]!.creepId).toBe('c1')
      expect(actions[0]!.action).toBe('move')
      expect(actions[0]!.targetZone).toBe('mid-t2-chaff')
    })

    it('should move audit creeps forward along their lane', () => {
      const state = makeGameState({
        creeps: [makeCreep({ id: 'c1', team: 'audit', zone: 'mid-t3-audit' })],
      })

      const actions = runCreepAI(state)
      expect(actions).toHaveLength(1)
      expect(actions[0]!.action).toBe('move')
      expect(actions[0]!.targetZone).toBe('mid-t2-audit')
    })

    it('should attack enemy creeps in the same zone (priority 1)', () => {
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'chaff', zone: 'mid-river' }),
          makeCreep({ id: 'c2', team: 'audit', zone: 'mid-river' }),
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
          makeCreep({ id: 'c1', team: 'chaff', zone: 'mid-river', type: 'melee' }),
          makeCreep({ id: 'c2', team: 'audit', zone: 'mid-river' }),
        ],
      })

      const actions = runCreepAI(state)
      const c1Action = actions.find((a) => a.creepId === 'c1')
      expect(c1Action!.damage).toBe(MELEE_CREEP_ATTACK)
    })

    it('should use correct damage for ranged creeps', () => {
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'chaff', zone: 'mid-river', type: 'ranged' }),
          makeCreep({ id: 'c2', team: 'audit', zone: 'mid-river' }),
        ],
      })

      const actions = runCreepAI(state)
      const c1Action = actions.find((a) => a.creepId === 'c1')
      expect(c1Action!.damage).toBe(RANGED_CREEP_ATTACK)
    })

    it('should use correct damage for siege creeps', () => {
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'chaff', zone: 'mid-river', type: 'siege' }),
          makeCreep({ id: 'c2', team: 'audit', zone: 'mid-river' }),
        ],
      })

      const actions = runCreepAI(state)
      const c1Action = actions.find((a) => a.creepId === 'c1')
      expect(c1Action!.damage).toBe(SIEGE_CREEP_ATTACK)
    })

    it('escalates creep damage with the game tick', () => {
      const lateTick = CREEP_ESCALATION_INTERVAL_TICKS * 2
      const state = makeGameState({
        tick: lateTick,
        creeps: [
          makeCreep({ id: 'c1', team: 'chaff', zone: 'mid-river', type: 'melee' }),
          makeCreep({ id: 'c2', team: 'audit', zone: 'mid-river' }),
        ],
      })

      const damage = runCreepAI(state).find((a) => a.creepId === 'c1')!.damage
      expect(damage).toBe(creepAttack('melee', lateTick))
      expect(damage).toBeGreaterThan(MELEE_CREEP_ATTACK)
    })

    it('should attack enemy heroes when no enemy creeps in zone (priority 2)', () => {
      const state = makeGameState({
        creeps: [makeCreep({ id: 'c1', team: 'chaff', zone: 'mid-river' })],
        players: {
          p1: makePlayer({ id: 'p1', team: 'audit', zone: 'mid-river' }),
        },
      })

      const actions = runCreepAI(state)
      expect(actions).toHaveLength(1)
      expect(actions[0]!.action).toBe('attack_hero')
      expect(actions[0]!.targetId).toBe('p1')
    })

    it('should not attack dead heroes', () => {
      const state = makeGameState({
        creeps: [makeCreep({ id: 'c1', team: 'chaff', zone: 'mid-river' })],
        players: {
          p1: makePlayer({ id: 'p1', team: 'audit', zone: 'mid-river', alive: false, hp: 0 }),
        },
      })

      const actions = runCreepAI(state)
      // No enemy heroes alive, so should move
      expect(actions[0]!.action).not.toBe('attack_hero')
    })

    it('should attack enemy ice in zone when no enemy creeps or heroes (priority 3)', () => {
      // Place a chaff creep in a audit ice zone
      const state = makeGameState({
        creeps: [makeCreep({ id: 'c1', team: 'chaff', zone: 'mid-t1-audit' })],
      })

      const actions = runCreepAI(state)
      expect(actions).toHaveLength(1)
      expect(actions[0]!.action).toBe('attack_ice')
      expect(actions[0]!.targetZone).toBe('mid-t1-audit')
    })

    it('should prefer enemy creeps over enemy heroes', () => {
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'chaff', zone: 'mid-river' }),
          makeCreep({ id: 'c2', team: 'audit', zone: 'mid-river' }),
        ],
        players: {
          p1: makePlayer({ id: 'p1', team: 'audit', zone: 'mid-river' }),
        },
      })

      const actions = runCreepAI(state)
      const c1Action = actions.find((a) => a.creepId === 'c1')
      expect(c1Action!.action).toBe('attack_creep')
      expect(c1Action!.targetId).toBe('c2')
    })

    it('should prefer enemy creeps over enemy ice', () => {
      // Chaff creep in audit ice zone with enemy creep
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'chaff', zone: 'mid-t1-audit' }),
          makeCreep({ id: 'c2', team: 'audit', zone: 'mid-t1-audit' }),
        ],
      })

      const actions = runCreepAI(state)
      const c1Action = actions.find((a) => a.creepId === 'c1')
      expect(c1Action!.action).toBe('attack_creep')
    })

    it('should skip dead creeps', () => {
      const state = makeGameState({
        creeps: [makeCreep({ id: 'c1', team: 'chaff', zone: 'mid-river', hp: 0 })],
      })

      const actions = runCreepAI(state)
      expect(actions).toHaveLength(0)
    })

    it('should idle (wait_in_base) for creeps stuck in base zones', () => {
      const state = makeGameState({
        creeps: [makeCreep({ id: 'c1', team: 'chaff', zone: 'chaff-base' })],
      })

      const actions = runCreepAI(state)
      // Creep is at the end of route in a base — it idles toward despawn
      expect(actions).toHaveLength(1)
      expect(actions[0]!.action).toBe('wait_in_base')
    })

    it('should handle creeps on all three lanes', () => {
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'chaff', zone: 'top-t3-chaff' }),
          makeCreep({ id: 'c2', team: 'chaff', zone: 'mid-t3-chaff' }),
          makeCreep({ id: 'c3', team: 'chaff', zone: 'bot-t3-chaff' }),
        ],
      })

      const actions = runCreepAI(state)
      expect(actions).toHaveLength(3)
      expect(actions[0]!.targetZone).toBe('top-t2-chaff')
      expect(actions[1]!.targetZone).toBe('mid-t2-chaff')
      expect(actions[2]!.targetZone).toBe('bot-t2-chaff')
    })

    it('should not attack dead enemy creeps', () => {
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'chaff', zone: 'mid-river' }),
          makeCreep({ id: 'c2', team: 'audit', zone: 'mid-river', hp: 0 }),
        ],
      })

      const actions = runCreepAI(state)
      const c1Action = actions.find((a) => a.creepId === 'c1')
      // Dead enemy creep shouldn't be targeted; creep should move
      expect(c1Action!.action).toBe('move')
    })

    it('should not attack dead ice', () => {
      const ice = initializeIce().map((t) =>
        t.zone === 'mid-t1-audit' ? { ...t, hp: 0, alive: false } : t,
      )

      const state = makeGameState({
        creeps: [makeCreep({ id: 'c1', team: 'chaff', zone: 'mid-t1-audit' })],
        ice,
      })

      const actions = runCreepAI(state)
      const c1Action = actions.find((a) => a.creepId === 'c1')
      // Ice is dead, creep should move forward
      expect(c1Action!.action).toBe('move')
    })
  })

  describe('applyCreepActions', () => {
    it('should move creeps to target zones', () => {
      const state = makeGameState({
        creeps: [makeCreep({ id: 'c1', zone: 'mid-t3-chaff' })],
      })

      const actions: CreepAction[] = [{ creepId: 'c1', action: 'move', targetZone: 'mid-t2-chaff' }]

      const result = applyCreepActions(state, actions).state
      expect(result.creeps[0]!.zone).toBe('mid-t2-chaff')
    })

    it('should apply damage to enemy creeps', () => {
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'chaff', zone: 'mid-river', hp: 400 }),
          makeCreep({ id: 'c2', team: 'audit', zone: 'mid-river', hp: 400 }),
        ],
      })

      const actions: CreepAction[] = [
        { creepId: 'c1', action: 'attack_creep', targetId: 'c2', damage: MELEE_CREEP_ATTACK },
      ]

      const result = applyCreepActions(state, actions).state
      const c2 = result.creeps.find((c) => c.id === 'c2')
      expect(c2!.hp).toBe(400 - MELEE_CREEP_ATTACK)
    })

    it('shares XP with living lane-mates of the killing team when a creep dies', () => {
      const laner = makePlayer({ id: 'p1', team: 'chaff', zone: 'mid-river', xp: 0 })
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'chaff', zone: 'mid-river', hp: 400 }),
          makeCreep({ id: 'c2', team: 'audit', zone: 'mid-river', hp: 10 }),
        ],
        players: { p1: laner },
      })

      const actions: CreepAction[] = [
        { creepId: 'c1', action: 'attack_creep', targetId: 'c2', damage: MELEE_CREEP_ATTACK },
      ]

      const result = applyCreepActions(state, actions).state
      expect(result.players.p1!.xp).toBe(CREEP_XP_SHARED)
    })

    it('pays no shared XP while the creep survives the hit', () => {
      const laner = makePlayer({ id: 'p1', team: 'chaff', zone: 'mid-river', xp: 0 })
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'chaff', zone: 'mid-river', hp: 400 }),
          makeCreep({ id: 'c2', team: 'audit', zone: 'mid-river', hp: 400 }),
        ],
        players: { p1: laner },
      })

      const actions: CreepAction[] = [
        { creepId: 'c1', action: 'attack_creep', targetId: 'c2', damage: MELEE_CREEP_ATTACK },
      ]

      const result = applyCreepActions(state, actions).state
      expect(result.players.p1!.xp).toBe(0)
    })

    it('does not pay shared XP to the dying creep’s own team, the dead, or another zone', () => {
      const owner = makePlayer({ id: 'p1', team: 'audit', zone: 'mid-river', xp: 0 })
      const dead = makePlayer({ id: 'p2', team: 'chaff', zone: 'mid-river', xp: 0, alive: false })
      const elsewhere = makePlayer({ id: 'p3', team: 'chaff', zone: 'mid-t1-chaff', xp: 0 })
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'chaff', zone: 'mid-river', hp: 400 }),
          makeCreep({ id: 'c2', team: 'audit', zone: 'mid-river', hp: 10 }),
        ],
        players: { p1: owner, p2: dead, p3: elsewhere },
      })

      const actions: CreepAction[] = [
        { creepId: 'c1', action: 'attack_creep', targetId: 'c2', damage: MELEE_CREEP_ATTACK },
      ]

      const result = applyCreepActions(state, actions).state
      expect(result.players.p1!.xp).toBe(0)
      expect(result.players.p2!.xp).toBe(0)
      expect(result.players.p3!.xp).toBe(0)
    })

    it('should remove dead creeps after applying actions', () => {
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'chaff', zone: 'mid-river', hp: 400 }),
          makeCreep({ id: 'c2', team: 'audit', zone: 'mid-river', hp: 10 }),
        ],
      })

      const actions: CreepAction[] = [
        { creepId: 'c1', action: 'attack_creep', targetId: 'c2', damage: MELEE_CREEP_ATTACK },
      ]

      const result = applyCreepActions(state, actions).state
      expect(result.creeps.find((c) => c.id === 'c2')).toBeUndefined()
    })

    it('should apply damage to heroes with defense reduction', () => {
      const player = makePlayer({ id: 'p1', team: 'audit', zone: 'mid-river', hp: 500, defense: 3 })
      const state = makeGameState({
        creeps: [makeCreep({ id: 'c1', team: 'chaff', zone: 'mid-river' })],
        players: { p1: player },
      })

      const actions: CreepAction[] = [
        { creepId: 'c1', action: 'attack_hero', targetId: 'p1', damage: MELEE_CREEP_ATTACK },
      ]

      const result = applyCreepActions(state, actions).state
      // resolvePhysicalHit routes through getEffectiveDefense (items + talents
      // + buffs), not the raw player.defense field.
      const expectedDamage = calculatePhysicalDamage(
        MELEE_CREEP_ATTACK,
        getEffectiveDefense(player),
      )
      expect(result.players['p1']!.hp).toBe(500 - expectedDamage)
      expect(result.players['p1']!.alive).toBe(true)
    })

    it('should kill heroes when HP reaches 0', () => {
      const state = makeGameState({
        creeps: [makeCreep({ id: 'c1', team: 'chaff', zone: 'mid-river' })],
        players: {
          // hp:1 means any positive damage kills; defense override is ignored by
          // getEffectiveDefense (echo base defense applies), but the lethal blow
          // lands regardless.
          p1: makePlayer({ id: 'p1', team: 'audit', zone: 'mid-river', hp: 1 }),
        },
      })

      const actions: CreepAction[] = [
        { creepId: 'c1', action: 'attack_hero', targetId: 'p1', damage: MELEE_CREEP_ATTACK },
      ]

      const result = applyCreepActions(state, actions).state
      expect(result.players['p1']!.hp).toBe(0)
      expect(result.players['p1']!.alive).toBe(false)
    })

    it('emits a damage event naming the creep that hit', () => {
      const player = makePlayer({ id: 'p1', team: 'audit', zone: 'mid-river', hp: 500 })
      const state = makeGameState({
        tick: 12,
        creeps: [makeCreep({ id: 'c1', team: 'chaff', zone: 'mid-river' })],
        players: { p1: player },
      })

      const actions: CreepAction[] = [
        { creepId: 'c1', action: 'attack_hero', targetId: 'p1', damage: MELEE_CREEP_ATTACK },
      ]

      const { state: after, events } = applyCreepActions(state, actions)
      const expectedDamage = calculatePhysicalDamage(
        MELEE_CREEP_ATTACK,
        getEffectiveDefense(player),
      )
      expect(events).toEqual([
        {
          _tag: 'damage',
          tick: 12,
          sourceId: 'c1',
          targetId: 'p1',
          amount: expectedDamage,
          damageType: 'physical',
        },
      ])
      expect(500 - after.players['p1']!.hp).toBe(expectedDamage)
    })

    it('emits no damage event when a shield absorbs the whole hit', () => {
      const state = makeGameState({
        creeps: [makeCreep({ id: 'c1', team: 'chaff', zone: 'mid-river' })],
        players: {
          p1: makePlayer({
            id: 'p1',
            team: 'audit',
            zone: 'mid-river',
            hp: 500,
            buffs: [{ id: 'shield', stacks: 999, ticksRemaining: 5, source: 'x' }],
          }),
        },
      })

      const result = applyCreepActions(state, [
        { creepId: 'c1', action: 'attack_hero', targetId: 'p1', damage: MELEE_CREEP_ATTACK },
      ])

      expect(result.events).toEqual([])
      expect(result.state.players['p1']!.hp).toBe(500)
    })

    it('should apply damage to ice', () => {
      const state = makeGameState({
        creeps: [makeCreep({ id: 'c1', team: 'chaff', zone: 'mid-t1-audit' })],
      })

      const ice = state.ice.find((t) => t.zone === 'mid-t1-audit')!
      const initialHp = ice.hp

      const actions: CreepAction[] = [
        {
          creepId: 'c1',
          action: 'attack_ice',
          targetZone: 'mid-t1-audit',
          damage: MELEE_CREEP_ATTACK,
        },
      ]

      const result = applyCreepActions(state, actions).state
      const updatedIce = result.ice.find((t) => t.zone === 'mid-t1-audit')!
      expect(updatedIce.hp).toBe(initialHp - MELEE_CREEP_ATTACK)
    })

    it('does NOT damage an invulnerable (glyphed) ice — the push bounces off', () => {
      // Glyph must blunt the whole push, not just heroes. Hero attacks already
      // bounce off an invulnerable ice; creep damage must too.
      const ice = initializeIce().map((t) =>
        t.zone === 'mid-t1-audit' ? { ...t, invulnerable: true } : t,
      )
      const state = makeGameState({
        creeps: [makeCreep({ id: 'c1', team: 'chaff', zone: 'mid-t1-audit' })],
        ice,
      })
      const initialHp = state.ice.find((t) => t.zone === 'mid-t1-audit')!.hp

      const actions: CreepAction[] = [
        {
          creepId: 'c1',
          action: 'attack_ice',
          targetZone: 'mid-t1-audit',
          damage: MELEE_CREEP_ATTACK,
        },
      ]

      const result = applyCreepActions(state, actions).state
      const target = result.ice.find((t) => t.zone === 'mid-t1-audit')!
      expect(target.hp).toBe(initialHp) // unchanged — glyph protects vs creeps too
    })

    it('should destroy ice when HP reaches 0', () => {
      const ice = initializeIce().map((t) => (t.zone === 'mid-t1-audit' ? { ...t, hp: 10 } : t))

      const state = makeGameState({
        creeps: [makeCreep({ id: 'c1', team: 'chaff', zone: 'mid-t1-audit' })],
        ice,
      })

      const actions: CreepAction[] = [
        {
          creepId: 'c1',
          action: 'attack_ice',
          targetZone: 'mid-t1-audit',
          damage: MELEE_CREEP_ATTACK,
        },
      ]

      const result = applyCreepActions(state, actions).state
      const updatedIce = result.ice.find((t) => t.zone === 'mid-t1-audit')!
      expect(updatedIce.hp).toBe(0)
      expect(updatedIce.alive).toBe(false)
    })

    it('should not apply actions from dead creeps', () => {
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'chaff', zone: 'mid-river', hp: 0 }),
          makeCreep({ id: 'c2', team: 'audit', zone: 'mid-river', hp: 400 }),
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
          makeCreep({ id: 'c1', team: 'chaff', zone: 'mid-river', hp: 400 }),
          makeCreep({ id: 'c2', team: 'audit', zone: 'mid-river', hp: 5 }),
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
        ancients: vulnerableAuditAncients(),
        creeps: [makeCreep({ id: 'c1', team: 'chaff', zone: 'audit-base' })],
      })

      const actions = runCreepAI(state)
      expect(actions).toHaveLength(1)
      expect(actions[0]!.action).toBe('attack_ancient')
      expect(actions[0]!.damage).toBe(MELEE_CREEP_ATTACK)
    })

    it('prefers the vulnerable Ancient over enemy heroes in base', () => {
      const state = makeGameState({
        ancients: vulnerableAuditAncients(),
        creeps: [makeCreep({ id: 'c1', team: 'chaff', zone: 'audit-base' })],
        players: {
          p1: makePlayer({ id: 'p1', team: 'audit', zone: 'audit-base' }),
        },
      })

      const actions = runCreepAI(state)
      expect(actions[0]!.action).toBe('attack_ancient')
    })

    it('still fights enemy creeps before the Ancient', () => {
      const state = makeGameState({
        ancients: vulnerableAuditAncients(),
        creeps: [
          makeCreep({ id: 'c1', team: 'chaff', zone: 'audit-base' }),
          makeCreep({ id: 'c2', team: 'audit', zone: 'audit-base' }),
        ],
      })

      const actions = runCreepAI(state)
      const c1Action = actions.find((a) => a.creepId === 'c1')
      expect(c1Action!.action).toBe('attack_creep')
    })

    it('does not attack an invulnerable Ancient — attacks heroes instead', () => {
      const state = makeGameState({
        creeps: [makeCreep({ id: 'c1', team: 'chaff', zone: 'audit-base' })],
        players: {
          p1: makePlayer({ id: 'p1', team: 'audit', zone: 'audit-base' }),
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
          chaff: ancients.chaff,
          audit: { ...ancients.audit, hp: 0, alive: false, vulnerable: true },
        },
        creeps: [makeCreep({ id: 'c1', team: 'chaff', zone: 'audit-base' })],
      })

      const actions = runCreepAI(state)
      expect(actions[0]!.action).not.toBe('attack_ancient')
    })

    it('applies Ancient damage and emits events via applyCreepActions', () => {
      const state = makeGameState({
        ancients: vulnerableAuditAncients(),
        creeps: [makeCreep({ id: 'c1', team: 'chaff', zone: 'audit-base' })],
      })

      const actions: CreepAction[] = [
        { creepId: 'c1', action: 'attack_ancient', damage: MELEE_CREEP_ATTACK },
      ]

      const result = applyCreepActions(state, actions)
      expect(result.state.ancients.audit.hp).toBe(
        result.state.ancients.audit.maxHp - MELEE_CREEP_ATTACK,
      )
      expect(result.events).toHaveLength(1)
      expect(result.events[0]!._tag).toBe('damage')
    })

    it('destroys the Ancient and emits a dedicated ancient_destroyed event', () => {
      const ancients = initializeAncients()
      const state = makeGameState({
        ancients: {
          chaff: ancients.chaff,
          audit: { ...ancients.audit, hp: 5, vulnerable: true },
        },
        creeps: [makeCreep({ id: 'c1', team: 'chaff', zone: 'audit-base' })],
      })

      const actions: CreepAction[] = [
        { creepId: 'c1', action: 'attack_ancient', damage: MELEE_CREEP_ATTACK },
      ]

      const result = applyCreepActions(state, actions)
      expect(result.state.ancients.audit.alive).toBe(false)
      expect(result.state.ancients.audit.hp).toBe(0)
      expect(result.events.some((e) => e._tag === 'ice_kill')).toBe(false)
      const killEvent = result.events.find((e) => e._tag === 'ancient_destroyed')
      expect(killEvent).toBeDefined()
      expect(killEvent).toMatchObject({ team: 'audit', killerTeam: 'chaff' })
    })

    it('does not damage an invulnerable Ancient even if an action sneaks through', () => {
      const state = makeGameState({
        creeps: [makeCreep({ id: 'c1', team: 'chaff', zone: 'audit-base' })],
      })

      const actions: CreepAction[] = [
        { creepId: 'c1', action: 'attack_ancient', damage: MELEE_CREEP_ATTACK },
      ]

      const result = applyCreepActions(state, actions)
      expect(result.state.ancients.audit.hp).toBe(result.state.ancients.audit.maxHp)
      expect(result.events).toHaveLength(0)
    })
  })

  describe('base idle despawn (garbage collection)', () => {
    it('waits in base while under the idle threshold', () => {
      const state = makeGameState({
        creeps: [makeCreep({ id: 'c1', team: 'chaff', zone: 'audit-base', baseIdleTicks: 0 })],
      })

      const actions = runCreepAI(state)
      expect(actions[0]!.action).toBe('wait_in_base')
    })

    it('despawns once idle ticks reach the threshold', () => {
      const state = makeGameState({
        creeps: [
          makeCreep({
            id: 'c1',
            team: 'chaff',
            zone: 'audit-base',
            baseIdleTicks: CREEP_BASE_IDLE_DESPAWN_TICKS - 1,
          }),
        ],
      })

      const actions = runCreepAI(state)
      expect(actions[0]!.action).toBe('despawn')
    })

    it('wait_in_base increments the idle counter', () => {
      const state = makeGameState({
        creeps: [makeCreep({ id: 'c1', team: 'chaff', zone: 'audit-base' })],
      })

      const result = applyCreepActions(state, [{ creepId: 'c1', action: 'wait_in_base' }])
      expect(result.state.creeps[0]!.baseIdleTicks).toBe(1)
    })

    it('despawn removes the creep from state', () => {
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'chaff', zone: 'audit-base' }),
          makeCreep({ id: 'c2', team: 'chaff', zone: 'mid-river' }),
        ],
      })

      const result = applyCreepActions(state, [{ creepId: 'c1', action: 'despawn' }])
      expect(result.state.creeps.find((c) => c.id === 'c1')).toBeUndefined()
      expect(result.state.creeps.find((c) => c.id === 'c2')).toBeDefined()
    })

    it('does not idle-despawn while the vulnerable Ancient is attackable', () => {
      const state = makeGameState({
        ancients: vulnerableAuditAncients(),
        creeps: [
          makeCreep({
            id: 'c1',
            team: 'chaff',
            zone: 'audit-base',
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
        creeps: [makeCreep({ id: 'c1', team: 'chaff', zone: 'mid-river' })],
      })
      expect(enforceCreepZoneCap(state)).toBe(state)
    })

    it('despawns the oldest creeps first when over the cap', () => {
      const creeps = Array.from({ length: MAX_CREEPS_PER_ZONE_PER_TEAM + 5 }, (_, i) =>
        makeCreep({ id: `c${i}`, team: 'chaff', zone: 'mid-river' }),
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
      const chaff = Array.from({ length: MAX_CREEPS_PER_ZONE_PER_TEAM + 2 }, (_, i) =>
        makeCreep({ id: `r${i}`, team: 'chaff', zone: 'mid-river' }),
      )
      const audit = Array.from({ length: 3 }, (_, i) =>
        makeCreep({ id: `d${i}`, team: 'audit', zone: 'top-river' }),
      )
      const state = makeGameState({ creeps: [...chaff, ...audit] })

      const result = enforceCreepZoneCap(state)
      expect(result.creeps.filter((c) => c.team === 'chaff')).toHaveLength(
        MAX_CREEPS_PER_ZONE_PER_TEAM,
      )
      expect(result.creeps.filter((c) => c.team === 'audit')).toHaveLength(3)
    })

    it('preserves spawn order of the survivors', () => {
      const creeps = Array.from({ length: MAX_CREEPS_PER_ZONE_PER_TEAM + 1 }, (_, i) =>
        makeCreep({ id: `c${i}`, team: 'chaff', zone: 'mid-river' }),
      )
      const state = makeGameState({ creeps })

      const result = enforceCreepZoneCap(state)
      const ids = result.creeps.map((c) => Number(c.id.slice(1)))
      const sorted = [...ids].sort((a, b) => a - b)
      expect(ids).toEqual(sorted)
    })
  })
})
