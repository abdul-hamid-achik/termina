import { describe, it, expect, beforeEach } from 'vitest'
import { Effect } from 'effect'
import { processCycle, submitAction } from '~~/server/game/engine/GameLoop'
import type { GameState, PlayerState } from '~~/shared/types/game'
import { initializeZoneStates, initializeIce } from '~~/server/game/map/zones'
import { resetWaveIdCounter, initializeTenant } from '~~/server/game/map/spawner'
import { initializeAncients } from '~~/server/game/engine/TerminalSystem'
import {
  DAY_DURATION_CYCLES,
  NIGHT_DURATION_CYCLES,
  PASSIVE_SCRIP_PER_CYCLE,
  RESPAWN_BASE_CYCLES,
  RESPAWN_PER_LEVEL_CYCLES,
  RESPAWN_FREE_LEVELS,
  MAX_WAVE_UNITS_PER_ZONE_PER_TEAM,
} from '~~/shared/constants/balance'

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'Player1',
    team: 'chaff',
    heroId: 'echo',
    zone: 'mid-t1-chaff',
    integ: 550,
    maxInteg: 550,
    bw: 280,
    maxBw: 280,
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
    buybackCost: 0,
    talents: { tier10: null, tier15: null, tier20: null, tier25: null },
    ...overrides,
  }
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    cycle: 0,
    phase: 'playing',
    teams: {
      chaff: { id: 'chaff', kills: 0, iceKills: 0, scrip: 0, hardenUsedCycle: null },
      audit: { id: 'audit', kills: 0, iceKills: 0, scrip: 0, hardenUsedCycle: null },
    },
    players: {
      p1: makePlayer({ id: 'p1', team: 'chaff', zone: 'chaff-fountain' }),
      p2: makePlayer({ id: 'p2', team: 'audit', zone: 'audit-fountain', name: 'Player2' }),
    },
    zones: initializeZoneStates(),
    waves: [],
    neutrals: [],
    ice: initializeIce(),
    terminals: initializeAncients(),
    caches: [],
    tenant: initializeTenant(),
    backup: null,
    events: [],
    surrenderVotes: { chaff: new Set(), audit: new Set() },
    timeOfDay: 'day',
    dayNightCycle: 0,
    ...overrides,
  }
}

