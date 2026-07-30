import { describe, it, expect } from 'vitest'
import {
  getCacheBuff,
  pickupCache,
  removeExpiredCaches,
  processCacheBuffs,
} from '~~/server/game/engine/CacheAI'
import type { GameState, PlayerState, CacheState } from '~~/shared/types/game'
import { initializeZoneStates, initializeIce } from '~~/server/game/map/zones'
import {
  CACHE_BUFF_TICKS,
  CACHE_DURATION_TICKS,
  REGEN_CACHE_HEAL_PERCENT,
} from '~~/shared/constants/balance'

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'Player1',
    team: 'chaff',
    heroId: 'echo',
    zone: 'cache-top',
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

function makeCache(overrides: Partial<CacheState> = {}): CacheState {
  return {
    zone: 'cache-top',
    type: 'haste',
    tick: 60,
    ...overrides,
  }
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    tick: 60,
    phase: 'playing',
    teams: {
      chaff: { id: 'chaff', kills: 0, iceKills: 0, gold: 0 },
      audit: { id: 'audit', kills: 0, iceKills: 0, gold: 0 },
    },
    players: {},
    zones: initializeZoneStates(),
    waves: [],
    neutrals: [],
    ice: initializeIce(),
    caches: [],
    tenant: { alive: true, hp: 5000, maxHp: 5000, deathTick: null },
    backup: null,
    events: [],
    ...overrides,
  }
}

