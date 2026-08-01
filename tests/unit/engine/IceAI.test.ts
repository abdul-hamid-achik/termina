import { describe, it, expect } from 'vitest'
import { runIceAI, applyIceActions, type IceAction } from '~~/server/game/engine/IceAI'
import { initializeTerminals } from '~~/server/game/engine/TerminalSystem'
import type { GameState, PlayerState, WaveUnitState } from '~~/shared/types/game'
import type { GameEngineEvent } from '~~/server/game/protocol/events'
import { initializeZoneStates, initializeIce } from '~~/server/game/map/zones'
import { ICE_ATTACK } from '~~/shared/constants/balance'
import { calculateKineticDamage } from '~~/server/game/engine/DamageCalculator'
import { getEffectivePlate } from '~~/server/game/engine/EffectiveStats'

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'Player1',
    team: 'chaff',
    heroId: 'echo',
    zone: 'coldstore-t1-chaff',
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

function makeWave(overrides: Partial<WaveUnitState> = {}): WaveUnitState {
  return {
    id: 'c1',
    team: 'chaff',
    zone: 'coldstore-t1-chaff',
    integ: 400,
    type: 'line',
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
    terminals: initializeTerminals(),
    events: [],
    ...overrides,
  }
}

describe('IceAI', () => {
  describe('runIceAI', () => {
    it('should not generate actions for dead ice', () => {
      const ice = initializeIce().map((t) => ({ ...t, integ: 0, alive: false }))
      const state = makeGameState({
        ice,
        players: {
          p1: makePlayer({ id: 'p1', team: 'audit', zone: 'coldstore-t1-chaff' }),
        },
      })

      const actions = runIceAI(state)
      expect(actions).toHaveLength(0)
    })

    it('should not generate actions when no enemies in ice zone', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'chaff', zone: 'coldstore-t1-chaff' }),
        },
      })

      const actions = runIceAI(state)
      // Chaff player in chaff ice zone — not an enemy
      expect(actions).toHaveLength(0)
    })

    it('should target enemy heroes in ice zone', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'audit', zone: 'coldstore-t1-chaff' }),
        },
      })

      const actions = runIceAI(state)
      const midT1Action = actions.find((a) => a.iceZone === 'coldstore-t1-chaff')
      expect(midT1Action).toBeDefined()
      expect(midT1Action!.targetType).toBe('hero')
      expect(midT1Action!.targetId).toBe('p1')
      expect(midT1Action!.damage).toBe(ICE_ATTACK)
    })

    it('should target enemy waves in ice zone', () => {
      const state = makeGameState({
        waves: [makeWave({ id: 'c1', team: 'audit', zone: 'coldstore-t1-chaff' })],
      })

      const actions = runIceAI(state)
      const midT1Action = actions.find((a) => a.iceZone === 'coldstore-t1-chaff')
      expect(midT1Action).toBeDefined()
      expect(midT1Action!.targetType).toBe('wave')
      expect(midT1Action!.targetId).toBe('c1')
    })

    it('should prioritize waves over a passive hero (MOBA aggro convention)', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'audit', zone: 'coldstore-t1-chaff' }),
        },
        waves: [makeWave({ id: 'c1', team: 'audit', zone: 'coldstore-t1-chaff' })],
      })

      const actions = runIceAI(state)
      const midT1Action = actions.find((a) => a.iceZone === 'coldstore-t1-chaff')
      expect(midT1Action!.targetType).toBe('wave')
      expect(midT1Action!.targetId).toBe('c1')
    })

    it('should prioritize a hero attacking an allied hero above waves', () => {
      const state = makeGameState({
        players: {
          ally: makePlayer({ id: 'ally', team: 'chaff', zone: 'coldstore-t1-chaff' }),
          attacker: makePlayer({
            id: 'attacker',
            team: 'audit',
            zone: 'coldstore-t1-chaff',
            name: 'Attacker',
          }),
        },
        waves: [makeWave({ id: 'c1', team: 'audit', zone: 'coldstore-t1-chaff' })],
      })

      const heroAttackers = new Map<string, string>()
      heroAttackers.set('attacker', 'ally')

      const actions = runIceAI(state, heroAttackers)
      const midT1Action = actions.find((a) => a.iceZone === 'coldstore-t1-chaff')
      expect(midT1Action!.targetType).toBe('hero')
      expect(midT1Action!.targetId).toBe('attacker')
    })

    it('should prioritize a hero attacking the ice itself above waves', () => {
      const state = makeGameState({
        players: {
          attacker: makePlayer({
            id: 'attacker',
            team: 'audit',
            zone: 'coldstore-t1-chaff',
            name: 'Attacker',
          }),
        },
        waves: [makeWave({ id: 'c1', team: 'audit', zone: 'coldstore-t1-chaff' })],
      })

      // Hero→ice damage events carry targetId `ice_${zone}`
      const priorEvents: GameEngineEvent[] = [
        {
          _tag: 'damage',
          cycle: 1,
          sourceId: 'attacker',
          targetId: 'ice_coldstore-t1-chaff',
          amount: 60,
          damageType: 'kinetic',
        },
      ]

      const actions = runIceAI(state, undefined, priorEvents)
      const midT1Action = actions.find((a) => a.iceZone === 'coldstore-t1-chaff')
      expect(midT1Action!.targetType).toBe('hero')
      expect(midT1Action!.targetId).toBe('attacker')
    })

    it('should not aggro a hero who attacked a different ice', () => {
      const state = makeGameState({
        players: {
          attacker: makePlayer({
            id: 'attacker',
            team: 'audit',
            zone: 'coldstore-t1-chaff',
            name: 'Attacker',
          }),
        },
        waves: [makeWave({ id: 'c1', team: 'audit', zone: 'coldstore-t1-chaff' })],
      })

      const priorEvents: GameEngineEvent[] = [
        {
          _tag: 'damage',
          cycle: 1,
          sourceId: 'attacker',
          targetId: 'ice_seawall-t1-chaff',
          amount: 60,
          damageType: 'kinetic',
        },
      ]

      const actions = runIceAI(state, undefined, priorEvents)
      const midT1Action = actions.find((a) => a.iceZone === 'coldstore-t1-chaff')
      // Different ice attacked — waves still tank this one
      expect(midT1Action!.targetType).toBe('wave')
    })

    it('should prioritize hero attacking allied hero in ice zone (priority 1)', () => {
      const state = makeGameState({
        players: {
          ally: makePlayer({ id: 'ally', team: 'chaff', zone: 'coldstore-t1-chaff' }),
          attacker: makePlayer({
            id: 'attacker',
            team: 'audit',
            zone: 'coldstore-t1-chaff',
            name: 'Attacker',
          }),
          bystander: makePlayer({
            id: 'bystander',
            team: 'audit',
            zone: 'coldstore-t1-chaff',
            name: 'Bystander',
          }),
        },
      })

      // attacker is attacking ally
      const heroAttackers = new Map<string, string>()
      heroAttackers.set('attacker', 'ally')

      const actions = runIceAI(state, heroAttackers)
      const midT1Action = actions.find((a) => a.iceZone === 'coldstore-t1-chaff')
      expect(midT1Action!.targetType).toBe('hero')
      expect(midT1Action!.targetId).toBe('attacker')
    })

    it('should not target dead enemy heroes', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            team: 'audit',
            zone: 'coldstore-t1-chaff',
            alive: false,
            integ: 0,
          }),
        },
      })

      const actions = runIceAI(state)
      const midT1Action = actions.find((a) => a.iceZone === 'coldstore-t1-chaff')
      expect(midT1Action).toBeUndefined()
    })

    it('should not target dead waves', () => {
      const state = makeGameState({
        waves: [makeWave({ id: 'c1', team: 'audit', zone: 'coldstore-t1-chaff', integ: 0 })],
      })

      const actions = runIceAI(state)
      const midT1Action = actions.find((a) => a.iceZone === 'coldstore-t1-chaff')
      expect(midT1Action).toBeUndefined()
    })

    it('should generate actions for multiple ice simultaneously', () => {
      const state = makeGameState({
        waves: [
          makeWave({ id: 'c1', team: 'audit', zone: 'coldstore-t1-chaff' }),
          makeWave({ id: 'c2', team: 'audit', zone: 'seawall-t1-chaff' }),
          makeWave({ id: 'c3', team: 'chaff', zone: 'shallows-t1-audit' }),
        ],
      })

      const actions = runIceAI(state)
      // Mid T1 rad should target c1, Top T1 rad should target c2, Bot T1 audit should target c3
      expect(actions.find((a) => a.iceZone === 'coldstore-t1-chaff')!.targetId).toBe('c1')
      expect(actions.find((a) => a.iceZone === 'seawall-t1-chaff')!.targetId).toBe('c2')
      expect(actions.find((a) => a.iceZone === 'shallows-t1-audit')!.targetId).toBe('c3')
    })

    it('should fall back to hero when hero attacker targets non-ally', () => {
      const state = makeGameState({
        players: {
          attacker: makePlayer({
            id: 'attacker',
            team: 'audit',
            zone: 'coldstore-t1-chaff',
            name: 'Attacker',
          }),
        },
      })

      // Attacker is attacking a non-present player (not in this zone)
      const heroAttackers = new Map<string, string>()
      heroAttackers.set('attacker', 'someone-else')

      const actions = runIceAI(state, heroAttackers)
      const midT1Action = actions.find((a) => a.iceZone === 'coldstore-t1-chaff')
      // Should still target the enemy hero (priority 2 fallback)
      expect(midT1Action!.targetType).toBe('hero')
      expect(midT1Action!.targetId).toBe('attacker')
    })
  })

  describe('applyIceActions', () => {
    it('should apply damage to heroes with plate reduction', () => {
      const player = makePlayer({
        id: 'p1',
        team: 'audit',
        zone: 'coldstore-t1-chaff',
        integ: 500,
        plate: 3,
      })
      const state = makeGameState({
        players: { p1: player },
      })

      const actions: IceAction[] = [
        { iceZone: 'coldstore-t1-chaff', targetType: 'hero', targetId: 'p1', damage: ICE_ATTACK },
      ]

      const result = applyIceActions(state, actions).state
      // resolveKineticHit routes through getEffectivePlate (items + talents
      // + buffs), not the raw player.plate field.
      const expectedDamage = calculateKineticDamage(ICE_ATTACK, getEffectivePlate(player))
      expect(result.players['p1']!.integ).toBe(500 - expectedDamage)
      expect(result.players['p1']!.alive).toBe(true)
    })

    it('does no damage to a physically-immune hero (Ghost/Ethereal/invulnerable)', () => {
      for (const id of ['ghost_form', 'ethereal', 'invulnerable']) {
        const state = makeGameState({
          players: {
            p1: makePlayer({
              id: 'p1',
              team: 'audit',
              zone: 'coldstore-t1-chaff',
              integ: 500,
              buffs: [{ id, stacks: 1, cyclesRemaining: 2, source: 'x' }],
            }),
          },
        })
        const actions: IceAction[] = [
          { iceZone: 'coldstore-t1-chaff', targetType: 'hero', targetId: 'p1', damage: ICE_ATTACK },
        ]
        const result = applyIceActions(state, actions).state
        expect(result.players['p1']!.integ).toBe(500) // unscathed
      }
    })

    it('emits a damage event naming the ice that fired', () => {
      const player = makePlayer({ id: 'p1', team: 'audit', zone: 'coldstore-t1-chaff', integ: 500 })
      const state = makeGameState({ cycle: 7, players: { p1: player } })

      const actions: IceAction[] = [
        { iceZone: 'coldstore-t1-chaff', targetType: 'hero', targetId: 'p1', damage: ICE_ATTACK },
      ]

      const { state: after, events } = applyIceActions(state, actions)
      const expectedDamage = calculateKineticDamage(ICE_ATTACK, getEffectivePlate(player))
      expect(events).toEqual([
        {
          _tag: 'damage',
          cycle: 7,
          // Same id convention selectIceTarget reads for hero→ice damage.
          sourceId: 'ice_coldstore-t1-chaff',
          targetId: 'p1',
          amount: expectedDamage,
          damageType: 'kinetic',
        },
      ])
      // The event amount is the INTEG actually lost, not the raw ICE_ATTACK.
      expect(500 - after.players['p1']!.integ).toBe(expectedDamage)
    })

    it('emits no damage event when a shield absorbs the whole shot', () => {
      // Not immune and not dodged — the hero simply loses no INTEG. Emitting here
      // would paint a "0" damage float, which reads as a bug.
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            team: 'audit',
            zone: 'coldstore-t1-chaff',
            integ: 500,
            buffs: [{ id: 'shield', stacks: 999, cyclesRemaining: 5, source: 'x' }],
          }),
        },
      })
      const actions: IceAction[] = [
        { iceZone: 'coldstore-t1-chaff', targetType: 'hero', targetId: 'p1', damage: ICE_ATTACK },
      ]

      const result = applyIceActions(state, actions)
      expect(result.events).toEqual([])
      expect(result.state.players['p1']!.integ).toBe(500)
    })

    it('emits no damage event for a wave shot — only hero damage is narrated', () => {
      const state = makeGameState({
        waves: [makeWave({ id: 'c1', team: 'audit', zone: 'coldstore-t1-chaff', integ: 400 })],
      })
      const actions: IceAction[] = [
        { iceZone: 'coldstore-t1-chaff', targetType: 'wave', targetId: 'c1', damage: ICE_ATTACK },
      ]

      expect(applyIceActions(state, actions).events).toEqual([])
    })

    it('should kill heroes when INTEG drops to 0', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'audit', zone: 'coldstore-t1-chaff', integ: 50 }),
        },
      })

      const actions: IceAction[] = [
        { iceZone: 'coldstore-t1-chaff', targetType: 'hero', targetId: 'p1', damage: ICE_ATTACK },
      ]

      const result = applyIceActions(state, actions).state
      expect(result.players['p1']!.integ).toBe(0)
      expect(result.players['p1']!.alive).toBe(false)
    })

    it('should apply damage to waves', () => {
      const state = makeGameState({
        waves: [makeWave({ id: 'c1', team: 'audit', zone: 'coldstore-t1-chaff', integ: 400 })],
      })

      const actions: IceAction[] = [
        { iceZone: 'coldstore-t1-chaff', targetType: 'wave', targetId: 'c1', damage: ICE_ATTACK },
      ]

      const result = applyIceActions(state, actions).state
      const c1 = result.waves.find((c) => c.id === 'c1')
      expect(c1!.integ).toBe(400 - ICE_ATTACK)
    })

    it('should remove dead waves after damage', () => {
      const state = makeGameState({
        waves: [makeWave({ id: 'c1', team: 'audit', zone: 'coldstore-t1-chaff', integ: 50 })],
      })

      const actions: IceAction[] = [
        { iceZone: 'coldstore-t1-chaff', targetType: 'wave', targetId: 'c1', damage: ICE_ATTACK },
      ]

      const result = applyIceActions(state, actions).state
      expect(result.waves.find((c) => c.id === 'c1')).toBeUndefined()
    })

    it('should clamp hero INTEG to 0 (not negative)', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'audit', zone: 'coldstore-t1-chaff', integ: 1 }),
        },
      })

      const actions: IceAction[] = [
        { iceZone: 'coldstore-t1-chaff', targetType: 'hero', targetId: 'p1', damage: ICE_ATTACK },
      ]

      const result = applyIceActions(state, actions).state
      expect(result.players['p1']!.integ).toBe(0)
    })

    it('should handle multiple ice actions', () => {
      const state = makeGameState({
        waves: [
          makeWave({ id: 'c1', team: 'audit', zone: 'coldstore-t1-chaff', integ: 400 }),
          makeWave({ id: 'c2', team: 'chaff', zone: 'coldstore-t1-audit', integ: 400 }),
        ],
      })

      const actions: IceAction[] = [
        { iceZone: 'coldstore-t1-chaff', targetType: 'wave', targetId: 'c1', damage: ICE_ATTACK },
        { iceZone: 'coldstore-t1-audit', targetType: 'wave', targetId: 'c2', damage: ICE_ATTACK },
      ]

      const result = applyIceActions(state, actions).state
      const c1 = result.waves.find((c) => c.id === 'c1')
      const c2 = result.waves.find((c) => c.id === 'c2')
      expect(c1!.integ).toBe(400 - ICE_ATTACK)
      expect(c2!.integ).toBe(400 - ICE_ATTACK)
    })

    it('should not damage already dead heroes', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            team: 'audit',
            zone: 'coldstore-t1-chaff',
            integ: 0,
            alive: false,
          }),
        },
      })

      const actions: IceAction[] = [
        { iceZone: 'coldstore-t1-chaff', targetType: 'hero', targetId: 'p1', damage: ICE_ATTACK },
      ]

      const result = applyIceActions(state, actions).state
      expect(result.players['p1']!.integ).toBe(0)
    })
  })
})
