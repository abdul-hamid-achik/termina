import { describe, it, expect } from 'vitest'
import { runTowerAI, applyTowerActions, type TowerAction } from '~~/server/game/engine/TowerAI'
import { initializeAncients } from '~~/server/game/engine/AncientSystem'
import type { GameState, PlayerState, CreepState } from '~~/shared/types/game'
import type { GameEngineEvent } from '~~/server/game/protocol/events'
import { initializeZoneStates, initializeTowers } from '~~/server/game/map/zones'
import { TOWER_ATTACK } from '~~/shared/constants/balance'
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
    towerDamageDealt: 0,
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
      chaff: { id: 'chaff', kills: 0, towerKills: 0, gold: 0 },
      audit: { id: 'audit', kills: 0, towerKills: 0, gold: 0 },
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

describe('TowerAI', () => {
  describe('runTowerAI', () => {
    it('should not generate actions for dead towers', () => {
      const towers = initializeTowers().map((t) => ({ ...t, hp: 0, alive: false }))
      const state = makeGameState({
        towers,
        players: {
          p1: makePlayer({ id: 'p1', team: 'audit', zone: 'mid-t1-chaff' }),
        },
      })

      const actions = runTowerAI(state)
      expect(actions).toHaveLength(0)
    })

    it('should not generate actions when no enemies in tower zone', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'chaff', zone: 'mid-t1-chaff' }),
        },
      })

      const actions = runTowerAI(state)
      // Chaff player in chaff tower zone — not an enemy
      expect(actions).toHaveLength(0)
    })

    it('should target enemy heroes in tower zone', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'audit', zone: 'mid-t1-chaff' }),
        },
      })

      const actions = runTowerAI(state)
      const midT1Action = actions.find((a) => a.towerZone === 'mid-t1-chaff')
      expect(midT1Action).toBeDefined()
      expect(midT1Action!.targetType).toBe('hero')
      expect(midT1Action!.targetId).toBe('p1')
      expect(midT1Action!.damage).toBe(TOWER_ATTACK)
    })

    it('should target enemy creeps in tower zone', () => {
      const state = makeGameState({
        creeps: [makeCreep({ id: 'c1', team: 'audit', zone: 'mid-t1-chaff' })],
      })

      const actions = runTowerAI(state)
      const midT1Action = actions.find((a) => a.towerZone === 'mid-t1-chaff')
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

      const actions = runTowerAI(state)
      const midT1Action = actions.find((a) => a.towerZone === 'mid-t1-chaff')
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

      const actions = runTowerAI(state, heroAttackers)
      const midT1Action = actions.find((a) => a.towerZone === 'mid-t1-chaff')
      expect(midT1Action!.targetType).toBe('hero')
      expect(midT1Action!.targetId).toBe('attacker')
    })

    it('should prioritize a hero attacking the tower itself above creeps', () => {
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

      // Hero→tower damage events carry targetId `tower_${zone}`
      const priorEvents: GameEngineEvent[] = [
        {
          _tag: 'damage',
          tick: 1,
          sourceId: 'attacker',
          targetId: 'tower_mid-t1-chaff',
          amount: 60,
          damageType: 'physical',
        },
      ]

      const actions = runTowerAI(state, undefined, priorEvents)
      const midT1Action = actions.find((a) => a.towerZone === 'mid-t1-chaff')
      expect(midT1Action!.targetType).toBe('hero')
      expect(midT1Action!.targetId).toBe('attacker')
    })

    it('should not aggro a hero who attacked a different tower', () => {
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
          targetId: 'tower_top-t1-chaff',
          amount: 60,
          damageType: 'physical',
        },
      ]

      const actions = runTowerAI(state, undefined, priorEvents)
      const midT1Action = actions.find((a) => a.towerZone === 'mid-t1-chaff')
      // Different tower attacked — creeps still tank this one
      expect(midT1Action!.targetType).toBe('creep')
    })

    it('should prioritize hero attacking allied hero in tower zone (priority 1)', () => {
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

      const actions = runTowerAI(state, heroAttackers)
      const midT1Action = actions.find((a) => a.towerZone === 'mid-t1-chaff')
      expect(midT1Action!.targetType).toBe('hero')
      expect(midT1Action!.targetId).toBe('attacker')
    })

    it('should not target dead enemy heroes', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'audit', zone: 'mid-t1-chaff', alive: false, hp: 0 }),
        },
      })

      const actions = runTowerAI(state)
      const midT1Action = actions.find((a) => a.towerZone === 'mid-t1-chaff')
      expect(midT1Action).toBeUndefined()
    })

    it('should not target dead creeps', () => {
      const state = makeGameState({
        creeps: [makeCreep({ id: 'c1', team: 'audit', zone: 'mid-t1-chaff', hp: 0 })],
      })

      const actions = runTowerAI(state)
      const midT1Action = actions.find((a) => a.towerZone === 'mid-t1-chaff')
      expect(midT1Action).toBeUndefined()
    })

    it('should generate actions for multiple towers simultaneously', () => {
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'audit', zone: 'mid-t1-chaff' }),
          makeCreep({ id: 'c2', team: 'audit', zone: 'top-t1-chaff' }),
          makeCreep({ id: 'c3', team: 'chaff', zone: 'bot-t1-audit' }),
        ],
      })

      const actions = runTowerAI(state)
      // Mid T1 rad should target c1, Top T1 rad should target c2, Bot T1 audit should target c3
      expect(actions.find((a) => a.towerZone === 'mid-t1-chaff')!.targetId).toBe('c1')
      expect(actions.find((a) => a.towerZone === 'top-t1-chaff')!.targetId).toBe('c2')
      expect(actions.find((a) => a.towerZone === 'bot-t1-audit')!.targetId).toBe('c3')
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

      const actions = runTowerAI(state, heroAttackers)
      const midT1Action = actions.find((a) => a.towerZone === 'mid-t1-chaff')
      // Should still target the enemy hero (priority 2 fallback)
      expect(midT1Action!.targetType).toBe('hero')
      expect(midT1Action!.targetId).toBe('attacker')
    })
  })

  describe('applyTowerActions', () => {
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

      const actions: TowerAction[] = [
        { towerZone: 'mid-t1-chaff', targetType: 'hero', targetId: 'p1', damage: TOWER_ATTACK },
      ]

      const result = applyTowerActions(state, actions).state
      // resolvePhysicalHit routes through getEffectiveDefense (items + talents
      // + buffs), not the raw player.defense field.
      const expectedDamage = calculatePhysicalDamage(TOWER_ATTACK, getEffectiveDefense(player))
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
        const actions: TowerAction[] = [
          { towerZone: 'mid-t1-chaff', targetType: 'hero', targetId: 'p1', damage: TOWER_ATTACK },
        ]
        const result = applyTowerActions(state, actions).state
        expect(result.players['p1']!.hp).toBe(500) // unscathed
      }
    })

    it('emits a damage event naming the tower that fired', () => {
      const player = makePlayer({ id: 'p1', team: 'audit', zone: 'mid-t1-chaff', hp: 500 })
      const state = makeGameState({ tick: 7, players: { p1: player } })

      const actions: TowerAction[] = [
        { towerZone: 'mid-t1-chaff', targetType: 'hero', targetId: 'p1', damage: TOWER_ATTACK },
      ]

      const { state: after, events } = applyTowerActions(state, actions)
      const expectedDamage = calculatePhysicalDamage(TOWER_ATTACK, getEffectiveDefense(player))
      expect(events).toEqual([
        {
          _tag: 'damage',
          tick: 7,
          // Same id convention selectTowerTarget reads for hero→tower damage.
          sourceId: 'tower_mid-t1-chaff',
          targetId: 'p1',
          amount: expectedDamage,
          damageType: 'physical',
        },
      ])
      // The event amount is the HP actually lost, not the raw TOWER_ATTACK.
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
      const actions: TowerAction[] = [
        { towerZone: 'mid-t1-chaff', targetType: 'hero', targetId: 'p1', damage: TOWER_ATTACK },
      ]

      const result = applyTowerActions(state, actions)
      expect(result.events).toEqual([])
      expect(result.state.players['p1']!.hp).toBe(500)
    })

    it('emits no damage event for a creep shot — only hero damage is narrated', () => {
      const state = makeGameState({
        creeps: [makeCreep({ id: 'c1', team: 'audit', zone: 'mid-t1-chaff', hp: 400 })],
      })
      const actions: TowerAction[] = [
        { towerZone: 'mid-t1-chaff', targetType: 'creep', targetId: 'c1', damage: TOWER_ATTACK },
      ]

      expect(applyTowerActions(state, actions).events).toEqual([])
    })

    it('should kill heroes when HP drops to 0', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'audit', zone: 'mid-t1-chaff', hp: 50 }),
        },
      })

      const actions: TowerAction[] = [
        { towerZone: 'mid-t1-chaff', targetType: 'hero', targetId: 'p1', damage: TOWER_ATTACK },
      ]

      const result = applyTowerActions(state, actions).state
      expect(result.players['p1']!.hp).toBe(0)
      expect(result.players['p1']!.alive).toBe(false)
    })

    it('should apply damage to creeps', () => {
      const state = makeGameState({
        creeps: [makeCreep({ id: 'c1', team: 'audit', zone: 'mid-t1-chaff', hp: 400 })],
      })

      const actions: TowerAction[] = [
        { towerZone: 'mid-t1-chaff', targetType: 'creep', targetId: 'c1', damage: TOWER_ATTACK },
      ]

      const result = applyTowerActions(state, actions).state
      const c1 = result.creeps.find((c) => c.id === 'c1')
      expect(c1!.hp).toBe(400 - TOWER_ATTACK)
    })

    it('should remove dead creeps after damage', () => {
      const state = makeGameState({
        creeps: [makeCreep({ id: 'c1', team: 'audit', zone: 'mid-t1-chaff', hp: 50 })],
      })

      const actions: TowerAction[] = [
        { towerZone: 'mid-t1-chaff', targetType: 'creep', targetId: 'c1', damage: TOWER_ATTACK },
      ]

      const result = applyTowerActions(state, actions).state
      expect(result.creeps.find((c) => c.id === 'c1')).toBeUndefined()
    })

    it('should clamp hero HP to 0 (not negative)', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'audit', zone: 'mid-t1-chaff', hp: 1 }),
        },
      })

      const actions: TowerAction[] = [
        { towerZone: 'mid-t1-chaff', targetType: 'hero', targetId: 'p1', damage: TOWER_ATTACK },
      ]

      const result = applyTowerActions(state, actions).state
      expect(result.players['p1']!.hp).toBe(0)
    })

    it('should handle multiple tower actions', () => {
      const state = makeGameState({
        creeps: [
          makeCreep({ id: 'c1', team: 'audit', zone: 'mid-t1-chaff', hp: 400 }),
          makeCreep({ id: 'c2', team: 'chaff', zone: 'mid-t1-audit', hp: 400 }),
        ],
      })

      const actions: TowerAction[] = [
        { towerZone: 'mid-t1-chaff', targetType: 'creep', targetId: 'c1', damage: TOWER_ATTACK },
        { towerZone: 'mid-t1-audit', targetType: 'creep', targetId: 'c2', damage: TOWER_ATTACK },
      ]

      const result = applyTowerActions(state, actions).state
      const c1 = result.creeps.find((c) => c.id === 'c1')
      const c2 = result.creeps.find((c) => c.id === 'c2')
      expect(c1!.hp).toBe(400 - TOWER_ATTACK)
      expect(c2!.hp).toBe(400 - TOWER_ATTACK)
    })

    it('should not damage already dead heroes', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'audit', zone: 'mid-t1-chaff', hp: 0, alive: false }),
        },
      })

      const actions: TowerAction[] = [
        { towerZone: 'mid-t1-chaff', targetType: 'hero', targetId: 'p1', damage: TOWER_ATTACK },
      ]

      const result = applyTowerActions(state, actions).state
      expect(result.players['p1']!.hp).toBe(0)
    })
  })
})
