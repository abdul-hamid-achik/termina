import { describe, it, expect, beforeEach } from 'vitest'
import { Effect } from 'effect'
import {
  processDoTs,
  tickAllBuffs,
  levelUpHero,
  dealDamage,
  applyBuff,
  tickBuffs,
  removeBuff,
  hasBuff,
  getBuffStacks,
  updatePlayer,
  updatePlayers,
  addEvent,
  getAbilityLevel,
  scaleValue,
  getPlayerCombatStats,
  findTargetPlayer,
  getPlayersInZone,
  getEnemiesInZone,
  getAlliesInZone,
  getAllEnemyPlayers,
  healPlayer,
  deductMana,
  setCooldown,
  resetAllCooldowns,
  resolveAbility,
  InsufficientManaError,
  CooldownError,
  InvalidTargetError,
  registerHero,
  getHeroResolver,
} from '../../../server/game/heroes/_base'
import type { GameState, PlayerState, BuffState, GameEvent } from '../../../shared/types/game'
import { initializeZoneStates, initializeTowers } from '../../../server/game/map/zones'
import { HEROES } from '../../../shared/constants/heroes'

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
    neutrals: [],
    towers: initializeTowers(),
    runes: [],
    roshan: { alive: true, hp: 5000, maxHp: 5000, deathTick: null },
    aegis: null,
    events: [],
    ...overrides,
  }
}

