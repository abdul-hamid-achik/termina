import { describe, it, expect } from 'vitest'
import {
  runWaveAI,
  applyWaveActions,
  enforceWaveZoneCap,
  type WaveAction,
} from '~~/server/game/engine/WaveAI'
import { initializeAncients } from '~~/server/game/engine/AncientSystem'
import type { GameState, PlayerState, WaveUnitState } from '~~/shared/types/game'
import { initializeZoneStates, initializeIce } from '~~/server/game/map/zones'
import {
  LINE_UNIT_ATTACK,
  SWEEP_UNIT_ATTACK,
  BREACH_UNIT_ATTACK,
  WAVE_BASE_IDLE_DESPAWN_TICKS,
  WAVE_ESCALATION_INTERVAL_TICKS,
  WAVE_XP_SHARED,
  MAX_WAVE_UNITS_PER_ZONE_PER_TEAM,
  waveUnitAttack,
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

function makeWave(overrides: Partial<WaveUnitState> = {}): WaveUnitState {
  return {
    id: 'c1',
    team: 'chaff',
    zone: 'mid-t1-chaff',
    hp: 400,
    type: 'line',
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
    waves: [],
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

describe('WaveAI', () => {
  describe('runWaveAI', () => {
    it('should move waves forward along lane when no enemies present', () => {
      const state = makeGameState({
        waves: [makeWave({ id: 'c1', team: 'chaff', zone: 'mid-t3-chaff' })],
      })

      const actions = runWaveAI(state)
      expect(actions).toHaveLength(1)
      expect(actions[0]!.waveId).toBe('c1')
      expect(actions[0]!.action).toBe('move')
      expect(actions[0]!.targetZone).toBe('mid-t2-chaff')
    })

    it('should move audit waves forward along their lane', () => {
      const state = makeGameState({
        waves: [makeWave({ id: 'c1', team: 'audit', zone: 'mid-t3-audit' })],
      })

      const actions = runWaveAI(state)
      expect(actions).toHaveLength(1)
      expect(actions[0]!.action).toBe('move')
      expect(actions[0]!.targetZone).toBe('mid-t2-audit')
    })

    it('should attack enemy waves in the same zone (priority 1)', () => {
      const state = makeGameState({
        waves: [
          makeWave({ id: 'c1', team: 'chaff', zone: 'mid-river' }),
          makeWave({ id: 'c2', team: 'audit', zone: 'mid-river' }),
        ],
      })

      const actions = runWaveAI(state)
      // Both waves should attack each other
      const c1Action = actions.find((a) => a.waveId === 'c1')
      const c2Action = actions.find((a) => a.waveId === 'c2')

      expect(c1Action!.action).toBe('attack_wave')
      expect(c1Action!.targetId).toBe('c2')
      expect(c2Action!.action).toBe('attack_wave')
      expect(c2Action!.targetId).toBe('c1')
    })

    it('should use correct damage for line waves', () => {
      const state = makeGameState({
        waves: [
          makeWave({ id: 'c1', team: 'chaff', zone: 'mid-river', type: 'line' }),
          makeWave({ id: 'c2', team: 'audit', zone: 'mid-river' }),
        ],
      })

      const actions = runWaveAI(state)
      const c1Action = actions.find((a) => a.waveId === 'c1')
      expect(c1Action!.damage).toBe(LINE_UNIT_ATTACK)
    })

    it('should use correct damage for sweep waves', () => {
      const state = makeGameState({
        waves: [
          makeWave({ id: 'c1', team: 'chaff', zone: 'mid-river', type: 'sweep' }),
          makeWave({ id: 'c2', team: 'audit', zone: 'mid-river' }),
        ],
      })

      const actions = runWaveAI(state)
      const c1Action = actions.find((a) => a.waveId === 'c1')
      expect(c1Action!.damage).toBe(SWEEP_UNIT_ATTACK)
    })

    it('should use correct damage for breach waves', () => {
      const state = makeGameState({
        waves: [
          makeWave({ id: 'c1', team: 'chaff', zone: 'mid-river', type: 'breach' }),
          makeWave({ id: 'c2', team: 'audit', zone: 'mid-river' }),
        ],
      })

      const actions = runWaveAI(state)
      const c1Action = actions.find((a) => a.waveId === 'c1')
      expect(c1Action!.damage).toBe(BREACH_UNIT_ATTACK)
    })

    it('escalates wave damage with the game tick', () => {
      const lateTick = WAVE_ESCALATION_INTERVAL_TICKS * 2
      const state = makeGameState({
        tick: lateTick,
        waves: [
          makeWave({ id: 'c1', team: 'chaff', zone: 'mid-river', type: 'line' }),
          makeWave({ id: 'c2', team: 'audit', zone: 'mid-river' }),
        ],
      })

      const damage = runWaveAI(state).find((a) => a.waveId === 'c1')!.damage
      expect(damage).toBe(waveUnitAttack('line', lateTick))
      expect(damage).toBeGreaterThan(LINE_UNIT_ATTACK)
    })

    it('should attack enemy heroes when no enemy waves in zone (priority 2)', () => {
      const state = makeGameState({
        waves: [makeWave({ id: 'c1', team: 'chaff', zone: 'mid-river' })],
        players: {
          p1: makePlayer({ id: 'p1', team: 'audit', zone: 'mid-river' }),
        },
      })

      const actions = runWaveAI(state)
      expect(actions).toHaveLength(1)
      expect(actions[0]!.action).toBe('attack_hero')
      expect(actions[0]!.targetId).toBe('p1')
    })

    it('should not attack dead heroes', () => {
      const state = makeGameState({
        waves: [makeWave({ id: 'c1', team: 'chaff', zone: 'mid-river' })],
        players: {
          p1: makePlayer({ id: 'p1', team: 'audit', zone: 'mid-river', alive: false, hp: 0 }),
        },
      })

      const actions = runWaveAI(state)
      // No enemy heroes alive, so should move
      expect(actions[0]!.action).not.toBe('attack_hero')
    })

    it('should attack enemy ice in zone when no enemy waves or heroes (priority 3)', () => {
      // Place a chaff wave in a audit ice zone
      const state = makeGameState({
        waves: [makeWave({ id: 'c1', team: 'chaff', zone: 'mid-t1-audit' })],
      })

      const actions = runWaveAI(state)
      expect(actions).toHaveLength(1)
      expect(actions[0]!.action).toBe('attack_ice')
      expect(actions[0]!.targetZone).toBe('mid-t1-audit')
    })

    it('should prefer enemy waves over enemy heroes', () => {
      const state = makeGameState({
        waves: [
          makeWave({ id: 'c1', team: 'chaff', zone: 'mid-river' }),
          makeWave({ id: 'c2', team: 'audit', zone: 'mid-river' }),
        ],
        players: {
          p1: makePlayer({ id: 'p1', team: 'audit', zone: 'mid-river' }),
        },
      })

      const actions = runWaveAI(state)
      const c1Action = actions.find((a) => a.waveId === 'c1')
      expect(c1Action!.action).toBe('attack_wave')
      expect(c1Action!.targetId).toBe('c2')
    })

    it('should prefer enemy waves over enemy ice', () => {
      // Chaff wave in audit ice zone with enemy wave
      const state = makeGameState({
        waves: [
          makeWave({ id: 'c1', team: 'chaff', zone: 'mid-t1-audit' }),
          makeWave({ id: 'c2', team: 'audit', zone: 'mid-t1-audit' }),
        ],
      })

      const actions = runWaveAI(state)
      const c1Action = actions.find((a) => a.waveId === 'c1')
      expect(c1Action!.action).toBe('attack_wave')
    })

    it('should skip dead waves', () => {
      const state = makeGameState({
        waves: [makeWave({ id: 'c1', team: 'chaff', zone: 'mid-river', hp: 0 })],
      })

      const actions = runWaveAI(state)
      expect(actions).toHaveLength(0)
    })

    it('should idle (wait_in_base) for waves stuck in base zones', () => {
      const state = makeGameState({
        waves: [makeWave({ id: 'c1', team: 'chaff', zone: 'chaff-base' })],
      })

      const actions = runWaveAI(state)
      // Wave is at the end of route in a base — it idles toward despawn
      expect(actions).toHaveLength(1)
      expect(actions[0]!.action).toBe('wait_in_base')
    })

    it('should handle waves on all three lanes', () => {
      const state = makeGameState({
        waves: [
          makeWave({ id: 'c1', team: 'chaff', zone: 'top-t3-chaff' }),
          makeWave({ id: 'c2', team: 'chaff', zone: 'mid-t3-chaff' }),
          makeWave({ id: 'c3', team: 'chaff', zone: 'bot-t3-chaff' }),
        ],
      })

      const actions = runWaveAI(state)
      expect(actions).toHaveLength(3)
      expect(actions[0]!.targetZone).toBe('top-t2-chaff')
      expect(actions[1]!.targetZone).toBe('mid-t2-chaff')
      expect(actions[2]!.targetZone).toBe('bot-t2-chaff')
    })

    it('should not attack dead enemy waves', () => {
      const state = makeGameState({
        waves: [
          makeWave({ id: 'c1', team: 'chaff', zone: 'mid-river' }),
          makeWave({ id: 'c2', team: 'audit', zone: 'mid-river', hp: 0 }),
        ],
      })

      const actions = runWaveAI(state)
      const c1Action = actions.find((a) => a.waveId === 'c1')
      // Dead enemy wave shouldn't be targeted; wave should move
      expect(c1Action!.action).toBe('move')
    })

    it('should not attack dead ice', () => {
      const ice = initializeIce().map((t) =>
        t.zone === 'mid-t1-audit' ? { ...t, hp: 0, alive: false } : t,
      )

      const state = makeGameState({
        waves: [makeWave({ id: 'c1', team: 'chaff', zone: 'mid-t1-audit' })],
        ice,
      })

      const actions = runWaveAI(state)
      const c1Action = actions.find((a) => a.waveId === 'c1')
      // Ice is dead, wave should move forward
      expect(c1Action!.action).toBe('move')
    })
  })

  describe('applyWaveActions', () => {
    it('should move waves to target zones', () => {
      const state = makeGameState({
        waves: [makeWave({ id: 'c1', zone: 'mid-t3-chaff' })],
      })

      const actions: WaveAction[] = [{ waveId: 'c1', action: 'move', targetZone: 'mid-t2-chaff' }]

      const result = applyWaveActions(state, actions).state
      expect(result.waves[0]!.zone).toBe('mid-t2-chaff')
    })

    it('should apply damage to enemy waves', () => {
      const state = makeGameState({
        waves: [
          makeWave({ id: 'c1', team: 'chaff', zone: 'mid-river', hp: 400 }),
          makeWave({ id: 'c2', team: 'audit', zone: 'mid-river', hp: 400 }),
        ],
      })

      const actions: WaveAction[] = [
        { waveId: 'c1', action: 'attack_wave', targetId: 'c2', damage: LINE_UNIT_ATTACK },
      ]

      const result = applyWaveActions(state, actions).state
      const c2 = result.waves.find((c) => c.id === 'c2')
      expect(c2!.hp).toBe(400 - LINE_UNIT_ATTACK)
    })

    it('shares XP with living lane-mates of the killing team when a wave dies', () => {
      const laner = makePlayer({ id: 'p1', team: 'chaff', zone: 'mid-river', xp: 0 })
      const state = makeGameState({
        waves: [
          makeWave({ id: 'c1', team: 'chaff', zone: 'mid-river', hp: 400 }),
          makeWave({ id: 'c2', team: 'audit', zone: 'mid-river', hp: 10 }),
        ],
        players: { p1: laner },
      })

      const actions: WaveAction[] = [
        { waveId: 'c1', action: 'attack_wave', targetId: 'c2', damage: LINE_UNIT_ATTACK },
      ]

      const result = applyWaveActions(state, actions).state
      expect(result.players.p1!.xp).toBe(WAVE_XP_SHARED)
    })

    it('pays no shared XP while the wave survives the hit', () => {
      const laner = makePlayer({ id: 'p1', team: 'chaff', zone: 'mid-river', xp: 0 })
      const state = makeGameState({
        waves: [
          makeWave({ id: 'c1', team: 'chaff', zone: 'mid-river', hp: 400 }),
          makeWave({ id: 'c2', team: 'audit', zone: 'mid-river', hp: 400 }),
        ],
        players: { p1: laner },
      })

      const actions: WaveAction[] = [
        { waveId: 'c1', action: 'attack_wave', targetId: 'c2', damage: LINE_UNIT_ATTACK },
      ]

      const result = applyWaveActions(state, actions).state
      expect(result.players.p1!.xp).toBe(0)
    })

    it('does not pay shared XP to the dying wave’s own team, the dead, or another zone', () => {
      const owner = makePlayer({ id: 'p1', team: 'audit', zone: 'mid-river', xp: 0 })
      const dead = makePlayer({ id: 'p2', team: 'chaff', zone: 'mid-river', xp: 0, alive: false })
      const elsewhere = makePlayer({ id: 'p3', team: 'chaff', zone: 'mid-t1-chaff', xp: 0 })
      const state = makeGameState({
        waves: [
          makeWave({ id: 'c1', team: 'chaff', zone: 'mid-river', hp: 400 }),
          makeWave({ id: 'c2', team: 'audit', zone: 'mid-river', hp: 10 }),
        ],
        players: { p1: owner, p2: dead, p3: elsewhere },
      })

      const actions: WaveAction[] = [
        { waveId: 'c1', action: 'attack_wave', targetId: 'c2', damage: LINE_UNIT_ATTACK },
      ]

      const result = applyWaveActions(state, actions).state
      expect(result.players.p1!.xp).toBe(0)
      expect(result.players.p2!.xp).toBe(0)
      expect(result.players.p3!.xp).toBe(0)
    })

    it('should remove dead waves after applying actions', () => {
      const state = makeGameState({
        waves: [
          makeWave({ id: 'c1', team: 'chaff', zone: 'mid-river', hp: 400 }),
          makeWave({ id: 'c2', team: 'audit', zone: 'mid-river', hp: 10 }),
        ],
      })

      const actions: WaveAction[] = [
        { waveId: 'c1', action: 'attack_wave', targetId: 'c2', damage: LINE_UNIT_ATTACK },
      ]

      const result = applyWaveActions(state, actions).state
      expect(result.waves.find((c) => c.id === 'c2')).toBeUndefined()
    })

    it('should apply damage to heroes with defense reduction', () => {
      const player = makePlayer({ id: 'p1', team: 'audit', zone: 'mid-river', hp: 500, defense: 3 })
      const state = makeGameState({
        waves: [makeWave({ id: 'c1', team: 'chaff', zone: 'mid-river' })],
        players: { p1: player },
      })

      const actions: WaveAction[] = [
        { waveId: 'c1', action: 'attack_hero', targetId: 'p1', damage: LINE_UNIT_ATTACK },
      ]

      const result = applyWaveActions(state, actions).state
      // resolvePhysicalHit routes through getEffectiveDefense (items + talents
      // + buffs), not the raw player.defense field.
      const expectedDamage = calculatePhysicalDamage(LINE_UNIT_ATTACK, getEffectiveDefense(player))
      expect(result.players['p1']!.hp).toBe(500 - expectedDamage)
      expect(result.players['p1']!.alive).toBe(true)
    })

    it('should kill heroes when HP reaches 0', () => {
      const state = makeGameState({
        waves: [makeWave({ id: 'c1', team: 'chaff', zone: 'mid-river' })],
        players: {
          // hp:1 means any positive damage kills; defense override is ignored by
          // getEffectiveDefense (echo base defense applies), but the lethal blow
          // lands regardless.
          p1: makePlayer({ id: 'p1', team: 'audit', zone: 'mid-river', hp: 1 }),
        },
      })

      const actions: WaveAction[] = [
        { waveId: 'c1', action: 'attack_hero', targetId: 'p1', damage: LINE_UNIT_ATTACK },
      ]

      const result = applyWaveActions(state, actions).state
      expect(result.players['p1']!.hp).toBe(0)
      expect(result.players['p1']!.alive).toBe(false)
    })

    it('emits a damage event naming the wave that hit', () => {
      const player = makePlayer({ id: 'p1', team: 'audit', zone: 'mid-river', hp: 500 })
      const state = makeGameState({
        tick: 12,
        waves: [makeWave({ id: 'c1', team: 'chaff', zone: 'mid-river' })],
        players: { p1: player },
      })

      const actions: WaveAction[] = [
        { waveId: 'c1', action: 'attack_hero', targetId: 'p1', damage: LINE_UNIT_ATTACK },
      ]

      const { state: after, events } = applyWaveActions(state, actions)
      const expectedDamage = calculatePhysicalDamage(LINE_UNIT_ATTACK, getEffectiveDefense(player))
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
        waves: [makeWave({ id: 'c1', team: 'chaff', zone: 'mid-river' })],
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

      const result = applyWaveActions(state, [
        { waveId: 'c1', action: 'attack_hero', targetId: 'p1', damage: LINE_UNIT_ATTACK },
      ])

      expect(result.events).toEqual([])
      expect(result.state.players['p1']!.hp).toBe(500)
    })

    it('should apply damage to ice', () => {
      const state = makeGameState({
        waves: [makeWave({ id: 'c1', team: 'chaff', zone: 'mid-t1-audit' })],
      })

      const ice = state.ice.find((t) => t.zone === 'mid-t1-audit')!
      const initialHp = ice.hp

      const actions: WaveAction[] = [
        {
          waveId: 'c1',
          action: 'attack_ice',
          targetZone: 'mid-t1-audit',
          damage: LINE_UNIT_ATTACK,
        },
      ]

      const result = applyWaveActions(state, actions).state
      const updatedIce = result.ice.find((t) => t.zone === 'mid-t1-audit')!
      expect(updatedIce.hp).toBe(initialHp - LINE_UNIT_ATTACK)
    })

    it('does NOT damage an invulnerable (glyphed) ice — the push bounces off', () => {
      // Harden must blunt the whole push, not just heroes. Hero attacks already
      // bounce off an invulnerable ice; wave damage must too.
      const ice = initializeIce().map((t) =>
        t.zone === 'mid-t1-audit' ? { ...t, invulnerable: true } : t,
      )
      const state = makeGameState({
        waves: [makeWave({ id: 'c1', team: 'chaff', zone: 'mid-t1-audit' })],
        ice,
      })
      const initialHp = state.ice.find((t) => t.zone === 'mid-t1-audit')!.hp

      const actions: WaveAction[] = [
        {
          waveId: 'c1',
          action: 'attack_ice',
          targetZone: 'mid-t1-audit',
          damage: LINE_UNIT_ATTACK,
        },
      ]

      const result = applyWaveActions(state, actions).state
      const target = result.ice.find((t) => t.zone === 'mid-t1-audit')!
      expect(target.hp).toBe(initialHp) // unchanged — harden protects vs waves too
    })

    it('should destroy ice when HP reaches 0', () => {
      const ice = initializeIce().map((t) => (t.zone === 'mid-t1-audit' ? { ...t, hp: 10 } : t))

      const state = makeGameState({
        waves: [makeWave({ id: 'c1', team: 'chaff', zone: 'mid-t1-audit' })],
        ice,
      })

      const actions: WaveAction[] = [
        {
          waveId: 'c1',
          action: 'attack_ice',
          targetZone: 'mid-t1-audit',
          damage: LINE_UNIT_ATTACK,
        },
      ]

      const result = applyWaveActions(state, actions).state
      const updatedIce = result.ice.find((t) => t.zone === 'mid-t1-audit')!
      expect(updatedIce.hp).toBe(0)
      expect(updatedIce.alive).toBe(false)
    })

    it('should not apply actions from dead waves', () => {
      const state = makeGameState({
        waves: [
          makeWave({ id: 'c1', team: 'chaff', zone: 'mid-river', hp: 0 }),
          makeWave({ id: 'c2', team: 'audit', zone: 'mid-river', hp: 400 }),
        ],
      })

      const actions: WaveAction[] = [
        { waveId: 'c1', action: 'attack_wave', targetId: 'c2', damage: LINE_UNIT_ATTACK },
      ]

      const result = applyWaveActions(state, actions).state
      // c1 is dead, so c2 should not take damage (c1 also removed)
      const c2 = result.waves.find((c) => c.id === 'c2')
      expect(c2!.hp).toBe(400)
    })

    it('should clamp wave HP to 0 (not negative)', () => {
      const state = makeGameState({
        waves: [
          makeWave({ id: 'c1', team: 'chaff', zone: 'mid-river', hp: 400 }),
          makeWave({ id: 'c2', team: 'audit', zone: 'mid-river', hp: 5 }),
        ],
      })

      const actions: WaveAction[] = [
        { waveId: 'c1', action: 'attack_wave', targetId: 'c2', damage: BREACH_UNIT_ATTACK },
      ]

      const result = applyWaveActions(state, actions).state
      // c2 should be removed (hp <= 0)
      expect(result.waves.find((c) => c.id === 'c2')).toBeUndefined()
    })
  })

  describe('Ancient breach behavior', () => {
    it('attacks a vulnerable enemy Ancient from the enemy base', () => {
      const state = makeGameState({
        ancients: vulnerableAuditAncients(),
        waves: [makeWave({ id: 'c1', team: 'chaff', zone: 'audit-base' })],
      })

      const actions = runWaveAI(state)
      expect(actions).toHaveLength(1)
      expect(actions[0]!.action).toBe('attack_ancient')
      expect(actions[0]!.damage).toBe(LINE_UNIT_ATTACK)
    })

    it('prefers the vulnerable Ancient over enemy heroes in base', () => {
      const state = makeGameState({
        ancients: vulnerableAuditAncients(),
        waves: [makeWave({ id: 'c1', team: 'chaff', zone: 'audit-base' })],
        players: {
          p1: makePlayer({ id: 'p1', team: 'audit', zone: 'audit-base' }),
        },
      })

      const actions = runWaveAI(state)
      expect(actions[0]!.action).toBe('attack_ancient')
    })

    it('still fights enemy waves before the Ancient', () => {
      const state = makeGameState({
        ancients: vulnerableAuditAncients(),
        waves: [
          makeWave({ id: 'c1', team: 'chaff', zone: 'audit-base' }),
          makeWave({ id: 'c2', team: 'audit', zone: 'audit-base' }),
        ],
      })

      const actions = runWaveAI(state)
      const c1Action = actions.find((a) => a.waveId === 'c1')
      expect(c1Action!.action).toBe('attack_wave')
    })

    it('does not attack an invulnerable Ancient — attacks heroes instead', () => {
      const state = makeGameState({
        waves: [makeWave({ id: 'c1', team: 'chaff', zone: 'audit-base' })],
        players: {
          p1: makePlayer({ id: 'p1', team: 'audit', zone: 'audit-base' }),
        },
      })

      const actions = runWaveAI(state)
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
        waves: [makeWave({ id: 'c1', team: 'chaff', zone: 'audit-base' })],
      })

      const actions = runWaveAI(state)
      expect(actions[0]!.action).not.toBe('attack_ancient')
    })

    it('applies Ancient damage and emits events via applyWaveActions', () => {
      const state = makeGameState({
        ancients: vulnerableAuditAncients(),
        waves: [makeWave({ id: 'c1', team: 'chaff', zone: 'audit-base' })],
      })

      const actions: WaveAction[] = [
        { waveId: 'c1', action: 'attack_ancient', damage: LINE_UNIT_ATTACK },
      ]

      const result = applyWaveActions(state, actions)
      expect(result.state.ancients.audit.hp).toBe(
        result.state.ancients.audit.maxHp - LINE_UNIT_ATTACK,
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
        waves: [makeWave({ id: 'c1', team: 'chaff', zone: 'audit-base' })],
      })

      const actions: WaveAction[] = [
        { waveId: 'c1', action: 'attack_ancient', damage: LINE_UNIT_ATTACK },
      ]

      const result = applyWaveActions(state, actions)
      expect(result.state.ancients.audit.alive).toBe(false)
      expect(result.state.ancients.audit.hp).toBe(0)
      expect(result.events.some((e) => e._tag === 'ice_kill')).toBe(false)
      const killEvent = result.events.find((e) => e._tag === 'ancient_destroyed')
      expect(killEvent).toBeDefined()
      expect(killEvent).toMatchObject({ team: 'audit', killerTeam: 'chaff' })
    })

    it('does not damage an invulnerable Ancient even if an action sneaks through', () => {
      const state = makeGameState({
        waves: [makeWave({ id: 'c1', team: 'chaff', zone: 'audit-base' })],
      })

      const actions: WaveAction[] = [
        { waveId: 'c1', action: 'attack_ancient', damage: LINE_UNIT_ATTACK },
      ]

      const result = applyWaveActions(state, actions)
      expect(result.state.ancients.audit.hp).toBe(result.state.ancients.audit.maxHp)
      expect(result.events).toHaveLength(0)
    })
  })

  describe('base idle despawn (garbage collection)', () => {
    it('waits in base while under the idle threshold', () => {
      const state = makeGameState({
        waves: [makeWave({ id: 'c1', team: 'chaff', zone: 'audit-base', baseIdleCycles: 0 })],
      })

      const actions = runWaveAI(state)
      expect(actions[0]!.action).toBe('wait_in_base')
    })

    it('despawns once idle ticks reach the threshold', () => {
      const state = makeGameState({
        waves: [
          makeWave({
            id: 'c1',
            team: 'chaff',
            zone: 'audit-base',
            baseIdleCycles: WAVE_BASE_IDLE_DESPAWN_TICKS - 1,
          }),
        ],
      })

      const actions = runWaveAI(state)
      expect(actions[0]!.action).toBe('despawn')
    })

    it('wait_in_base increments the idle counter', () => {
      const state = makeGameState({
        waves: [makeWave({ id: 'c1', team: 'chaff', zone: 'audit-base' })],
      })

      const result = applyWaveActions(state, [{ waveId: 'c1', action: 'wait_in_base' }])
      expect(result.state.waves[0]!.baseIdleCycles).toBe(1)
    })

    it('despawn removes the wave from state', () => {
      const state = makeGameState({
        waves: [
          makeWave({ id: 'c1', team: 'chaff', zone: 'audit-base' }),
          makeWave({ id: 'c2', team: 'chaff', zone: 'mid-river' }),
        ],
      })

      const result = applyWaveActions(state, [{ waveId: 'c1', action: 'despawn' }])
      expect(result.state.waves.find((c) => c.id === 'c1')).toBeUndefined()
      expect(result.state.waves.find((c) => c.id === 'c2')).toBeDefined()
    })

    it('does not idle-despawn while the vulnerable Ancient is attackable', () => {
      const state = makeGameState({
        ancients: vulnerableAuditAncients(),
        waves: [
          makeWave({
            id: 'c1',
            team: 'chaff',
            zone: 'audit-base',
            baseIdleCycles: WAVE_BASE_IDLE_DESPAWN_TICKS,
          }),
        ],
      })

      const actions = runWaveAI(state)
      expect(actions[0]!.action).toBe('attack_ancient')
    })
  })

  describe('enforceWaveZoneCap', () => {
    it('returns the same state object when under the cap', () => {
      const state = makeGameState({
        waves: [makeWave({ id: 'c1', team: 'chaff', zone: 'mid-river' })],
      })
      expect(enforceWaveZoneCap(state)).toBe(state)
    })

    it('despawns the oldest waves first when over the cap', () => {
      const waves = Array.from({ length: MAX_WAVE_UNITS_PER_ZONE_PER_TEAM + 5 }, (_, i) =>
        makeWave({ id: `c${i}`, team: 'chaff', zone: 'mid-river' }),
      )
      const state = makeGameState({ waves })

      const result = enforceWaveZoneCap(state)
      expect(result.waves).toHaveLength(MAX_WAVE_UNITS_PER_ZONE_PER_TEAM)
      // Oldest (lowest index) should be gone, newest kept
      expect(result.waves.find((c) => c.id === 'c0')).toBeUndefined()
      expect(result.waves.find((c) => c.id === 'c4')).toBeUndefined()
      expect(result.waves.find((c) => c.id === 'c5')).toBeDefined()
      expect(
        result.waves.find((c) => c.id === `c${MAX_WAVE_UNITS_PER_ZONE_PER_TEAM + 4}`),
      ).toBeDefined()
    })

    it('caps per team per zone independently', () => {
      const chaff = Array.from({ length: MAX_WAVE_UNITS_PER_ZONE_PER_TEAM + 2 }, (_, i) =>
        makeWave({ id: `r${i}`, team: 'chaff', zone: 'mid-river' }),
      )
      const audit = Array.from({ length: 3 }, (_, i) =>
        makeWave({ id: `d${i}`, team: 'audit', zone: 'top-river' }),
      )
      const state = makeGameState({ waves: [...chaff, ...audit] })

      const result = enforceWaveZoneCap(state)
      expect(result.waves.filter((c) => c.team === 'chaff')).toHaveLength(
        MAX_WAVE_UNITS_PER_ZONE_PER_TEAM,
      )
      expect(result.waves.filter((c) => c.team === 'audit')).toHaveLength(3)
    })

    it('preserves spawn order of the survivors', () => {
      const waves = Array.from({ length: MAX_WAVE_UNITS_PER_ZONE_PER_TEAM + 1 }, (_, i) =>
        makeWave({ id: `c${i}`, team: 'chaff', zone: 'mid-river' }),
      )
      const state = makeGameState({ waves })

      const result = enforceWaveZoneCap(state)
      const ids = result.waves.map((c) => Number(c.id.slice(1)))
      const sorted = [...ids].sort((a, b) => a - b)
      expect(ids).toEqual(sorted)
    })
  })
})
