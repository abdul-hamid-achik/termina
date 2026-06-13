import { describe, it, expect, beforeEach } from 'vitest'
import { Effect } from 'effect'
import { processTick, submitAction } from '../../../server/game/engine/GameLoop'
import type { GameState, PlayerState } from '../../../shared/types/game'
import { initializeZoneStates, initializeTowers } from '../../../server/game/map/zones'
import { resetCreepIdCounter, initializeRoshan } from '../../../server/game/map/spawner'
import { initializeAncients } from '../../../server/game/engine/AncientSystem'
import {
  DAY_DURATION_TICKS,
  NIGHT_DURATION_TICKS,
  PASSIVE_GOLD_PER_TICK,
  RESPAWN_BASE_TICKS,
  RESPAWN_PER_LEVEL_TICKS,
  RESPAWN_FREE_LEVELS,
  MAX_CREEPS_PER_ZONE_PER_TEAM,
} from '../../../shared/constants/balance'

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'Player1',
    team: 'radiant',
    heroId: 'echo',
    zone: 'mid-t1-rad',
    hp: 550,
    maxHp: 550,
    mp: 280,
    maxMp: 280,
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
    buybackCost: 0,
    talents: { tier10: null, tier15: null, tier20: null, tier25: null },
    ...overrides,
  }
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    tick: 0,
    phase: 'playing',
    teams: {
      radiant: { id: 'radiant', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: null },
      dire: { id: 'dire', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: null },
    },
    players: {
      p1: makePlayer({ id: 'p1', team: 'radiant', zone: 'radiant-fountain' }),
      p2: makePlayer({ id: 'p2', team: 'dire', zone: 'dire-fountain', name: 'Player2' }),
    },
    zones: initializeZoneStates(),
    creeps: [],
    neutrals: [],
    towers: initializeTowers(),
    ancients: initializeAncients(),
    runes: [],
    roshan: initializeRoshan(),
    aegis: null,
    events: [],
    surrenderVotes: { radiant: new Set(), dire: new Set() },
    lastSeen: {},
    timeOfDay: 'day',
    dayNightTick: 0,
    ...overrides,
  }
}