describe('CacheAI', () => {
  describe('getCacheBuff', () => {
    it('should return haste buff with correct duration', () => {
      const buff = getCacheBuff('haste')
      expect(buff.id).toBe('haste')
      expect(buff.ticksRemaining).toBe(CACHE_BUFF_TICKS.haste)
      expect(buff.source).toBe('cache_haste')
    })

    it('should return dd (double damage) buff', () => {
      const buff = getCacheBuff('dd')
      expect(buff.id).toBe('dd')
      expect(buff.ticksRemaining).toBe(CACHE_BUFF_TICKS.dd)
      expect(buff.source).toBe('cache_dd')
    })

    it('should return regen buff', () => {
      const buff = getCacheBuff('regen')
      expect(buff.id).toBe('regen')
      expect(buff.ticksRemaining).toBe(CACHE_BUFF_TICKS.regen)
      expect(buff.source).toBe('cache_regen')
    })

    it('should return arcane buff', () => {
      const buff = getCacheBuff('arcane')
      expect(buff.id).toBe('arcane')
      expect(buff.ticksRemaining).toBe(CACHE_BUFF_TICKS.arcane)
      expect(buff.source).toBe('cache_arcane')
    })

    it('should return invis buff', () => {
      const buff = getCacheBuff('invis')
      expect(buff.id).toBe('invis')
      expect(buff.ticksRemaining).toBe(CACHE_BUFF_TICKS.invis)
      expect(buff.source).toBe('cache_invis')
    })

    it('should return stacks of 1 for all caches', () => {
      const cacheTypes: Array<'haste' | 'dd' | 'regen' | 'arcane' | 'invis'> = [
        'haste',
        'dd',
        'regen',
        'arcane',
        'invis',
      ]
      for (const type of cacheTypes) {
        const buff = getCacheBuff(type)
        expect(buff.stacks).toBe(1)
      }
    })
  })

  describe('pickupCache', () => {
    it('should add cache buff to player', () => {
      const state = makeGameState({
        tick: 60,
        caches: [makeCache({ zone: 'cache-top', type: 'haste', tick: 60 })],
        players: {
          p1: makePlayer({ id: 'p1', zone: 'cache-top' }),
        },
      })

      const result = pickupCache(state, 'p1', 'cache-top')
      const hasteBuff = result.state.players['p1']!.buffs.find((b) => b.id === 'haste')
      expect(hasteBuff).toBeDefined()
    })

    it('should remove cache from ground', () => {
      const state = makeGameState({
        tick: 60,
        caches: [makeCache({ zone: 'cache-top', type: 'haste', tick: 60 })],
        players: {
          p1: makePlayer({ id: 'p1', zone: 'cache-top' }),
        },
      })

      const result = pickupCache(state, 'p1', 'cache-top')
      expect(result.state.caches).toHaveLength(0)
    })

    it('should fail if player not in same zone', () => {
      const state = makeGameState({
        caches: [makeCache({ zone: 'cache-top' })],
        players: {
          p1: makePlayer({ id: 'p1', zone: 'cache-bot' }),
        },
      })

      const result = pickupCache(state, 'p1', 'cache-top')
      expect(result.state.caches).toHaveLength(1)
      expect(result.state.players['p1']!.buffs).toHaveLength(0)
    })

    it('should fail if player is dead', () => {
      const state = makeGameState({
        caches: [makeCache({ zone: 'cache-top' })],
        players: {
          p1: makePlayer({ id: 'p1', zone: 'cache-top', alive: false }),
        },
      })

      const result = pickupCache(state, 'p1', 'cache-top')
      expect(result.state.caches).toHaveLength(1)
      expect(result.state.players['p1']!.buffs).toHaveLength(0)
    })

    it('should fail if no cache in zone', () => {
      const state = makeGameState({
        caches: [],
        players: {
          p1: makePlayer({ id: 'p1', zone: 'cache-top' }),
        },
      })

      const result = pickupCache(state, 'p1', 'cache-top')
      expect(result.state.players['p1']!.buffs).toHaveLength(0)
    })

    it('should handle non-existent player', () => {
      const state = makeGameState({
        caches: [makeCache({ zone: 'cache-top' })],
      })

      const result = pickupCache(state, 'nonexistent', 'cache-top')
      expect(result.state.caches).toHaveLength(1)
    })

    it('should emit cache_picked event', () => {
      const state = makeGameState({
        tick: 60,
        caches: [makeCache({ zone: 'cache-top', type: 'haste', tick: 60 })],
        players: {
          p1: makePlayer({ id: 'p1', zone: 'cache-top' }),
        },
      })

      const result = pickupCache(state, 'p1', 'cache-top')
      expect(result.event).not.toBeNull()
      expect(result.event!._tag).toBe('cache_picked')
    })

    it('should pickup dd cache correctly', () => {
      const state = makeGameState({
        tick: 60,
        caches: [makeCache({ zone: 'cache-top', type: 'dd', tick: 60 })],
        players: {
          p1: makePlayer({ id: 'p1', zone: 'cache-top' }),
        },
      })

      const result = pickupCache(state, 'p1', 'cache-top')
      const ddBuff = result.state.players['p1']!.buffs.find((b) => b.id === 'dd')
      expect(ddBuff).toBeDefined()
    })

    it('should pickup regen cache correctly', () => {
      const state = makeGameState({
        tick: 60,
        caches: [makeCache({ zone: 'cache-top', type: 'regen', tick: 60 })],
        players: {
          p1: makePlayer({ id: 'p1', zone: 'cache-top' }),
        },
      })

      const result = pickupCache(state, 'p1', 'cache-top')
      const regenBuff = result.state.players['p1']!.buffs.find((b) => b.id === 'regen')
      expect(regenBuff).toBeDefined()
    })

    it('should pickup arcane cache correctly', () => {
      const state = makeGameState({
        tick: 60,
        caches: [makeCache({ zone: 'cache-top', type: 'arcane', tick: 60 })],
        players: {
          p1: makePlayer({ id: 'p1', zone: 'cache-top' }),
        },
      })

      const result = pickupCache(state, 'p1', 'cache-top')
      const arcaneBuff = result.state.players['p1']!.buffs.find((b) => b.id === 'arcane')
      expect(arcaneBuff).toBeDefined()
    })

    it('should pickup invis cache correctly', () => {
      const state = makeGameState({
        tick: 60,
        caches: [makeCache({ zone: 'cache-top', type: 'invis', tick: 60 })],
        players: {
          p1: makePlayer({ id: 'p1', zone: 'cache-top' }),
        },
      })

      const result = pickupCache(state, 'p1', 'cache-top')
      const invisBuff = result.state.players['p1']!.buffs.find((b) => b.id === 'invis')
      expect(invisBuff).toBeDefined()
    })

    it('should handle undefined caches array', () => {
      const state = makeGameState({
        caches: undefined as unknown as CacheState[],
        players: {
          p1: makePlayer({ id: 'p1', zone: 'cache-top' }),
        },
      })

      const result = pickupCache(state, 'p1', 'cache-top')
      expect(result.state.players['p1']!.buffs).toHaveLength(0)
    })
  })

  describe('removeExpiredCaches', () => {
    it('should remove expired caches', () => {
      const spawnTick = 60
      const state = makeGameState({
        tick: spawnTick + CACHE_DURATION_TICKS,
        caches: [makeCache({ zone: 'cache-top', tick: spawnTick })],
      })

      const result = removeExpiredCaches(state)
      expect(result.caches).toHaveLength(0)
    })

    it('should keep non-expired caches', () => {
      const spawnTick = 60
      const state = makeGameState({
        tick: spawnTick + CACHE_DURATION_TICKS - 1,
        caches: [makeCache({ zone: 'cache-top', tick: spawnTick })],
      })

      const result = removeExpiredCaches(state)
      expect(result.caches).toHaveLength(1)
    })

    it('should handle multiple caches with different ages', () => {
      const state = makeGameState({
        tick: 85,
        caches: [
          makeCache({ zone: 'cache-top', tick: 60 }),
          makeCache({ zone: 'cache-bot', tick: 60 }),
        ],
      })

      const result = removeExpiredCaches(state)
      expect(result.caches).toHaveLength(2)
    })

    it('should return unchanged state if no caches expire', () => {
      const state = makeGameState({
        tick: 65,
        caches: [makeCache({ zone: 'cache-top', tick: 60 })],
      })

      const result = removeExpiredCaches(state)
      expect(result.caches).toHaveLength(1)
    })

    it('should handle empty caches array', () => {
      const state = makeGameState({
        caches: [],
      })

      const result = removeExpiredCaches(state)
      expect(result.caches).toHaveLength(0)
    })

    it('should handle undefined caches array', () => {
      const state = makeGameState({
        caches: undefined as unknown as CacheState[],
      })

      const result = removeExpiredCaches(state)
      expect(result.caches).toHaveLength(0)
    })
  })

  describe('processCacheBuffs', () => {
    it('should heal player with regen buff', () => {
      const state = makeGameState({
        tick: 60,
        players: {
          p1: makePlayer({
            id: 'p1',
            hp: 400,
            maxHp: 500,
            mp: 100,
            maxMp: 200,
            buffs: [{ id: 'regen', stacks: 1, ticksRemaining: 15, source: 'cache_regen' }],
          }),
        },
      })

      const result = processCacheBuffs(state)
      expect(result.players['p1']!.hp).toBeGreaterThan(400)
      expect(result.players['p1']!.mp).toBeGreaterThan(100)
    })

    it('heals Cron’s crontabHeal buff by the per-tick amount in its stacks (was dead)', () => {
      const state = makeGameState({
        tick: 60,
        players: {
          p1: makePlayer({
            id: 'p1',
            hp: 400,
            maxHp: 1000,
            buffs: [{ id: 'crontabHeal', stacks: 110, ticksRemaining: 4, source: 'cron' }],
          }),
        },
      })

      const result = processCacheBuffs(state)
      // The buff was applied but never processed — now it heals `stacks` per tick.
      expect(result.players['p1']!.hp).toBe(510)
    })

    it('restores mana from Cron’s crontabMana buff (the advertised MP half of Crontab)', () => {
      const state = makeGameState({
        tick: 60,
        players: {
          p1: makePlayer({
            id: 'p1',
            mp: 200,
            maxMp: 1000,
            buffs: [{ id: 'crontabMana', stacks: 15, ticksRemaining: 4, source: 'cron' }],
          }),
        },
      })

      const result = processCacheBuffs(state)
      // Crontab's mpPerTick (15) was advertised in the event + description but
      // never applied; the crontabMana buff now restores `stacks` MP per tick.
      expect(result.players['p1']!.mp).toBe(215)
    })

    it('should heal REGEN_CACHE_HEAL_PERCENT of max HP per tick with regen', () => {
      const maxHp = 500
      const expectedHeal = Math.floor(maxHp * REGEN_CACHE_HEAL_PERCENT)
      const state = makeGameState({
        tick: 60,
        players: {
          p1: makePlayer({
            id: 'p1',
            hp: 400,
            maxHp,
            buffs: [{ id: 'regen', stacks: 1, ticksRemaining: 15, source: 'cache_regen' }],
          }),
        },
      })

      const result = processCacheBuffs(state)
      expect(result.players['p1']!.hp).toBe(400 + expectedHeal)
    })

    it('should heal REGEN_CACHE_HEAL_PERCENT of max MP per tick with regen', () => {
      const maxMp = 200
      const expectedHeal = Math.floor(maxMp * REGEN_CACHE_HEAL_PERCENT)
      const state = makeGameState({
        tick: 60,
        players: {
          p1: makePlayer({
            id: 'p1',
            mp: 100,
            maxMp,
            buffs: [{ id: 'regen', stacks: 1, ticksRemaining: 15, source: 'cache_regen' }],
          }),
        },
      })

      const result = processCacheBuffs(state)
      expect(result.players['p1']!.mp).toBe(100 + expectedHeal)
    })

    it('should not exceed max HP with regen', () => {
      const state = makeGameState({
        tick: 60,
        players: {
          p1: makePlayer({
            id: 'p1',
            hp: 490,
            maxHp: 500,
            buffs: [{ id: 'regen', stacks: 1, ticksRemaining: 15, source: 'cache_regen' }],
          }),
        },
      })

      const result = processCacheBuffs(state)
      expect(result.players['p1']!.hp).toBe(500)
    })

    it('should not exceed max MP with regen', () => {
      const state = makeGameState({
        tick: 60,
        players: {
          p1: makePlayer({
            id: 'p1',
            mp: 195,
            maxMp: 200,
            buffs: [{ id: 'regen', stacks: 1, ticksRemaining: 15, source: 'cache_regen' }],
          }),
        },
      })

      const result = processCacheBuffs(state)
      expect(result.players['p1']!.mp).toBe(200)
    })

    it('should not affect players without regen buff', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            hp: 400,
            mp: 100,
            buffs: [],
          }),
        },
      })

      const result = processCacheBuffs(state)
      expect(result.players['p1']!.hp).toBe(400)
      expect(result.players['p1']!.mp).toBe(100)
    })

    it('should not affect dead players', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            hp: 0,
            alive: false,
            buffs: [{ id: 'regen', stacks: 1, ticksRemaining: 15, source: 'cache_regen' }],
          }),
        },
      })

      const result = processCacheBuffs(state)
      expect(result.players['p1']!.hp).toBe(0)
    })

    it('should not modify state for haste buff', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            hp: 400,
            buffs: [{ id: 'haste', stacks: 1, ticksRemaining: 15, source: 'cache_haste' }],
          }),
        },
      })

      const result = processCacheBuffs(state)
      expect(result.players['p1']!.hp).toBe(400)
    })

    it('should not modify state for dd buff', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            hp: 400,
            buffs: [{ id: 'dd', stacks: 1, ticksRemaining: 15, source: 'cache_dd' }],
          }),
        },
      })

      const result = processCacheBuffs(state)
      expect(result.players['p1']!.hp).toBe(400)
    })

    it('should not modify state for arcane buff', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            hp: 400,
            mp: 100,
            buffs: [{ id: 'arcane', stacks: 1, ticksRemaining: 15, source: 'cache_arcane' }],
          }),
        },
      })

      const result = processCacheBuffs(state)
      expect(result.players['p1']!.hp).toBe(400)
      expect(result.players['p1']!.mp).toBe(100)
    })

    it('should not modify state for invis buff', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            hp: 400,
            buffs: [{ id: 'invis', stacks: 1, ticksRemaining: 15, source: 'cache_invis' }],
          }),
        },
      })

      const result = processCacheBuffs(state)
      expect(result.players['p1']!.hp).toBe(400)
    })

    it('should handle multiple players with regen buff', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            hp: 400,
            maxHp: 500,
            buffs: [{ id: 'regen', stacks: 1, ticksRemaining: 15, source: 'cache_regen' }],
          }),
          p2: makePlayer({
            id: 'p2',
            hp: 300,
            maxHp: 600,
            buffs: [{ id: 'regen', stacks: 1, ticksRemaining: 15, source: 'cache_regen' }],
          }),
        },
      })

      const result = processCacheBuffs(state)
      expect(result.players['p1']!.hp).toBeGreaterThan(400)
      expect(result.players['p2']!.hp).toBeGreaterThan(300)
    })

    it('should handle player with multiple buffs including regen', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            hp: 400,
            maxHp: 500,
            mp: 100,
            maxMp: 200,
            buffs: [
              { id: 'haste', stacks: 1, ticksRemaining: 10, source: 'cache_haste' },
              { id: 'regen', stacks: 1, ticksRemaining: 15, source: 'cache_regen' },
            ],
          }),
        },
      })

      const result = processCacheBuffs(state)
      expect(result.players['p1']!.hp).toBeGreaterThan(400)
      expect(result.players['p1']!.buffs).toHaveLength(2)
    })
  })

  describe('edge cases', () => {
    it('should handle cache pickup at exact expiry tick', () => {
      const spawnTick = 60
      const state = makeGameState({
        tick: spawnTick + CACHE_DURATION_TICKS - 1,
        caches: [makeCache({ zone: 'cache-top', type: 'haste', tick: spawnTick })],
        players: {
          p1: makePlayer({ id: 'p1', zone: 'cache-top' }),
        },
      })

      const result = pickupCache(state, 'p1', 'cache-top')
      expect(result.state.players['p1']!.buffs).toHaveLength(1)
    })

    it('should handle regen at full HP and MP', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            hp: 500,
            maxHp: 500,
            mp: 200,
            maxMp: 200,
            buffs: [{ id: 'regen', stacks: 1, ticksRemaining: 15, source: 'cache_regen' }],
          }),
        },
      })

      const result = processCacheBuffs(state)
      expect(result.players['p1']!.hp).toBe(500)
      expect(result.players['p1']!.mp).toBe(200)
    })

    it('should handle player with only HP missing', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            hp: 400,
            maxHp: 500,
            mp: 200,
            maxMp: 200,
            buffs: [{ id: 'regen', stacks: 1, ticksRemaining: 15, source: 'cache_regen' }],
          }),
        },
      })

      const result = processCacheBuffs(state)
      expect(result.players['p1']!.hp).toBeGreaterThan(400)
      expect(result.players['p1']!.mp).toBe(200)
    })

    it('should handle player with only MP missing', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            hp: 500,
            maxHp: 500,
            mp: 100,
            maxMp: 200,
            buffs: [{ id: 'regen', stacks: 1, ticksRemaining: 15, source: 'cache_regen' }],
          }),
        },
      })

      const result = processCacheBuffs(state)
      expect(result.players['p1']!.hp).toBe(500)
      expect(result.players['p1']!.mp).toBeGreaterThan(100)
    })
  })
})