describe('GameLoop', () => {
  beforeEach(() => {
    resetWaveIdCounter()
  })

  describe('processCycle', () => {
    it('should increment the cycle counter', () => {
      const state = makeGameState({ cycle: 5 })
      const result = Effect.runSync(processCycle('game1', state))
      expect(result.state.cycle).toBe(6)
    })

    it('should distribute passive scrip to alive players', () => {
      const state = makeGameState()
      const result = Effect.runSync(processCycle('game1', state))

      // Both players start with 600sc, should get +PASSIVE_SCRIP_PER_CYCLE
      expect(result.state.players['p1']!.scrip).toBe(600 + PASSIVE_SCRIP_PER_CYCLE)
      expect(result.state.players['p2']!.scrip).toBe(600 + PASSIVE_SCRIP_PER_CYCLE)
    })

    it('should not give passive scrip to dead players', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', alive: false, integ: 0, respawnCycle: 10 }),
          p2: makePlayer({ id: 'p2', team: 'audit', zone: 'audit-fountain' }),
        },
      })
      const result = Effect.runSync(processCycle('game1', state))
      expect(result.state.players['p1']!.scrip).toBe(600) // no scrip for dead
      expect(result.state.players['p2']!.scrip).toBe(600 + PASSIVE_SCRIP_PER_CYCLE)
    })

    it('should process submitted actions', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', zone: 'mid-t1-chaff' }),
          p2: makePlayer({ id: 'p2', team: 'audit', zone: 'audit-fountain' }),
        },
      })

      submitAction('game-test', 'p1', { type: 'move', zone: 'mid-river' })
      const result = Effect.runSync(processCycle('game-test', state))
      expect(result.state.players['p1']!.zone).toBe('mid-river')
    })

    it('should spawn wave waves at wave intervals', () => {
      // Tick 7 -> cycle 8 (first wave spawns at cycle 8)
      const state = makeGameState({ cycle: 7 })
      const result = Effect.runSync(processCycle('game2', state))
      expect(result.state.cycle).toBe(8)
      // Should have spawned waves (3 line + 1 sweep per lane per team = 24 waves)
      expect(result.state.waves.length).toBeGreaterThan(0)
    })

    it('should not spawn waves on non-wave ticks', () => {
      const state = makeGameState({ cycle: 5 })
      const result = Effect.runSync(processCycle('game3', state))
      expect(result.state.cycle).toBe(6)
      expect(result.state.waves.length).toBe(0)
    })

    it('should heal players in fountain', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            zone: 'chaff-fountain',
            integ: 100,
            maxInteg: 550,
            bw: 50,
            maxBw: 280,
          }),
          p2: makePlayer({ id: 'p2', team: 'audit', zone: 'audit-fountain' }),
        },
      })

      const result = Effect.runSync(processCycle('game4', state))
      // Fountain heals 15% per cycle: 550 * 0.15 = 82
      expect(result.state.players['p1']!.integ).toBe(182)
      // Mana: echo base 280, 280 * 0.15 = 42; 50 + 42 = 92
      expect(result.state.players['p1']!.bw).toBe(92)
    })

    it('should respawn dead players when respawn cycle is reached', () => {
      const state = makeGameState({
        cycle: 9,
        players: {
          p1: makePlayer({
            id: 'p1',
            alive: false,
            integ: 0,
            maxInteg: 550,
            maxBw: 280,
            respawnCycle: 10,
          }),
          p2: makePlayer({ id: 'p2', team: 'audit', zone: 'audit-fountain' }),
        },
      })

      const result = Effect.runSync(processCycle('game5', state))
      expect(result.state.cycle).toBe(10)
      const p1 = result.state.players['p1']!
      expect(p1.alive).toBe(true)
      expect(p1.integ).toBe(550) // Full INTEG (echo base INTEG)
      expect(p1.zone).toBe('chaff-fountain')
    })

    it('should detect chaff win when the audit Ancient is destroyed', () => {
      const terminals = initializeAncients()
      const state = makeGameState({
        terminals: {
          chaff: terminals.chaff,
          audit: { ...terminals.audit, integ: 0, alive: false, vulnerable: true },
        },
        players: {
          p1: makePlayer({ id: 'p1' }),
          p2: makePlayer({ id: 'p2', team: 'audit', zone: 'audit-fountain' }),
        },
      })

      const result = Effect.runSync(processCycle('game6', state))
      expect(result.state.phase).toBe('ended')
      expect(result.state.winner).toBe('chaff')
    })

    it('should NOT end the game when all enemy ice are destroyed but the Ancient stands', () => {
      const ice = initializeIce().map((t) =>
        t.team === 'audit' ? { ...t, integ: 0, alive: false } : t,
      )

      const state = makeGameState({
        ice,
        players: {
          p1: makePlayer({ id: 'p1' }),
          p2: makePlayer({ id: 'p2', team: 'audit', zone: 'audit-fountain' }),
        },
      })

      const result = Effect.runSync(processCycle('game6b', state))
      expect(result.state.phase).toBe('playing')
      // But the audit Ancient must now be vulnerable (its T3s are down)
      expect(result.state.terminals.audit.vulnerable).toBe(true)
    })

    it('should mark an Ancient vulnerable when one of its T3 ice falls', () => {
      const ice = initializeIce().map((t) =>
        t.zone === 'mid-t3-audit' ? { ...t, integ: 0, alive: false } : t,
      )

      const state = makeGameState({ ice })
      const result = Effect.runSync(processCycle('game6c', state))
      expect(result.state.terminals.audit.vulnerable).toBe(true)
      expect(result.state.terminals.chaff.vulnerable).toBe(false)
    })

    it('should keep Ancients invulnerable while only T1/T2 ice are down', () => {
      const ice = initializeIce().map((t) =>
        t.zone === 'mid-t1-audit' || t.zone === 'mid-t2-audit'
          ? { ...t, integ: 0, alive: false }
          : t,
      )

      const state = makeGameState({ ice })
      const result = Effect.runSync(processCycle('game6d', state))
      expect(result.state.terminals.audit.vulnerable).toBe(false)
      expect(result.state.terminals.chaff.vulnerable).toBe(false)
    })

    it('should handle only one action per player per cycle', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', zone: 'mid-t1-chaff' }),
          p2: makePlayer({ id: 'p2', team: 'audit', zone: 'audit-fountain' }),
        },
      })

      // Submit two actions for same player — second should override
      submitAction('game-override', 'p1', { type: 'move', zone: 'mid-t2-chaff' })
      submitAction('game-override', 'p1', { type: 'move', zone: 'mid-river' })

      const result = Effect.runSync(processCycle('game-override', state))
      expect(result.state.players['p1']!.zone).toBe('mid-river')
    })

    it('should set death respawn timer for killed players', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', alive: false, integ: 0, level: 1, respawnCycle: null }),
          p2: makePlayer({ id: 'p2', team: 'audit', zone: 'audit-fountain' }),
        },
      })

      const result = Effect.runSync(processCycle('game-death', state))
      const p1 = result.state.players['p1']!
      expect(p1.respawnCycle).not.toBeNull()
      // Respawn = cycle + base + max(0, level - free) * perLevel
      // cycle =1, level=1, base=2, free=4 → 1 + 2 + 0 = 3
      const scaled = Math.max(0, 1 - RESPAWN_FREE_LEVELS)
      expect(p1.respawnCycle).toBe(1 + RESPAWN_BASE_CYCLES + RESPAWN_PER_LEVEL_CYCLES * scaled)
    })

    it('should not respawn dead players before respawn tick', () => {
      const state = makeGameState({
        cycle: 5,
        players: {
          p1: makePlayer({ id: 'p1', alive: false, integ: 0, respawnCycle: 10 }),
          p2: makePlayer({ id: 'p2', team: 'audit', zone: 'audit-fountain' }),
        },
      })

      const result = Effect.runSync(processCycle('game-no-respawn', state))
      expect(result.state.players['p1']!.alive).toBe(false)
    })

    it('should heal BW in fountain', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            zone: 'chaff-fountain',
            bw: 50,
            maxBw: 280,
            integ: 550,
            maxInteg: 550,
          }),
          p2: makePlayer({ id: 'p2', team: 'audit', zone: 'audit-fountain' }),
        },
      })

      const result = Effect.runSync(processCycle('game-BW', state))
      expect(result.state.players['p1']!.bw).toBeGreaterThan(50)
    })

    it('should not heal players outside their fountain', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            zone: 'mid-river',
            integ: 100,
            maxInteg: 550,
          }),
          p2: makePlayer({ id: 'p2', team: 'audit', zone: 'audit-fountain' }),
        },
      })

      const result = Effect.runSync(processCycle('game-no-heal', state))
      // Player not in fountain should not be healed
      expect(result.state.players['p1']!.integ).toBe(100)
    })

    it('should not heal chaff player in audit fountain', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            team: 'chaff',
            zone: 'audit-fountain',
            integ: 100,
            maxInteg: 550,
          }),
          p2: makePlayer({ id: 'p2', team: 'audit', zone: 'audit-fountain' }),
        },
      })

      const result = Effect.runSync(processCycle('game-wrong-fountain', state))
      expect(result.state.players['p1']!.integ).toBe(100)
    })

    it('should cap fountain healing at max INTEG', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            zone: 'chaff-fountain',
            integ: 540,
            maxInteg: 550,
            bw: 275,
            maxBw: 280,
          }),
          p2: makePlayer({ id: 'p2', team: 'audit', zone: 'audit-fountain' }),
        },
      })

      const result = Effect.runSync(processCycle('game-cap-heal', state))
      expect(result.state.players['p1']!.integ).toBe(550)
      expect(result.state.players['p1']!.bw).toBe(280)
    })

    it('auto-paths a distant move one hop per cycle and stores the destination', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', zone: 'mid-t1-chaff' }),
          p2: makePlayer({ id: 'p2', team: 'audit', zone: 'audit-fountain' }),
        },
      })

      // Distant zone: a valid order now — the hero walks one hop per cycle
      submitAction('game-mixed', 'p1', { type: 'move', zone: 'bot-t1-chaff' })

      const result = Effect.runSync(processCycle('game-mixed', state))
      const p1 = result.state.players['p1']!
      expect(p1.zone).not.toBe('mid-t1-chaff') // took the first hop
      expect(p1.moveTarget).toBe('bot-t1-chaff') // still walking
    })

    it('should not process actions when game is ended', () => {
      const terminals = initializeAncients()
      const state = makeGameState({
        terminals: {
          chaff: terminals.chaff,
          audit: { ...terminals.audit, integ: 0, alive: false, vulnerable: true },
        },
        players: {
          p1: makePlayer({ id: 'p1', zone: 'mid-t1-chaff' }),
          p2: makePlayer({ id: 'p2', team: 'audit', zone: 'audit-fountain' }),
        },
      })

      const result = Effect.runSync(processCycle('game-ended', state))
      expect(result.state.phase).toBe('ended')
    })

    it('should detect audit win when the chaff Ancient is destroyed', () => {
      const terminals = initializeAncients()
      const state = makeGameState({
        terminals: {
          chaff: { ...terminals.chaff, integ: 0, alive: false, vulnerable: true },
          audit: terminals.audit,
        },
        players: {
          p1: makePlayer({ id: 'p1' }),
          p2: makePlayer({ id: 'p2', team: 'audit', zone: 'audit-fountain' }),
        },
      })

      const result = Effect.runSync(processCycle('game-audit-win', state))
      expect(result.state.phase).toBe('ended')
      expect(result.state.winner).toBe('audit')
    })

    it('should not end game when both Ancients are alive', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1' }),
          p2: makePlayer({ id: 'p2', team: 'audit', zone: 'audit-fountain' }),
        },
      })

      const result = Effect.runSync(processCycle('game-ongoing', state))
      expect(result.state.phase).toBe('playing')
    })

    it('should return events from the tick', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', alive: false, integ: 0, respawnCycle: null }),
          p2: makePlayer({ id: 'p2', team: 'audit', zone: 'audit-fountain' }),
        },
      })

      const result = Effect.runSync(processCycle('game-events', state))
      // Should have death event for p1
      const deathEvents = result.events.filter((e) => e._tag === 'death')
      expect(deathEvents.length).toBeGreaterThan(0)
    })

    it('should resurrect player with backup instead of setting respawn timer', () => {
      const state = makeGameState({
        cycle: 10,
        players: {
          p1: makePlayer({
            id: 'p1',
            alive: false,
            integ: 0,
            bw: 0,
            zone: 'mid-river',
            respawnCycle: null,
            // Died mid-walk: the backup revive must ALSO cancel the auto-path
            // (or the hero resumes marching into whoever just killed them).
            moveTarget: 'audit-base',
            buffs: [{ id: 'backup', stacks: 1, cyclesRemaining: 999, source: 'tenant' }],
          }),
          p2: makePlayer({ id: 'p2', team: 'audit', zone: 'audit-fountain' }),
        },
      })

      const result = Effect.runSync(processCycle('game-backup', state))
      const p1 = result.state.players['p1']!

      expect(p1.alive).toBe(true)
      expect(p1.integ).toBe(550)
      expect(p1.bw).toBe(280)
      expect(p1.respawnCycle).toBeNull()
      expect(p1.buffs).toEqual([])
      expect(p1.zone).toBe('mid-river')
      expect(p1.moveTarget ?? null).toBeNull()

      const backupEvents = result.events.filter((e) => e._tag === 'backup_used')
      expect(backupEvents.length).toBe(1)
    })

    it('should set respawn timer for player without backup', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', alive: false, integ: 0, respawnCycle: null }),
          p2: makePlayer({ id: 'p2', team: 'audit', zone: 'audit-fountain' }),
        },
      })

      const result = Effect.runSync(processCycle('game-no-backup', state))
      const p1 = result.state.players['p1']!

      expect(p1.alive).toBe(false)
      expect(p1.respawnCycle).not.toBeNull()
    })

    it('should consume backup buff on resurrection', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            alive: false,
            integ: 0,
            bw: 0,
            respawnCycle: null,
            buffs: [
              { id: 'backup', stacks: 1, cyclesRemaining: 999, source: 'tenant' },
              { id: 'regeneration', stacks: 1, cyclesRemaining: 5, source: 'cache' },
            ],
          }),
          p2: makePlayer({ id: 'p2', team: 'audit', zone: 'audit-fountain' }),
        },
      })

      const result = Effect.runSync(processCycle('game-backup-consume', state))
      const p1 = result.state.players['p1']!

      expect(p1.alive).toBe(true)
      expect(p1.buffs.some((b) => b.id === 'backup')).toBe(false)
      expect(p1.buffs.some((b) => b.id === 'regeneration')).toBe(true)
    })
  })

  describe('day/night cycle', () => {
    it('should progress dayNightCycle each cycle', () => {
      const state = makeGameState({ dayNightCycle: 0 })
      const result = Effect.runSync(processCycle('game-dn-1', state))
      expect(result.state.dayNightCycle).toBe(1)
    })

    it('should transition from day to night after DAY_DURATION_CYCLES', () => {
      const state = makeGameState({
        timeOfDay: 'day',
        dayNightCycle: DAY_DURATION_CYCLES - 1,
      })
      const result = Effect.runSync(processCycle('game-dn-2', state))
      expect(result.state.timeOfDay).toBe('night')
      expect(result.state.dayNightCycle).toBe(0)
    })

    it('should emit night_falls event when transitioning to night', () => {
      const state = makeGameState({
        timeOfDay: 'day',
        dayNightCycle: DAY_DURATION_CYCLES - 1,
      })
      const result = Effect.runSync(processCycle('game-dn-3', state))
      const nightFallsEvents = result.events.filter((e) => e._tag === 'night_falls')
      expect(nightFallsEvents.length).toBe(1)
    })

    it('should transition from night to day after NIGHT_DURATION_CYCLES', () => {
      const state = makeGameState({
        timeOfDay: 'night',
        dayNightCycle: NIGHT_DURATION_CYCLES - 1,
      })
      const result = Effect.runSync(processCycle('game-dn-4', state))
      expect(result.state.timeOfDay).toBe('day')
      expect(result.state.dayNightCycle).toBe(0)
    })

    it('should emit day_breaks event when transitioning to day', () => {
      const state = makeGameState({
        timeOfDay: 'night',
        dayNightCycle: NIGHT_DURATION_CYCLES - 1,
      })
      const result = Effect.runSync(processCycle('game-dn-5', state))
      const dayBreaksEvents = result.events.filter((e) => e._tag === 'day_breaks')
      expect(dayBreaksEvents.length).toBe(1)
    })

    it('should not transition before duration is reached', () => {
      const state = makeGameState({
        timeOfDay: 'day',
        dayNightCycle: DAY_DURATION_CYCLES - 2,
      })
      const result = Effect.runSync(processCycle('game-dn-6', state))
      expect(result.state.timeOfDay).toBe('day')
      expect(result.state.dayNightCycle).toBe(DAY_DURATION_CYCLES - 1)
    })
  })

  describe('Ancient breach and wave cleanup', () => {
    it('waves in the enemy base damage a vulnerable Ancient via processCycle', () => {
      const terminals = initializeAncients()
      const state = makeGameState({
        terminals: {
          chaff: terminals.chaff,
          audit: { ...terminals.audit, vulnerable: true },
        },
        // Keep audit T3 mid dead so vulnerability stays true after recompute
        ice: initializeIce().map((t) =>
          t.zone === 'mid-t3-audit' ? { ...t, integ: 0, alive: false } : t,
        ),
        waves: [
          { id: 'c1', team: 'chaff', zone: 'audit-base', integ: 400, type: 'line' },
          { id: 'c2', team: 'chaff', zone: 'audit-base', integ: 250, type: 'sweep' },
        ],
      })

      const result = Effect.runSync(processCycle('game-ancient-breach', state))
      const audit = result.state.terminals.audit
      expect(audit.integ).toBeLessThan(audit.maxInteg)
      // Damage events against the ancient should be emitted
      const ancientDamage = result.events.filter(
        (e) => e._tag === 'damage' && e.targetId === 'terminal_audit',
      )
      expect(ancientDamage.length).toBe(2)
    })

    it('game ends via Ancient destruction by waves', () => {
      const terminals = initializeAncients()
      const state = makeGameState({
        terminals: {
          chaff: terminals.chaff,
          audit: { ...terminals.audit, integ: 10, vulnerable: true },
        },
        ice: initializeIce().map((t) =>
          t.zone === 'mid-t3-audit' ? { ...t, integ: 0, alive: false } : t,
        ),
        waves: [{ id: 'c1', team: 'chaff', zone: 'audit-base', integ: 400, type: 'line' }],
      })

      const result = Effect.runSync(processCycle('game-ancient-end', state))
      expect(result.state.terminals.audit.alive).toBe(false)
      expect(result.state.phase).toBe('ended')
      expect(result.state.winner).toBe('chaff')
    })

    it('waves idling in base with an invulnerable Ancient are garbage collected', () => {
      let state = makeGameState({
        waves: [{ id: 'c1', team: 'chaff', zone: 'audit-base', integ: 400, type: 'line' }],
      })

      // Ancient is invulnerable (all ice alive), no heroes in base.
      // Wave should idle and despawn after WAVE_BASE_IDLE_DESPAWN_CYCLES.
      for (let i = 0; i < 3; i++) {
        state = Effect.runSync(processCycle('game-wave-gc', state)).state
      }
      expect(state.waves.find((c) => c.id === 'c1')).toBeUndefined()
    })

    it('per-zone wave cap is enforced during processCycle', () => {
      const waves = Array.from({ length: 30 }, (_, i) => ({
        id: `stack_${i}`,
        team: 'chaff' as const,
        zone: 'mid-t2-chaff',
        integ: 400,
        type: 'line' as const,
      }))
      const state = makeGameState({ waves })

      const result = Effect.runSync(processCycle('game-wave-cap', state))
      // All 30 move together to the next zone; the cap trims them to 12
      const counts = new Map<string, number>()
      for (const c of result.state.waves) {
        const key = `${c.team}:${c.zone}`
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
      for (const count of counts.values()) {
        expect(count).toBeLessThanOrEqual(MAX_WAVE_UNITS_PER_ZONE_PER_TEAM)
      }
    })

    it('ensureTerminals backfills states without terminals (old snapshots)', () => {
      const state = makeGameState()
      // Simulate a pre-Ancient snapshot
      const legacy = { ...state } as Partial<GameState>
      delete legacy.terminals

      const result = Effect.runSync(processCycle('game-legacy', legacy as GameState))
      expect(result.state.terminals).toBeDefined()
      expect(result.state.terminals.chaff.alive).toBe(true)
      expect(result.state.terminals.audit.alive).toBe(true)
    })
  })
})