describe('GameLoop', () => {
  beforeEach(() => {
    resetCreepIdCounter()
  })

  describe('processTick', () => {
    it('should increment the tick counter', () => {
      const state = makeGameState({ tick: 5 })
      const result = Effect.runSync(processTick('game1', state))
      expect(result.state.tick).toBe(6)
    })

    it('should distribute passive gold to alive players', () => {
      const state = makeGameState()
      const result = Effect.runSync(processTick('game1', state))

      // Both players start with 600g, should get +PASSIVE_GOLD_PER_TICK
      expect(result.state.players['p1']!.gold).toBe(600 + PASSIVE_GOLD_PER_TICK)
      expect(result.state.players['p2']!.gold).toBe(600 + PASSIVE_GOLD_PER_TICK)
    })

    it('should not give passive gold to dead players', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', alive: false, hp: 0, respawnTick: 10 }),
          p2: makePlayer({ id: 'p2', team: 'dire', zone: 'dire-fountain' }),
        },
      })
      const result = Effect.runSync(processTick('game1', state))
      expect(result.state.players['p1']!.gold).toBe(600) // no gold for dead
      expect(result.state.players['p2']!.gold).toBe(600 + PASSIVE_GOLD_PER_TICK)
    })

    it('should process submitted actions', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', zone: 'mid-t1-rad' }),
          p2: makePlayer({ id: 'p2', team: 'dire', zone: 'dire-fountain' }),
        },
      })

      submitAction('game-test', 'p1', { type: 'move', zone: 'mid-river' })
      const result = Effect.runSync(processTick('game-test', state))
      expect(result.state.players['p1']!.zone).toBe('mid-river')
    })

    it('should spawn creep waves at wave intervals', () => {
      // Tick 7 -> tick 8 (first wave spawns at tick 8)
      const state = makeGameState({ tick: 7 })
      const result = Effect.runSync(processTick('game2', state))
      expect(result.state.tick).toBe(8)
      // Should have spawned creeps (3 melee + 1 ranged per lane per team = 24 creeps)
      expect(result.state.creeps.length).toBeGreaterThan(0)
    })

    it('should not spawn creeps on non-wave ticks', () => {
      const state = makeGameState({ tick: 5 })
      const result = Effect.runSync(processTick('game3', state))
      expect(result.state.tick).toBe(6)
      expect(result.state.creeps.length).toBe(0)
    })

    it('should heal players in fountain', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            zone: 'radiant-fountain',
            hp: 100,
            maxHp: 550,
            mp: 50,
            maxMp: 280,
          }),
          p2: makePlayer({ id: 'p2', team: 'dire', zone: 'dire-fountain' }),
        },
      })

      const result = Effect.runSync(processTick('game4', state))
      // Fountain heals 15% per tick: 550 * 0.15 = 82
      expect(result.state.players['p1']!.hp).toBe(182)
      // Mana: echo base 280, 280 * 0.15 = 42; 50 + 42 = 92
      expect(result.state.players['p1']!.mp).toBe(92)
    })

    it('should respawn dead players when respawn tick is reached', () => {
      const state = makeGameState({
        tick: 9,
        players: {
          p1: makePlayer({
            id: 'p1',
            alive: false,
            hp: 0,
            maxHp: 550,
            maxMp: 280,
            respawnTick: 10,
          }),
          p2: makePlayer({ id: 'p2', team: 'dire', zone: 'dire-fountain' }),
        },
      })

      const result = Effect.runSync(processTick('game5', state))
      expect(result.state.tick).toBe(10)
      const p1 = result.state.players['p1']!
      expect(p1.alive).toBe(true)
      expect(p1.hp).toBe(550) // Full HP (echo base HP)
      expect(p1.zone).toBe('radiant-fountain')
    })

    it('should detect radiant win when the dire Ancient is destroyed', () => {
      const ancients = initializeAncients()
      const state = makeGameState({
        ancients: {
          radiant: ancients.radiant,
          dire: { ...ancients.dire, hp: 0, alive: false, vulnerable: true },
        },
        players: {
          p1: makePlayer({ id: 'p1' }),
          p2: makePlayer({ id: 'p2', team: 'dire', zone: 'dire-fountain' }),
        },
      })

      const result = Effect.runSync(processTick('game6', state))
      expect(result.state.phase).toBe('ended')
      expect(result.state.winner).toBe('radiant')
    })

    it('should NOT end the game when all enemy towers are destroyed but the Ancient stands', () => {
      const towers = initializeTowers().map((t) =>
        t.team === 'dire' ? { ...t, hp: 0, alive: false } : t,
      )

      const state = makeGameState({
        towers,
        players: {
          p1: makePlayer({ id: 'p1' }),
          p2: makePlayer({ id: 'p2', team: 'dire', zone: 'dire-fountain' }),
        },
      })

      const result = Effect.runSync(processTick('game6b', state))
      expect(result.state.phase).toBe('playing')
      // But the dire Ancient must now be vulnerable (its T3s are down)
      expect(result.state.ancients.dire.vulnerable).toBe(true)
    })

    it('should mark an Ancient vulnerable when one of its T3 towers falls', () => {
      const towers = initializeTowers().map((t) =>
        t.zone === 'mid-t3-dire' ? { ...t, hp: 0, alive: false } : t,
      )

      const state = makeGameState({ towers })
      const result = Effect.runSync(processTick('game6c', state))
      expect(result.state.ancients.dire.vulnerable).toBe(true)
      expect(result.state.ancients.radiant.vulnerable).toBe(false)
    })

    it('should keep Ancients invulnerable while only T1/T2 towers are down', () => {
      const towers = initializeTowers().map((t) =>
        t.zone === 'mid-t1-dire' || t.zone === 'mid-t2-dire' ? { ...t, hp: 0, alive: false } : t,
      )

      const state = makeGameState({ towers })
      const result = Effect.runSync(processTick('game6d', state))
      expect(result.state.ancients.dire.vulnerable).toBe(false)
      expect(result.state.ancients.radiant.vulnerable).toBe(false)
    })

    it('should handle only one action per player per tick', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', zone: 'mid-t1-rad' }),
          p2: makePlayer({ id: 'p2', team: 'dire', zone: 'dire-fountain' }),
        },
      })

      // Submit two actions for same player — second should override
      submitAction('game-override', 'p1', { type: 'move', zone: 'mid-t2-rad' })
      submitAction('game-override', 'p1', { type: 'move', zone: 'mid-river' })

      const result = Effect.runSync(processTick('game-override', state))
      expect(result.state.players['p1']!.zone).toBe('mid-river')
    })

    it('should set death respawn timer for killed players', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', alive: false, hp: 0, level: 1, respawnTick: null }),
          p2: makePlayer({ id: 'p2', team: 'dire', zone: 'dire-fountain' }),
        },
      })

      const result = Effect.runSync(processTick('game-death', state))
      const p1 = result.state.players['p1']!
      expect(p1.respawnTick).not.toBeNull()
      // Respawn = tick + base + max(0, level - free) * perLevel
      // tick=1, level=1, base=2, free=4 → 1 + 2 + 0 = 3
      const scaled = Math.max(0, 1 - RESPAWN_FREE_LEVELS)
      expect(p1.respawnTick).toBe(1 + RESPAWN_BASE_TICKS + RESPAWN_PER_LEVEL_TICKS * scaled)
    })

    it('should not respawn dead players before respawn tick', () => {
      const state = makeGameState({
        tick: 5,
        players: {
          p1: makePlayer({ id: 'p1', alive: false, hp: 0, respawnTick: 10 }),
          p2: makePlayer({ id: 'p2', team: 'dire', zone: 'dire-fountain' }),
        },
      })

      const result = Effect.runSync(processTick('game-no-respawn', state))
      expect(result.state.players['p1']!.alive).toBe(false)
    })

    it('should heal mana in fountain', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            zone: 'radiant-fountain',
            mp: 50,
            maxMp: 280,
            hp: 550,
            maxHp: 550,
          }),
          p2: makePlayer({ id: 'p2', team: 'dire', zone: 'dire-fountain' }),
        },
      })

      const result = Effect.runSync(processTick('game-mana', state))
      expect(result.state.players['p1']!.mp).toBeGreaterThan(50)
    })

    it('should not heal players outside their fountain', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            zone: 'mid-river',
            hp: 100,
            maxHp: 550,
          }),
          p2: makePlayer({ id: 'p2', team: 'dire', zone: 'dire-fountain' }),
        },
      })

      const result = Effect.runSync(processTick('game-no-heal', state))
      // Player not in fountain should not be healed
      expect(result.state.players['p1']!.hp).toBe(100)
    })

    it('should not heal radiant player in dire fountain', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            team: 'radiant',
            zone: 'dire-fountain',
            hp: 100,
            maxHp: 550,
          }),
          p2: makePlayer({ id: 'p2', team: 'dire', zone: 'dire-fountain' }),
        },
      })

      const result = Effect.runSync(processTick('game-wrong-fountain', state))
      expect(result.state.players['p1']!.hp).toBe(100)
    })

    it('should cap fountain healing at max HP', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            zone: 'radiant-fountain',
            hp: 540,
            maxHp: 550,
            mp: 275,
            maxMp: 280,
          }),
          p2: makePlayer({ id: 'p2', team: 'dire', zone: 'dire-fountain' }),
        },
      })

      const result = Effect.runSync(processTick('game-cap-heal', state))
      expect(result.state.players['p1']!.hp).toBe(550)
      expect(result.state.players['p1']!.mp).toBe(280)
    })

    it('should reject invalid actions and still process valid ones', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', zone: 'mid-t1-rad' }),
          p2: makePlayer({ id: 'p2', team: 'dire', zone: 'dire-fountain' }),
        },
      })

      // Invalid: move to non-adjacent zone
      submitAction('game-mixed', 'p1', { type: 'move', zone: 'bot-t1-rad' })

      const result = Effect.runSync(processTick('game-mixed', state))
      // Invalid action should be rejected, player stays
      expect(result.state.players['p1']!.zone).toBe('mid-t1-rad')
    })

    it('should not process actions when game is ended', () => {
      const ancients = initializeAncients()
      const state = makeGameState({
        ancients: {
          radiant: ancients.radiant,
          dire: { ...ancients.dire, hp: 0, alive: false, vulnerable: true },
        },
        players: {
          p1: makePlayer({ id: 'p1', zone: 'mid-t1-rad' }),
          p2: makePlayer({ id: 'p2', team: 'dire', zone: 'dire-fountain' }),
        },
      })

      const result = Effect.runSync(processTick('game-ended', state))
      expect(result.state.phase).toBe('ended')
    })

    it('should detect dire win when the radiant Ancient is destroyed', () => {
      const ancients = initializeAncients()
      const state = makeGameState({
        ancients: {
          radiant: { ...ancients.radiant, hp: 0, alive: false, vulnerable: true },
          dire: ancients.dire,
        },
        players: {
          p1: makePlayer({ id: 'p1' }),
          p2: makePlayer({ id: 'p2', team: 'dire', zone: 'dire-fountain' }),
        },
      })

      const result = Effect.runSync(processTick('game-dire-win', state))
      expect(result.state.phase).toBe('ended')
      expect(result.state.winner).toBe('dire')
    })

    it('should not end game when both Ancients are alive', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1' }),
          p2: makePlayer({ id: 'p2', team: 'dire', zone: 'dire-fountain' }),
        },
      })

      const result = Effect.runSync(processTick('game-ongoing', state))
      expect(result.state.phase).toBe('playing')
    })

    it('should return events from the tick', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', alive: false, hp: 0, respawnTick: null }),
          p2: makePlayer({ id: 'p2', team: 'dire', zone: 'dire-fountain' }),
        },
      })

      const result = Effect.runSync(processTick('game-events', state))
      // Should have death event for p1
      const deathEvents = result.events.filter((e) => e._tag === 'death')
      expect(deathEvents.length).toBeGreaterThan(0)
    })

    it('should resurrect player with aegis instead of setting respawn timer', () => {
      const state = makeGameState({
        tick: 10,
        players: {
          p1: makePlayer({
            id: 'p1',
            alive: false,
            hp: 0,
            mp: 0,
            zone: 'mid-river',
            respawnTick: null,
            buffs: [{ id: 'aegis', stacks: 1, ticksRemaining: 999, source: 'roshan' }],
          }),
          p2: makePlayer({ id: 'p2', team: 'dire', zone: 'dire-fountain' }),
        },
      })

      const result = Effect.runSync(processTick('game-aegis', state))
      const p1 = result.state.players['p1']!

      expect(p1.alive).toBe(true)
      expect(p1.hp).toBe(550)
      expect(p1.mp).toBe(280)
      expect(p1.respawnTick).toBeNull()
      expect(p1.buffs).toEqual([])
      expect(p1.zone).toBe('mid-river')

      const aegisEvents = result.events.filter((e) => e._tag === 'aegis_used')
      expect(aegisEvents.length).toBe(1)
    })

    it('should set respawn timer for player without aegis', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', alive: false, hp: 0, respawnTick: null }),
          p2: makePlayer({ id: 'p2', team: 'dire', zone: 'dire-fountain' }),
        },
      })

      const result = Effect.runSync(processTick('game-no-aegis', state))
      const p1 = result.state.players['p1']!

      expect(p1.alive).toBe(false)
      expect(p1.respawnTick).not.toBeNull()
    })

    it('should consume aegis buff on resurrection', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            alive: false,
            hp: 0,
            mp: 0,
            respawnTick: null,
            buffs: [
              { id: 'aegis', stacks: 1, ticksRemaining: 999, source: 'roshan' },
              { id: 'regeneration', stacks: 1, ticksRemaining: 5, source: 'rune' },
            ],
          }),
          p2: makePlayer({ id: 'p2', team: 'dire', zone: 'dire-fountain' }),
        },
      })

      const result = Effect.runSync(processTick('game-aegis-consume', state))
      const p1 = result.state.players['p1']!

      expect(p1.alive).toBe(true)
      expect(p1.buffs.some((b) => b.id === 'aegis')).toBe(false)
      expect(p1.buffs.some((b) => b.id === 'regeneration')).toBe(true)
    })
  })

  describe('day/night cycle', () => {
    it('should progress dayNightTick each tick', () => {
      const state = makeGameState({ dayNightTick: 0 })
      const result = Effect.runSync(processTick('game-dn-1', state))
      expect(result.state.dayNightTick).toBe(1)
    })

    it('should transition from day to night after DAY_DURATION_TICKS', () => {
      const state = makeGameState({
        timeOfDay: 'day',
        dayNightTick: DAY_DURATION_TICKS - 1,
      })
      const result = Effect.runSync(processTick('game-dn-2', state))
      expect(result.state.timeOfDay).toBe('night')
      expect(result.state.dayNightTick).toBe(0)
    })

    it('should emit night_falls event when transitioning to night', () => {
      const state = makeGameState({
        timeOfDay: 'day',
        dayNightTick: DAY_DURATION_TICKS - 1,
      })
      const result = Effect.runSync(processTick('game-dn-3', state))
      const nightFallsEvents = result.events.filter((e) => e._tag === 'night_falls')
      expect(nightFallsEvents.length).toBe(1)
    })

    it('should transition from night to day after NIGHT_DURATION_TICKS', () => {
      const state = makeGameState({
        timeOfDay: 'night',
        dayNightTick: NIGHT_DURATION_TICKS - 1,
      })
      const result = Effect.runSync(processTick('game-dn-4', state))
      expect(result.state.timeOfDay).toBe('day')
      expect(result.state.dayNightTick).toBe(0)
    })

    it('should emit day_breaks event when transitioning to day', () => {
      const state = makeGameState({
        timeOfDay: 'night',
        dayNightTick: NIGHT_DURATION_TICKS - 1,
      })
      const result = Effect.runSync(processTick('game-dn-5', state))
      const dayBreaksEvents = result.events.filter((e) => e._tag === 'day_breaks')
      expect(dayBreaksEvents.length).toBe(1)
    })

    it('should not transition before duration is reached', () => {
      const state = makeGameState({
        timeOfDay: 'day',
        dayNightTick: DAY_DURATION_TICKS - 2,
      })
      const result = Effect.runSync(processTick('game-dn-6', state))
      expect(result.state.timeOfDay).toBe('day')
      expect(result.state.dayNightTick).toBe(DAY_DURATION_TICKS - 1)
    })
  })

  describe('Ancient siege and creep cleanup', () => {
    it('creeps in the enemy base damage a vulnerable Ancient via processTick', () => {
      const ancients = initializeAncients()
      const state = makeGameState({
        ancients: {
          radiant: ancients.radiant,
          dire: { ...ancients.dire, vulnerable: true },
        },
        // Keep dire T3 mid dead so vulnerability stays true after recompute
        towers: initializeTowers().map((t) =>
          t.zone === 'mid-t3-dire' ? { ...t, hp: 0, alive: false } : t,
        ),
        creeps: [
          { id: 'c1', team: 'radiant', zone: 'dire-base', hp: 400, type: 'melee' },
          { id: 'c2', team: 'radiant', zone: 'dire-base', hp: 250, type: 'ranged' },
        ],
      })

      const result = Effect.runSync(processTick('game-ancient-siege', state))
      const dire = result.state.ancients.dire
      expect(dire.hp).toBeLessThan(dire.maxHp)
      // Damage events against the ancient should be emitted
      const ancientDamage = result.events.filter(
        (e) => e._tag === 'damage' && e.targetId === 'ancient_dire',
      )
      expect(ancientDamage.length).toBe(2)
    })

    it('game ends via Ancient destruction by creeps', () => {
      const ancients = initializeAncients()
      const state = makeGameState({
        ancients: {
          radiant: ancients.radiant,
          dire: { ...ancients.dire, hp: 10, vulnerable: true },
        },
        towers: initializeTowers().map((t) =>
          t.zone === 'mid-t3-dire' ? { ...t, hp: 0, alive: false } : t,
        ),
        creeps: [{ id: 'c1', team: 'radiant', zone: 'dire-base', hp: 400, type: 'melee' }],
      })

      const result = Effect.runSync(processTick('game-ancient-end', state))
      expect(result.state.ancients.dire.alive).toBe(false)
      expect(result.state.phase).toBe('ended')
      expect(result.state.winner).toBe('radiant')
    })

    it('creeps idling in base with an invulnerable Ancient are garbage collected', () => {
      let state = makeGameState({
        creeps: [{ id: 'c1', team: 'radiant', zone: 'dire-base', hp: 400, type: 'melee' }],
      })

      // Ancient is invulnerable (all towers alive), no heroes in base.
      // Creep should idle and despawn after CREEP_BASE_IDLE_DESPAWN_TICKS.
      for (let i = 0; i < 3; i++) {
        state = Effect.runSync(processTick('game-creep-gc', state)).state
      }
      expect(state.creeps.find((c) => c.id === 'c1')).toBeUndefined()
    })

    it('per-zone creep cap is enforced during processTick', () => {
      const creeps = Array.from({ length: 30 }, (_, i) => ({
        id: `stack_${i}`,
        team: 'radiant' as const,
        zone: 'mid-t2-rad',
        hp: 400,
        type: 'melee' as const,
      }))
      const state = makeGameState({ creeps })

      const result = Effect.runSync(processTick('game-creep-cap', state))
      // All 30 move together to the next zone; the cap trims them to 12
      const counts = new Map<string, number>()
      for (const c of result.state.creeps) {
        const key = `${c.team}:${c.zone}`
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
      for (const count of counts.values()) {
        expect(count).toBeLessThanOrEqual(MAX_CREEPS_PER_ZONE_PER_TEAM)
      }
    })

    it('ensureAncients backfills states without ancients (old snapshots)', () => {
      const state = makeGameState()
      // Simulate a pre-Ancient snapshot
      const legacy = { ...state } as Partial<GameState>
      delete legacy.ancients

      const result = Effect.runSync(processTick('game-legacy', legacy as GameState))
      expect(result.state.ancients).toBeDefined()
      expect(result.state.ancients.radiant.alive).toBe(true)
      expect(result.state.ancients.dire.alive).toBe(true)
    })
  })
})
