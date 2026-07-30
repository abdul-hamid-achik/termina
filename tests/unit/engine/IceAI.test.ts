import { describe, it, expect } from 'vitest'
import { runIceAI, applyIceActions, type IceAction } from '~~/server/game/engine/IceAI'
import { initializeAncients } from '~~/server/game/engine/AncientSystem'
import type { GameState, PlayerState, CreepState } from '~~/shared/types/game'
import type { GameEngineEvent } from '~~/server/game/protocol/events'
import { initializeZoneStates, initializeIce } from '~~/server/game/map/zones'
import { ICE_ATTACK } from '~~/shared/constants/balance'
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

describe('IceAI', () => {
  describe('runIceAI', () => {
    it('should not generate actions for dead ice', () => {
      const ice = initializeIce().map((t) => ({ ...t, hp: 0, alive: false }))
      const state = makeGameState({
        ice,
        players: {
          p1: makePlayer({ id: 'p1', team: 'audit', zone: 'mid-t1-chaff' }),
        },
      })

      const actions = runIceAI(state)
      expect(actions).toHaveLength(0)
    })

    it('should not generate actions when no enemies in ice zone', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'chaff', zone: 'mid-t1-chaff' }),
        },
      })

      const actions = runIceAI(state)
      // Chaff player in chaff ice zone — not an enemy
      expect(actions).toHaveLength(0)
    })

    it('should target enemy heroes in ice zone', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'audit', zone: 'mid-t1-chaff' }),
        },
      })

      const actions = runIceAI(state)
      const midT1Action = actions.find((a) => a.iceZone === 'mid-t1-chaff')
      expect(midT1Action).toBeDefined()
      expect(midT1Action!.targetType).toBe('hero')
      expect(midT1Action!.targetId).toBe('p1')
      expect(midT1Action!.damage).toBe(ICE_ATTACK)
    })

    it('should target enemy creeps in ice zone', () => {
      const state = makeGameState({
        creeps: [makeCreep({ id: 'c1', team: 'audit', zone: 'mid-t1-chaff' })],
      })

      const actions = runIceAI(state)
      const midT1Action = actions.find((a) => a.iceZone === 'mid-t1-chaff')
      expect(midT1Action).toBeDefined()
      expect(midT1Action!.targetType).toBe('creep')
      expect(midT1Action!.targetId).toBe('c1')
    })

    it('should prioritize creeps over a passive hero (MOBA aggro convention)', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'audit', zone: 'mid-t1-chaff' }),
        },
        creeps: [makeCreep({ id: 'c1', team: 'audit', zone: 'mid-t1-chaff' })],
      })

      const actions = runIceAI(state)
      const midT1Action = actions.find((a) => a.iceZone === 'mid-t1-chaff')
      expect(midT1Action!.targetType).toBe('creep')
      expect(midT1Action!.targetId).toBe('c1')
    })

    it('should prioritize a hero attacking an allied hero above creeps', () => {
      const state = makeGameState({
        players: {
          ally: makePlayer({ id: 'ally', team: 'chaff', zone: 'mid-t1-chaff' }),
          attacker: makePlayer({
            id: 'attacker',
            team: 'audit',
            zone: 'mid-t1-chaff',
            name: 'Attacker',
          }),
        },
        creeps: [makeCreep({ id: 'c1', team: 'audit', zone: 'mid-t1-chaff' })],
      })

      const heroAttackers = new Map<string, string>()
      heroAttackers.set('attacker', 'ally')

      const actions = runIceAI(state, heroAttackers)
      const midT1Action = actions.find((a) => a.iceZone === 'mid-t1-chaff')
      expect(midT1Action!.targetType).toBe('hero')
      expect(midT1Action!.targetId).toBe('attacker')
    })

    it('should prioritize a hero attacking the ice itself above creeps', () => {
      const state = makeGameState({
        players: {
          attacker: makePlayer({
            id: 'attacker',
            team: 'audit',
            zone: 'mid-t1-chaff',
            name: 'Attacker',
          }),
        },
        creeps: [makeCreep({ id: 'c1', team: 'audit', zone: 'mid-t1-chaff' })],
      })

      // Hero→ice damage events carry targetId `ice_${zone}`
      const priorEvents: GameEngineEvent[] = [
        {
          _tag: 'damage',
          tick: 1,
          sourceId: 'attacker',
          targetId: 'ice_mid-t1-chaff',
          amount: 60,
          damageType: 'physical',
        },
      ]

      const actions = runIceAI(state, undefined, priorEvents)
      const midT1Action = actions.find((a) => a.iceZone === 'mid-t1-chaff')
      expect(midT1Action!.targetType).toBe('hero')
      expect(midT1Action!.targetId).toBe('attacker')
    })

    it('should not aggro a hero who attacked a different ice', () => {
      const state = makeGameState({
        players: {
          attacker: makePlayer({
            id: 'attacker',
            team: 'audit',
            zone: 'mid-t1-chaff',
            name: 'Attacker',
          }),
        },
        creeps: [makeCreep({ id: 'c1', team: 'audit', zone: 'mid-t1-chaff' })],
      })

      const priorEvents: GameEngineEvent[] = [
        {
          _tag: 'damage',
          tick: 1,
          sourceId: 'attacker',
          targetId: 'ice_top-t1-chaff',
          amount: 60,
          damageType: 'physical',
        },
      ]

      const actions = runIceAI(state, undefined, priorEvents)
      const midT1Action = actions.find((a) => a.iceZone === 'mid-t1-chaff')
      // Different ice attacked — creeps still tank this one
      expect(midT1Action!.targetType).toBe('creep')
    })

    it('should prioritize hero attacking allied hero in ice zone (priority 1)', () => {
      const state = makeGameState({
        players: {
          ally: makePlayer({ id: 'ally', team: 'chaff', zone: 'mid-t1-chaff' }),
          attacker: makePlayer({
            id: 'attacker',
            team: 'audit',
            zone: 'mid-t1-chaff',
            name: 'Attacker',
          }),
          bystander: makePlayer({
            id: 'bystander',
            team: 'audit',
            zone: 'mid-t1-chaff',
            name: 'Bystander',
          }),
        },
      })

      // attacker is attacking ally
      const heroAttackers = new Map<string, string>()
      heroAttackers.set('attacker', 'ally')

      const actions = runIceAI(state, heroAttackers)
      const midT1Action = actions.find((a) => a.iceZone === 'mid-t1-chaff')
      expect(midT1Action!.targetType).toBe('hero')
      expect(midT1Action!.targetId).toBe('attacker')
    })

    it('should not target dead enemy heroes', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'audit', zone: 'mid-t1-chaff', alive: false, hp: 0 }),
        },
      })

      const actions = runIceAI(state)
      const midT1Action = actions.find((a) => a.iceZone === 'mid-t1-chaff')
      expect(midT1Action).toBeUndefined()
    })

    it('should not target dead creeps', () => {
      const state = makeGameState({
        creeps: [makeCreep({ id: 'c1', team: 'audit', zone: 'mid-t1-chaff', hp: 0 })],
      })

      const actions = runIceAI(state)
      const midT1Action = actions.find((a) => a.iceZone === 'mid-t1-chaff')
      expect(midT1Action).toBeUndefined()
    })

    it('should generate actions for multiple ice simultaneously', () => {
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'audit', zone: 'mid-t1-chaff' }),
          makeCreep({ id: 'c2', team: 'audit', zone: 'top-t1-chaff' }),
          makeCreep({ id: 'c3', team: 'chaff', zone: 'bot-t1-audit' }),
        ],
      })

      const actions = runIceAI(state)
      // Mid T1 rad should target c1, Top T1 rad should target c2, Bot T1 audit should target c3
      expect(actions.find((a) => a.iceZone === 'mid-t1-chaff')!.targetId).toBe('c1')
      expect(actions.find((a) => a.iceZone === 'top-t1-chaff')!.targetId).toBe('c2')
      expect(actions.find((a) => a.iceZone === 'bot-t1-audit')!.targetId).toBe('c3')
    })

    it('should fall back to hero when hero attacker targets non-ally', () => {
      const state = makeGameState({
        players: {
          attacker: makePlayer({
            id: 'attacker',
            team: 'audit',
            zone: 'mid-t1-chaff',
            name: 'Attacker',
          }),
        },
      })

      // Attacker is attacking a non-present player (not in this zone)
      const heroAttackers = new Map<string, string>()
      heroAttackers.set('attacker', 'someone-else')

      const actions = runIceAI(state, heroAttackers)
      const midT1Action = actions.find((a) => a.iceZone === 'mid-t1-chaff')
      // Should still target the enemy hero (priority 2 fallback)
      expect(midT1Action!.targetType).toBe('hero')
      expect(midT1Action!.targetId).toBe('attacker')
    })
  })

  describe('applyIceActions', () => {
    it('should apply damage to heroes with defense reduction', () => {
      const player = makePlayer({
        id: 'p1',
        team: 'audit',
        zone: 'mid-t1-chaff',
        hp: 500,
        defense: 3,
      })
      const state = makeGameState({
        players: { p1: player },
      })

      const actions: IceAction[] = [
        { iceZone: 'mid-t1-chaff', targetType: 'hero', targetId: 'p1', damage: ICE_ATTACK },
      ]

      const result = applyIceActions(state, actions).state
      // resolvePhysicalHit routes through getEffectiveDefense (items + talents
      // + buffs), not the raw player.defense field.
      const expectedDamage = calculatePhysicalDamage(ICE_ATTACK, getEffectiveDefense(player))
      expect(result.players['p1']!.hp).toBe(500 - expectedDamage)
      expect(result.players['p1']!.alive).toBe(true)
    })

    it('does no damage to a physically-immune hero (Ghost/Ethereal/invulnerable)', () => {
      for (const id of ['ghost_form', 'ethereal', 'invulnerable']) {
        const state = makeGameState({
          players: {
            p1: makePlayer({
              id: 'p1',
              team: 'audit',
              zone: 'mid-t1-chaff',
              hp: 500,
              buffs: [{ id, stacks: 1, ticksRemaining: 2, source: 'x' }],
            }),
          },
        })
        const actions: IceAction[] = [
          { iceZone: 'mid-t1-chaff', targetType: 'hero', targetId: 'p1', damage: ICE_ATTACK },
        ]
        const result = applyIceActions(state, actions).state
        expect(result.players['p1']!.hp).toBe(500) // unscathed
      }
    })

    it('emits a damage event naming the ice that fired', () => {
      const player = makePlayer({ id: 'p1', team: 'audit', zone: 'mid-t1-chaff', hp: 500 })
      const state = makeGameState({ tick: 7, players: { p1: player } })

      const actions: IceAction[] = [
        { iceZone: 'mid-t1-chaff', targetType: 'hero', targetId: 'p1', damage: ICE_ATTACK },
      ]

      const { state: after, events } = applyIceActions(state, actions)
      const expectedDamage = calculatePhysicalDamage(ICE_ATTACK, getEffectiveDefense(player))
      expect(events).toEqual([
        {
          _tag: 'damage',
          tick: 7,
          // Same id convention selectIceTarget reads for hero→ice damage.
          sourceId: 'ice_mid-t1-chaff',
          targetId: 'p1',
          amount: expectedDamage,
          damageType: 'physical',
        },
      ])
      // The event amount is the HP actually lost, not the raw ICE_ATTACK.
      expect(500 - after.players['p1']!.hp).toBe(expectedDamage)
    })

    it('emits no damage event when a shield absorbs the whole shot', () => {
      // Not immune and not dodged — the hero simply loses no HP. Emitting here
      // would paint a "0" damage float, which reads as a bug.
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            team: 'audit',
            zone: 'mid-t1-chaff',
            hp: 500,
            buffs: [{ id: 'shield', stacks: 999, ticksRemaining: 5, source: 'x' }],
          }),
        },
      })
      const actions: IceAction[] = [
        { iceZone: 'mid-t1-chaff', targetType: 'hero', targetId: 'p1', damage: ICE_ATTACK },
      ]

      const result = applyIceActions(state, actions)
      expect(result.events).toEqual([])
      expect(result.state.players['p1']!.hp).toBe(500)
    })

    it('emits no damage event for a creep shot — only hero damage is narrated', () => {
      const state = makeGameState({
        creeps: [makeCreep({ id: 'c1', team: 'audit', zone: 'mid-t1-chaff', hp: 400 })],
      })
      const actions: IceAction[] = [
        { iceZone: 'mid-t1-chaff', targetType: 'creep', targetId: 'c1', damage: ICE_ATTACK },
      ]

      expect(applyIceActions(state, actions).events).toEqual([])
    })

    it('should kill heroes when HP drops to 0', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'audit', zone: 'mid-t1-chaff', hp: 50 }),
        },
      })

      const actions: IceAction[] = [
        { iceZone: 'mid-t1-chaff', targetType: 'hero', targetId: 'p1', damage: ICE_ATTACK },
      ]

      const result = applyIceActions(state, actions).state
      expect(result.players['p1']!.hp).toBe(0)
      expect(result.players['p1']!.alive).toBe(false)
    })

    it('should apply damage to creeps', () => {
      const state = makeGameState({
        creeps: [makeCreep({ id: 'c1', team: 'audit', zone: 'mid-t1-chaff', hp: 400 })],
      })

      const actions: IceAction[] = [
        { iceZone: 'mid-t1-chaff', targetType: 'creep', targetId: 'c1', damage: ICE_ATTACK },
      ]

      const result = applyIceActions(state, actions).state
      const c1 = result.creeps.find((c) => c.id === 'c1')
      expect(c1!.hp).toBe(400 - ICE_ATTACK)
    })

    it('should remove dead creeps after damage', () => {
      const state = makeGameState({
        creeps: [makeCreep({ id: 'c1', team: 'audit', zone: 'mid-t1-chaff', hp: 50 })],
      })

      const actions: IceAction[] = [
        { iceZone: 'mid-t1-chaff', targetType: 'creep', targetId: 'c1', damage: ICE_ATTACK },
      ]

      const result = applyIceActions(state, actions).state
      expect(result.creeps.find((c) => c.id === 'c1')).toBeUndefined()
    })

    it('should clamp hero HP to 0 (not negative)', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'audit', zone: 'mid-t1-chaff', hp: 1 }),
        },
      })

      const actions: IceAction[] = [
        { iceZone: 'mid-t1-chaff', targetType: 'hero', targetId: 'p1', damage: ICE_ATTACK },
      ]

      const result = applyIceActions(state, actions).state
      expect(result.players['p1']!.hp).toBe(0)
    })

    it('should handle multiple ice actions', () => {
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'audit', zone: 'mid-t1-chaff', hp: 400 }),
          makeCreep({ id: 'c2', team: 'chaff', zone: 'mid-t1-audit', hp: 400 }),
        ],
      })

      const actions: IceAction[] = [
        { iceZone: 'mid-t1-chaff', targetType: 'creep', targetId: 'c1', damage: ICE_ATTACK },
        { iceZone: 'mid-t1-audit', targetType: 'creep', targetId: 'c2', damage: ICE_ATTACK },
      ]

      const result = applyIceActions(state, actions).state
      const c1 = result.creeps.find((c) => c.id === 'c1')
      const c2 = result.creeps.find((c) => c.id === 'c2')
      expect(c1!.hp).toBe(400 - ICE_ATTACK)
      expect(c2!.hp).toBe(400 - ICE_ATTACK)
    })

    it('should not damage already dead heroes', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'audit', zone: 'mid-t1-chaff', hp: 0, alive: false }),
        },
      })

      const actions: IceAction[] = [
        { iceZone: 'mid-t1-chaff', targetType: 'hero', targetId: 'p1', damage: ICE_ATTACK },
      ]

      const result = applyIceActions(state, actions).state
      expect(result.players['p1']!.hp).toBe(0)
    })
  })
})