describe('_base hero utilities', () => {
  describe('processDoTs', () => {
    it('should apply damage from DoT buffs', () => {
      const player = makePlayer({
        hp: 500,
        buffs: [{ id: 'phys_dot', stacks: 20, ticksRemaining: 5, source: 'test' }],
      })
      const state = makeGameState({ players: { p1: player } })

      const result = processDoTs(state)
      expect(result.players['p1']!.hp).toBeLessThan(500)
    })

    it('should apply multiple DoT buffs', () => {
      const player = makePlayer({
        hp: 500,
        buffs: [
          { id: 'phys_dot', stacks: 20, ticksRemaining: 5, source: 'test' },
          { id: 'magic_dot', stacks: 30, ticksRemaining: 5, source: 'test' },
        ],
      })
      const state = makeGameState({ players: { p1: player } })

      const result = processDoTs(state)
      expect(result.players['p1']!.hp).toBeLessThan(500)
    })

    it('should not affect players without DoT buffs', () => {
      const player = makePlayer({ hp: 500 })
      const state = makeGameState({ players: { p1: player } })

      const result = processDoTs(state)
      expect(result.players['p1']!.hp).toBe(500)
    })

    it('should not affect dead players', () => {
      const player = makePlayer({
        hp: 0,
        alive: false,
        buffs: [{ id: 'phys_dot', stacks: 20, ticksRemaining: 5, source: 'test' }],
      })
      const state = makeGameState({ players: { p1: player } })

      const result = processDoTs(state)
      expect(result.players['p1']!.hp).toBe(0)
    })

    it('should kill player if DoT damage exceeds HP', () => {
      const player = makePlayer({
        hp: 5,
        buffs: [{ id: 'phys_dot', stacks: 100, ticksRemaining: 5, source: 'test' }],
      })
      const state = makeGameState({ players: { p1: player } })

      const result = processDoTs(state)
      expect(result.players['p1']!.hp).toBe(0)
      expect(result.players['p1']!.alive).toBe(false)
    })
  })

  describe('tickAllBuffs', () => {
    it('should decrement ticksRemaining on all buffs', () => {
      const player = makePlayer({
        buffs: [{ id: 'test_buff', stacks: 1, ticksRemaining: 5, source: 'test' }],
      })
      const state = makeGameState({ players: { p1: player } })

      const result = tickAllBuffs(state)
      expect(result.players['p1']!.buffs[0]!.ticksRemaining).toBe(4)
    })

    it('should remove expired buffs', () => {
      const player = makePlayer({
        buffs: [{ id: 'expiring', stacks: 1, ticksRemaining: 1, source: 'test' }],
      })
      const state = makeGameState({ players: { p1: player } })

      const result = tickAllBuffs(state)
      expect(result.players['p1']!.buffs).toHaveLength(0)
    })

    it('should handle multiple buffs with different durations', () => {
      const player = makePlayer({
        buffs: [
          { id: 'buff1', stacks: 1, ticksRemaining: 5, source: 'test' },
          { id: 'buff2', stacks: 1, ticksRemaining: 1, source: 'test' },
        ],
      })
      const state = makeGameState({ players: { p1: player } })

      const result = tickAllBuffs(state)
      expect(result.players['p1']!.buffs).toHaveLength(1)
      expect(result.players['p1']!.buffs[0]!.id).toBe('buff1')
    })

    it('should not affect dead players', () => {
      const player = makePlayer({
        alive: false,
        buffs: [{ id: 'test', stacks: 1, ticksRemaining: 5, source: 'test' }],
      })
      const state = makeGameState({ players: { p1: player } })

      const result = tickAllBuffs(state)
      expect(result.players['p1']!.buffs[0]!.ticksRemaining).toBe(5)
    })
  })

  describe('levelUpHero', () => {
    it('should increase level', () => {
      const player = makePlayer({ level: 1 })
      const result = levelUpHero(player)
      expect(result.level).toBe(2)
    })

    it('should increase max HP', () => {
      const player = makePlayer({ level: 1, maxHp: 500 })
      const result = levelUpHero(player)
      expect(result.maxHp).toBeGreaterThan(500)
    })

    it('should increase max MP', () => {
      const player = makePlayer({ level: 1, maxMp: 200 })
      const result = levelUpHero(player)
      expect(result.maxMp).toBeGreaterThan(200)
    })

    it('should heal HP on level up', () => {
      const player = makePlayer({ level: 1, hp: 400, maxHp: 500 })
      const result = levelUpHero(player)
      expect(result.hp).toBeGreaterThan(400)
    })

    it('should not exceed max HP on level up', () => {
      const player = makePlayer({ level: 1, hp: 500, maxHp: 500 })
      const result = levelUpHero(player)
      expect(result.hp).toBe(result.maxHp)
    })

    it('should handle hero without definition', () => {
      const player = makePlayer({ heroId: 'nonexistent' })
      const result = levelUpHero(player)
      expect(result.level).toBe(1)
    })
  })

  describe('dealDamage', () => {
    it('should reduce HP', () => {
      const player = makePlayer({ hp: 500 })
      const result = dealDamage(player, 50, 'pure')
      expect(result.hp).toBe(450)
    })

    it('should kill player when HP reaches 0', () => {
      const player = makePlayer({ hp: 50 })
      const result = dealDamage(player, 100, 'pure')
      expect(result.hp).toBe(0)
      expect(result.alive).toBe(false)
    })

    it('should absorb damage with shield buff', () => {
      const player = makePlayer({
        hp: 500,
        buffs: [{ id: 'shield', stacks: 50, ticksRemaining: 5, source: 'test' }],
      })
      const result = dealDamage(player, 30, 'pure')
      expect(result.hp).toBe(500)
      expect(result.buffs.find((b) => b.id === 'shield')!.stacks).toBe(20)
    })

    it('should remove shield when depleted', () => {
      const player = makePlayer({
        hp: 500,
        buffs: [{ id: 'shield', stacks: 20, ticksRemaining: 5, source: 'test' }],
      })
      const result = dealDamage(player, 50, 'pure')
      expect(result.hp).toBe(470)
      expect(result.buffs.find((b) => b.id === 'shield')).toBeUndefined()
    })

    it('should dodge attack with phaseShift buff', () => {
      const player = makePlayer({
        hp: 500,
        buffs: [{ id: 'phaseShift', stacks: 1, ticksRemaining: 5, source: 'test' }],
      })
      const result = dealDamage(player, 100, 'pure')
      expect(result.hp).toBe(500)
      expect(result.buffs.find((b) => b.id === 'phaseShift')).toBeUndefined()
    })

    it('should apply hardened reduction', () => {
      const player = makePlayer({
        hp: 500,
        buffs: [{ id: 'hardened', stacks: 1, ticksRemaining: 5, source: 'test' }],
      })
      const result = dealDamage(player, 100, 'pure')
      expect(result.hp).toBe(410)
    })

    it('should apply firewall damage reduction', () => {
      const player = makePlayer({
        hp: 500,
        buffs: [{ id: 'firewallDefense', stacks: 1, ticksRemaining: 5, source: 'test' }],
      })
      const result = dealDamage(player, 100, 'pure')
      expect(result.hp).toBe(430)
    })
  })

  describe('applyBuff', () => {
    it('should add new buff', () => {
      const player = makePlayer()
      const buff: BuffState = { id: 'test', stacks: 1, ticksRemaining: 5, source: 'test' }
      const result = applyBuff(player, buff)
      expect(result.buffs).toHaveLength(1)
    })

    it('should refresh existing buff duration', () => {
      const player = makePlayer({
        buffs: [{ id: 'test', stacks: 1, ticksRemaining: 2, source: 'test' }],
      })
      const buff: BuffState = { id: 'test', stacks: 1, ticksRemaining: 5, source: 'test' }
      const result = applyBuff(player, buff)
      expect(result.buffs[0]!.ticksRemaining).toBe(5)
    })

    it('should update existing buff stacks', () => {
      const player = makePlayer({
        buffs: [{ id: 'test', stacks: 1, ticksRemaining: 5, source: 'test' }],
      })
      const buff: BuffState = { id: 'test', stacks: 3, ticksRemaining: 5, source: 'test' }
      const result = applyBuff(player, buff)
      expect(result.buffs[0]!.stacks).toBe(3)
    })

    it('should keep max duration when refreshing', () => {
      const player = makePlayer({
        buffs: [{ id: 'test', stacks: 1, ticksRemaining: 10, source: 'test' }],
      })
      const buff: BuffState = { id: 'test', stacks: 1, ticksRemaining: 5, source: 'test' }
      const result = applyBuff(player, buff)
      expect(result.buffs[0]!.ticksRemaining).toBe(10)
    })
  })

  describe('tickBuffs', () => {
    it('should decrement all buff durations', () => {
      const player = makePlayer({
        buffs: [{ id: 'test', stacks: 1, ticksRemaining: 5, source: 'test' }],
      })
      const result = tickBuffs(player)
      expect(result.buffs[0]!.ticksRemaining).toBe(4)
    })

    it('should remove expired buffs', () => {
      const player = makePlayer({
        buffs: [{ id: 'test', stacks: 1, ticksRemaining: 1, source: 'test' }],
      })
      const result = tickBuffs(player)
      expect(result.buffs).toHaveLength(0)
    })
  })

  describe('removeBuff', () => {
    it('should remove buff by id', () => {
      const player = makePlayer({
        buffs: [
          { id: 'buff1', stacks: 1, ticksRemaining: 5, source: 'test' },
          { id: 'buff2', stacks: 1, ticksRemaining: 5, source: 'test' },
        ],
      })
      const result = removeBuff(player, 'buff1')
      expect(result.buffs).toHaveLength(1)
      expect(result.buffs[0]!.id).toBe('buff2')
    })

    it('should handle missing buff', () => {
      const player = makePlayer()
      const result = removeBuff(player, 'nonexistent')
      expect(result.buffs).toHaveLength(0)
    })
  })

  describe('hasBuff', () => {
    it('should return true when buff exists', () => {
      const player = makePlayer({
        buffs: [{ id: 'test', stacks: 1, ticksRemaining: 5, source: 'test' }],
      })
      expect(hasBuff(player, 'test')).toBe(true)
    })

    it('should return false when buff does not exist', () => {
      const player = makePlayer()
      expect(hasBuff(player, 'test')).toBe(false)
    })
  })

  describe('getBuffStacks', () => {
    it('should return buff stacks', () => {
      const player = makePlayer({
        buffs: [{ id: 'test', stacks: 5, ticksRemaining: 5, source: 'test' }],
      })
      expect(getBuffStacks(player, 'test')).toBe(5)
    })

    it('should return 0 when buff does not exist', () => {
      const player = makePlayer()
      expect(getBuffStacks(player, 'test')).toBe(0)
    })
  })

  describe('getAbilityLevel', () => {
    it('should return 0 for Q at level 0', () => {
      expect(getAbilityLevel(0, 'q')).toBe(0)
    })

    it('should return 1 for Q at level 1', () => {
      expect(getAbilityLevel(1, 'q')).toBe(1)
    })

    it('should return 4 for Q at level 7+', () => {
      expect(getAbilityLevel(7, 'q')).toBe(4)
      expect(getAbilityLevel(25, 'q')).toBe(4)
    })

    it('should return 0 for R at level 5', () => {
      expect(getAbilityLevel(5, 'r')).toBe(0)
    })

    it('should return 1 for R at level 6', () => {
      expect(getAbilityLevel(6, 'r')).toBe(1)
    })

    it('should return 3 for R at level 18+', () => {
      expect(getAbilityLevel(18, 'r')).toBe(3)
      expect(getAbilityLevel(25, 'r')).toBe(3)
    })
  })

  describe('scaleValue', () => {
    it('should return 0 for level 0', () => {
      expect(scaleValue([10, 20, 30], 0)).toBe(0)
    })

    it('should return first value for level 1', () => {
      expect(scaleValue([10, 20, 30], 1)).toBe(10)
    })

    it('should return last value for level exceeding array', () => {
      expect(scaleValue([10, 20, 30], 10)).toBe(30)
    })
  })

  describe('getPlayerCombatStats', () => {
    it('should return base stats at level 1', () => {
      const player = makePlayer({ heroId: 'echo', level: 1 })
      const stats = getPlayerCombatStats(player)
      expect(stats.attack).toBeGreaterThan(0)
      expect(stats.defense).toBeGreaterThanOrEqual(0)
    })

    it('should return zero stats for invalid hero', () => {
      const player = makePlayer({ heroId: 'nonexistent' })
      const stats = getPlayerCombatStats(player)
      expect(stats.attack).toBe(0)
      expect(stats.defense).toBe(0)
      expect(stats.magicResist).toBe(0)
    })
  })

  describe('findTargetPlayer', () => {
    it('should find player by heroId', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ id: 'p1', heroId: 'echo' }) },
      })
      const result = findTargetPlayer(state, { kind: 'hero', name: 'echo' })
      expect(result?.id).toBe('p1')
    })

    it('should find player by name', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ id: 'p1', name: 'TestPlayer' }) },
      })
      const result = findTargetPlayer(state, { kind: 'hero', name: 'TestPlayer' })
      expect(result?.id).toBe('p1')
    })

    it('should return undefined for not found', () => {
      const state = makeGameState()
      const result = findTargetPlayer(state, { kind: 'hero', name: 'nonexistent' })
      expect(result).toBeUndefined()
    })
  })

  describe('getPlayersInZone', () => {
    it('should return players in zone', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', zone: 'mid-river' }),
          p2: makePlayer({ id: 'p2', zone: 'mid-river' }),
          p3: makePlayer({ id: 'p3', zone: 'top-river' }),
        },
      })
      const result = getPlayersInZone(state, 'mid-river')
      expect(result).toHaveLength(2)
    })

    it('should exclude dead players', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', zone: 'mid-river', alive: false }),
          p2: makePlayer({ id: 'p2', zone: 'mid-river' }),
        },
      })
      const result = getPlayersInZone(state, 'mid-river')
      expect(result).toHaveLength(1)
    })
  })

  describe('getEnemiesInZone', () => {
    it('should return enemies in zone', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'radiant', zone: 'mid-river' }),
          p2: makePlayer({ id: 'p2', team: 'dire', zone: 'mid-river' }),
        },
      })
      const result = getEnemiesInZone(state, state.players['p1']!)
      expect(result).toHaveLength(1)
      expect(result[0]!.team).toBe('dire')
    })
  })

  describe('getAlliesInZone', () => {
    it('should return allies in zone excluding self', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'radiant', zone: 'mid-river' }),
          p2: makePlayer({ id: 'p2', team: 'radiant', zone: 'mid-river' }),
          p3: makePlayer({ id: 'p3', team: 'dire', zone: 'mid-river' }),
        },
      })
      const result = getAlliesInZone(state, state.players['p1']!)
      expect(result).toHaveLength(1)
      expect(result[0]!.id).toBe('p2')
    })
  })

  describe('getAllEnemyPlayers', () => {
    it('should return all enemy players', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'radiant' }),
          p2: makePlayer({ id: 'p2', team: 'dire' }),
          p3: makePlayer({ id: 'p3', team: 'dire' }),
        },
      })
      const result = getAllEnemyPlayers(state, state.players['p1']!)
      expect(result).toHaveLength(2)
    })

    it('should exclude dead enemies', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'radiant' }),
          p2: makePlayer({ id: 'p2', team: 'dire', alive: false }),
        },
      })
      const result = getAllEnemyPlayers(state, state.players['p1']!)
      expect(result).toHaveLength(0)
    })
  })

  describe('healPlayer', () => {
    it('should heal player', () => {
      const player = makePlayer({ hp: 400, maxHp: 500 })
      const result = healPlayer(player, 50)
      expect(result.hp).toBe(450)
    })

    it('should not exceed maxHp', () => {
      const player = makePlayer({ hp: 480, maxHp: 500 })
      const result = healPlayer(player, 50)
      expect(result.hp).toBe(500)
    })
  })

  describe('deductMana', () => {
    it('should deduct mana', () => {
      const player = makePlayer({ mp: 200 })
      const result = deductMana(player, 50)
      expect(result.mp).toBe(150)
    })

    it('should not go below 0', () => {
      const player = makePlayer({ mp: 30 })
      const result = deductMana(player, 50)
      expect(result.mp).toBe(0)
    })
  })

  describe('setCooldown', () => {
    it('should set cooldown for ability', () => {
      const player = makePlayer()
      const result = setCooldown(player, 'q', 10)
      expect(result.cooldowns.q).toBe(10)
    })
  })

  describe('resetAllCooldowns', () => {
    it('should reset all cooldowns to 0', () => {
      const player = makePlayer({ cooldowns: { q: 5, w: 3, e: 2, r: 1 } })
      const result = resetAllCooldowns(player)
      expect(result.cooldowns).toEqual({ q: 0, w: 0, e: 0, r: 0 })
    })
  })

  describe('updatePlayer', () => {
    it('should update player in state', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ id: 'p1', hp: 500 }) },
      })
      const updatedPlayer = { ...state.players['p1']!, hp: 400 }
      const result = updatePlayer(state, updatedPlayer)
      expect(result.players['p1']!.hp).toBe(400)
    })
  })

  describe('updatePlayers', () => {
    it('should update multiple players', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', hp: 500 }),
          p2: makePlayer({ id: 'p2', hp: 500 }),
        },
      })
      const updated = [
        { ...state.players['p1']!, hp: 400 },
        { ...state.players['p2']!, hp: 300 },
      ]
      const result = updatePlayers(state, updated)
      expect(result.players['p1']!.hp).toBe(400)
      expect(result.players['p2']!.hp).toBe(300)
    })
  })

  describe('addEvent', () => {
    it('should add event to state', () => {
      const state = makeGameState()
      const event: GameEvent = { tick: 1, type: 'test', payload: {} }
      const result = addEvent(state, event)
      expect(result.events).toHaveLength(1)
    })
  })

  describe('hero registry', () => {
    it('should register and retrieve hero resolver', () => {
      const mockResolver = vi.fn()
      const mockPassive = vi.fn()

      registerHero('test_hero', mockResolver as any, mockPassive as any)
      const resolver = getHeroResolver('test_hero')

      expect(resolver).toBeDefined()
    })

    it('should return undefined for unregistered hero', () => {
      const resolver = getHeroResolver('nonexistent')
      expect(resolver).toBeUndefined()
    })
  })
})

import { vi } from 'vitest'
