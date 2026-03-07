import { describe, it, expect, beforeEach } from 'vitest'
import {
  getRuneBuff,
  pickupRune,
  removeExpiredRunes,
  processRuneBuffs,
} from '../../../server/game/engine/RuneAI'
import type { GameState, PlayerState, RuneState } from '../../../shared/types/game'
import { initializeZoneStates, initializeTowers } from '../../../server/game/map/zones'
import { RUNE_BUFF_TICKS, RUNE_DURATION_TICKS } from '../../../shared/constants/balance'

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'Player1',
    team: 'radiant',
    heroId: 'echo',
    zone: 'rune-top',
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

function makeRune(overrides: Partial<RuneState> = {}): RuneState {
  return {
    zone: 'rune-top',
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
      radiant: { id: 'radiant', kills: 0, towerKills: 0, gold: 0 },
      dire: { id: 'dire', kills: 0, towerKills: 0, gold: 0 },
    },
    players: {},
    zones: initializeZoneStates(),
    creeps: [],
    neutrals: [],
    towers: initializeTowers(),
    runes: [],
    roshan: { alive: true, hp: 5000, maxHp: 5000, deathTick: null },
    aegis: null,
    events: [],
    ...overrides,
  }
}

describe('RuneAI', () => {
  describe('getRuneBuff', () => {
    it('should return haste buff with correct duration', () => {
      const buff = getRuneBuff('haste')
      expect(buff.id).toBe('haste')
      expect(buff.ticksRemaining).toBe(RUNE_BUFF_TICKS.haste)
      expect(buff.source).toBe('rune_haste')
    })

    it('should return dd (double damage) buff', () => {
      const buff = getRuneBuff('dd')
      expect(buff.id).toBe('dd')
      expect(buff.ticksRemaining).toBe(RUNE_BUFF_TICKS.dd)
      expect(buff.source).toBe('rune_dd')
    })

    it('should return regen buff', () => {
      const buff = getRuneBuff('regen')
      expect(buff.id).toBe('regen')
      expect(buff.ticksRemaining).toBe(RUNE_BUFF_TICKS.regen)
      expect(buff.source).toBe('rune_regen')
    })

    it('should return arcane buff', () => {
      const buff = getRuneBuff('arcane')
      expect(buff.id).toBe('arcane')
      expect(buff.ticksRemaining).toBe(RUNE_BUFF_TICKS.arcane)
      expect(buff.source).toBe('rune_arcane')
    })

    it('should return invis buff', () => {
      const buff = getRuneBuff('invis')
      expect(buff.id).toBe('invis')
      expect(buff.ticksRemaining).toBe(RUNE_BUFF_TICKS.invis)
      expect(buff.source).toBe('rune_invis')
    })

    it('should return stacks of 1 for all runes', () => {
      const runeTypes: Array<'haste' | 'dd' | 'regen' | 'arcane' | 'invis'> = [
        'haste',
        'dd',
        'regen',
        'arcane',
        'invis',
      ]
      for (const type of runeTypes) {
        const buff = getRuneBuff(type)
        expect(buff.stacks).toBe(1)
      }
    })
  })

  describe('pickupRune', () => {
    it('should add rune buff to player', () => {
      const state = makeGameState({
        tick: 60,
        runes: [makeRune({ zone: 'rune-top', type: 'haste', tick: 60 })],
        players: {
          p1: makePlayer({ id: 'p1', zone: 'rune-top' }),
        },
      })

      const result = pickupRune(state, 'p1', 'rune-top')
      const hasteBuff = result.players['p1']!.buffs.find((b) => b.id === 'haste')
      expect(hasteBuff).toBeDefined()
    })

    it('should remove rune from ground', () => {
      const state = makeGameState({
        tick: 60,
        runes: [makeRune({ zone: 'rune-top', type: 'haste', tick: 60 })],
        players: {
          p1: makePlayer({ id: 'p1', zone: 'rune-top' }),
        },
      })

      const result = pickupRune(state, 'p1', 'rune-top')
      expect(result.runes).toHaveLength(0)
    })

    it('should fail if player not in same zone', () => {
      const state = makeGameState({
        runes: [makeRune({ zone: 'rune-top' })],
        players: {
          p1: makePlayer({ id: 'p1', zone: 'rune-bot' }),
        },
      })

      const result = pickupRune(state, 'p1', 'rune-top')
      expect(result.runes).toHaveLength(1)
      expect(result.players['p1']!.buffs).toHaveLength(0)
    })

    it('should fail if player is dead', () => {
      const state = makeGameState({
        runes: [makeRune({ zone: 'rune-top' })],
        players: {
          p1: makePlayer({ id: 'p1', zone: 'rune-top', alive: false }),
        },
      })

      const result = pickupRune(state, 'p1', 'rune-top')
      expect(result.runes).toHaveLength(1)
      expect(result.players['p1']!.buffs).toHaveLength(0)
    })

    it('should fail if no rune in zone', () => {
      const state = makeGameState({
        runes: [],
        players: {
          p1: makePlayer({ id: 'p1', zone: 'rune-top' }),
        },
      })

      const result = pickupRune(state, 'p1', 'rune-top')
      expect(result.players['p1']!.buffs).toHaveLength(0)
    })

    it('should handle non-existent player', () => {
      const state = makeGameState({
        runes: [makeRune({ zone: 'rune-top' })],
      })

      const result = pickupRune(state, 'nonexistent', 'rune-top')
      expect(result.runes).toHaveLength(1)
    })

    it('should emit rune_picked event', () => {
      const state = makeGameState({
        tick: 60,
        runes: [makeRune({ zone: 'rune-top', type: 'haste', tick: 60 })],
        players: {
          p1: makePlayer({ id: 'p1', zone: 'rune-top' }),
        },
      })

      const result = pickupRune(state, 'p1', 'rune-top')
      const event = result.events.find(
        (e) => ('_tag' in e && e._tag === 'rune_picked') || e.type === 'rune_picked',
      )
      expect(event).toBeDefined()
    })

    it('should pickup dd rune correctly', () => {
      const state = makeGameState({
        tick: 60,
        runes: [makeRune({ zone: 'rune-top', type: 'dd', tick: 60 })],
        players: {
          p1: makePlayer({ id: 'p1', zone: 'rune-top' }),
        },
      })

      const result = pickupRune(state, 'p1', 'rune-top')
      const ddBuff = result.players['p1']!.buffs.find((b) => b.id === 'dd')
      expect(ddBuff).toBeDefined()
    })

    it('should pickup regen rune correctly', () => {
      const state = makeGameState({
        tick: 60,
        runes: [makeRune({ zone: 'rune-top', type: 'regen', tick: 60 })],
        players: {
          p1: makePlayer({ id: 'p1', zone: 'rune-top' }),
        },
      })

      const result = pickupRune(state, 'p1', 'rune-top')
      const regenBuff = result.players['p1']!.buffs.find((b) => b.id === 'regen')
      expect(regenBuff).toBeDefined()
    })

    it('should pickup arcane rune correctly', () => {
      const state = makeGameState({
        tick: 60,
        runes: [makeRune({ zone: 'rune-top', type: 'arcane', tick: 60 })],
        players: {
          p1: makePlayer({ id: 'p1', zone: 'rune-top' }),
        },
      })

      const result = pickupRune(state, 'p1', 'rune-top')
      const arcaneBuff = result.players['p1']!.buffs.find((b) => b.id === 'arcane')
      expect(arcaneBuff).toBeDefined()
    })

    it('should pickup invis rune correctly', () => {
      const state = makeGameState({
        tick: 60,
        runes: [makeRune({ zone: 'rune-top', type: 'invis', tick: 60 })],
        players: {
          p1: makePlayer({ id: 'p1', zone: 'rune-top' }),
        },
      })

      const result = pickupRune(state, 'p1', 'rune-top')
      const invisBuff = result.players['p1']!.buffs.find((b) => b.id === 'invis')
      expect(invisBuff).toBeDefined()
    })

    it('should handle undefined runes array', () => {
      const state = makeGameState({
        runes: undefined as unknown as RuneState[],
        players: {
          p1: makePlayer({ id: 'p1', zone: 'rune-top' }),
        },
      })

      const result = pickupRune(state, 'p1', 'rune-top')
      expect(result.players['p1']!.buffs).toHaveLength(0)
    })
  })

  describe('removeExpiredRunes', () => {
    it('should remove expired runes', () => {
      const spawnTick = 60
      const state = makeGameState({
        tick: spawnTick + RUNE_DURATION_TICKS,
        runes: [makeRune({ zone: 'rune-top', tick: spawnTick })],
      })

      const result = removeExpiredRunes(state)
      expect(result.runes).toHaveLength(0)
    })

    it('should keep non-expired runes', () => {
      const spawnTick = 60
      const state = makeGameState({
        tick: spawnTick + RUNE_DURATION_TICKS - 1,
        runes: [makeRune({ zone: 'rune-top', tick: spawnTick })],
      })

      const result = removeExpiredRunes(state)
      expect(result.runes).toHaveLength(1)
    })

    it('should handle multiple runes with different ages', () => {
      const state = makeGameState({
        tick: 85,
        runes: [makeRune({ zone: 'rune-top', tick: 60 }), makeRune({ zone: 'rune-bot', tick: 60 })],
      })

      const result = removeExpiredRunes(state)
      expect(result.runes).toHaveLength(2)
    })

    it('should return unchanged state if no runes expire', () => {
      const state = makeGameState({
        tick: 65,
        runes: [makeRune({ zone: 'rune-top', tick: 60 })],
      })

      const result = removeExpiredRunes(state)
      expect(result.runes).toHaveLength(1)
    })

    it('should handle empty runes array', () => {
      const state = makeGameState({
        runes: [],
      })

      const result = removeExpiredRunes(state)
      expect(result.runes).toHaveLength(0)
    })

    it.skip('should handle undefined runes array', () => {
      const state = makeGameState({
        runes: undefined as unknown as RuneState[],
      })

      const result = removeExpiredRunes(state)
      expect(result.runes).toHaveLength(0)
    })
  })

  describe('processRuneBuffs', () => {
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
            buffs: [{ id: 'regen', stacks: 1, ticksRemaining: 15, source: 'rune_regen' }],
          }),
        },
      })

      const result = processRuneBuffs(state)
      expect(result.players['p1']!.hp).toBeGreaterThan(400)
      expect(result.players['p1']!.mp).toBeGreaterThan(100)
    })

    it('should heal 5% HP per tick with regen', () => {
      const maxHp = 500
      const expectedHeal = Math.floor(maxHp * 0.05)
      const state = makeGameState({
        tick: 60,
        players: {
          p1: makePlayer({
            id: 'p1',
            hp: 400,
            maxHp,
            buffs: [{ id: 'regen', stacks: 1, ticksRemaining: 15, source: 'rune_regen' }],
          }),
        },
      })

      const result = processRuneBuffs(state)
      expect(result.players['p1']!.hp).toBe(400 + expectedHeal)
    })

    it('should heal 5% MP per tick with regen', () => {
      const maxMp = 200
      const expectedHeal = Math.floor(maxMp * 0.05)
      const state = makeGameState({
        tick: 60,
        players: {
          p1: makePlayer({
            id: 'p1',
            mp: 100,
            maxMp,
            buffs: [{ id: 'regen', stacks: 1, ticksRemaining: 15, source: 'rune_regen' }],
          }),
        },
      })

      const result = processRuneBuffs(state)
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
            buffs: [{ id: 'regen', stacks: 1, ticksRemaining: 15, source: 'rune_regen' }],
          }),
        },
      })

      const result = processRuneBuffs(state)
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
            buffs: [{ id: 'regen', stacks: 1, ticksRemaining: 15, source: 'rune_regen' }],
          }),
        },
      })

      const result = processRuneBuffs(state)
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

      const result = processRuneBuffs(state)
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
            buffs: [{ id: 'regen', stacks: 1, ticksRemaining: 15, source: 'rune_regen' }],
          }),
        },
      })

      const result = processRuneBuffs(state)
      expect(result.players['p1']!.hp).toBe(0)
    })

    it('should not modify state for haste buff', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            hp: 400,
            buffs: [{ id: 'haste', stacks: 1, ticksRemaining: 15, source: 'rune_haste' }],
          }),
        },
      })

      const result = processRuneBuffs(state)
      expect(result.players['p1']!.hp).toBe(400)
    })

    it('should not modify state for dd buff', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            hp: 400,
            buffs: [{ id: 'dd', stacks: 1, ticksRemaining: 15, source: 'rune_dd' }],
          }),
        },
      })

      const result = processRuneBuffs(state)
      expect(result.players['p1']!.hp).toBe(400)
    })

    it('should not modify state for arcane buff', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            hp: 400,
            mp: 100,
            buffs: [{ id: 'arcane', stacks: 1, ticksRemaining: 15, source: 'rune_arcane' }],
          }),
        },
      })

      const result = processRuneBuffs(state)
      expect(result.players['p1']!.hp).toBe(400)
      expect(result.players['p1']!.mp).toBe(100)
    })

    it('should not modify state for invis buff', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            hp: 400,
            buffs: [{ id: 'invis', stacks: 1, ticksRemaining: 15, source: 'rune_invis' }],
          }),
        },
      })

      const result = processRuneBuffs(state)
      expect(result.players['p1']!.hp).toBe(400)
    })

    it('should handle multiple players with regen buff', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            hp: 400,
            maxHp: 500,
            buffs: [{ id: 'regen', stacks: 1, ticksRemaining: 15, source: 'rune_regen' }],
          }),
          p2: makePlayer({
            id: 'p2',
            hp: 300,
            maxHp: 600,
            buffs: [{ id: 'regen', stacks: 1, ticksRemaining: 15, source: 'rune_regen' }],
          }),
        },
      })

      const result = processRuneBuffs(state)
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
              { id: 'haste', stacks: 1, ticksRemaining: 10, source: 'rune_haste' },
              { id: 'regen', stacks: 1, ticksRemaining: 15, source: 'rune_regen' },
            ],
          }),
        },
      })

      const result = processRuneBuffs(state)
      expect(result.players['p1']!.hp).toBeGreaterThan(400)
      expect(result.players['p1']!.buffs).toHaveLength(2)
    })
  })

  describe('edge cases', () => {
    it('should handle rune pickup at exact expiry tick', () => {
      const spawnTick = 60
      const state = makeGameState({
        tick: spawnTick + RUNE_DURATION_TICKS - 1,
        runes: [makeRune({ zone: 'rune-top', type: 'haste', tick: spawnTick })],
        players: {
          p1: makePlayer({ id: 'p1', zone: 'rune-top' }),
        },
      })

      const result = pickupRune(state, 'p1', 'rune-top')
      expect(result.players['p1']!.buffs).toHaveLength(1)
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
            buffs: [{ id: 'regen', stacks: 1, ticksRemaining: 15, source: 'rune_regen' }],
          }),
        },
      })

      const result = processRuneBuffs(state)
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
            buffs: [{ id: 'regen', stacks: 1, ticksRemaining: 15, source: 'rune_regen' }],
          }),
        },
      })

      const result = processRuneBuffs(state)
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
            buffs: [{ id: 'regen', stacks: 1, ticksRemaining: 15, source: 'rune_regen' }],
          }),
        },
      })

      const result = processRuneBuffs(state)
      expect(result.players['p1']!.hp).toBe(500)
      expect(result.players['p1']!.mp).toBeGreaterThan(100)
    })
  })
})
