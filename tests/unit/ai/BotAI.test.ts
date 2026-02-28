import { describe, it, expect } from 'vitest'
import { decideBotAction } from '../../../server/game/ai/BotAI'
import type { GameState, PlayerState, CreepState } from '../../../shared/types/game'
import { initializeZoneStates, initializeTowers } from '../../../server/game/map/zones'

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'bot_alpha',
    name: 'bot_alpha',
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
    ...overrides,
  }
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    tick: 10,
    phase: 'playing',
    teams: {
      radiant: { id: 'radiant', kills: 0, towerKills: 0, gold: 0 },
      dire: { id: 'dire', kills: 0, towerKills: 0, gold: 0 },
    },
    players: {},
    zones: initializeZoneStates(),
    creeps: [],
    towers: initializeTowers(),
    events: [],
    ...overrides,
  }
}

describe('BotAI - decideBotAction', () => {
  describe('dead bot', () => {
    it('returns null when bot is dead', () => {
      const bot = makePlayer({ alive: false, hp: 0 })
      const state = makeGameState({ players: { [bot.id]: bot } })
      expect(decideBotAction(state, bot, 'mid')).toBeNull()
    })
  })

  describe('fountain behavior', () => {
    it('buys items when at fountain with enough gold', () => {
      const bot = makePlayer({ zone: 'radiant-fountain', gold: 600 })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toEqual({ type: 'buy', item: 'boots_of_speed' })
    })

    it('stays at fountain to heal when HP is low', () => {
      const bot = makePlayer({ zone: 'radiant-fountain', hp: 100, maxHp: 500, gold: 0 })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toBeNull()
    })

    it('moves to lane when at fountain with full HP and nothing to buy', () => {
      const bot = makePlayer({
        zone: 'radiant-fountain',
        hp: 500,
        maxHp: 500,
        gold: 0,
        items: ['boots_of_speed', 'null_pointer', 'garbage_collector', 'blink_module', 'stack_overflow', 'segfault_blade'],
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toEqual({ type: 'move', zone: 'radiant-base' })
    })
  })

  describe('retreat behavior', () => {
    it('retreats to fountain when HP is below 25%', () => {
      const bot = makePlayer({ zone: 'mid-t1-rad', hp: 100, maxHp: 500 })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).not.toBeNull()
      expect(action!.type).toBe('move')
      if (action!.type === 'move') {
        expect(action!.zone).toBe('mid-t2-rad')
      }
    })

    it('does not retreat when HP is at 25%', () => {
      const bot = makePlayer({ zone: 'mid-t1-rad', hp: 125, maxHp: 500 })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      // 125/500 = 25% => not < 25, so no retreat — moves forward instead
      expect(action).not.toBeNull()
      expect(action!.type).toBe('move')
      // Should advance along lane (forward), not retreat (backward toward base)
      if (action!.type === 'move') {
        expect(action!.zone).toBe('mid-river') // forward, not mid-t2-rad (backward)
      }
    })
  })

  describe('combat - hero targeting', () => {
    it('attacks enemy hero in same zone', () => {
      const bot = makePlayer({ zone: 'mid-river', hp: 400, maxHp: 500, mp: 0 })
      const enemy = makePlayer({
        id: 'enemy1',
        team: 'dire',
        zone: 'mid-river',
        hp: 300,
        maxHp: 500,
      })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toEqual({ type: 'attack', target: { kind: 'hero', name: 'enemy1' } })
    })

    it('targets lowest HP enemy hero', () => {
      const bot = makePlayer({ zone: 'mid-river', hp: 400, maxHp: 500, mp: 0 })
      const enemy1 = makePlayer({
        id: 'enemy1',
        team: 'dire',
        zone: 'mid-river',
        hp: 300,
      })
      const enemy2 = makePlayer({
        id: 'enemy2',
        team: 'dire',
        zone: 'mid-river',
        hp: 100,
      })
      const state = makeGameState({
        players: { [bot.id]: bot, enemy1, enemy2 },
      })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).not.toBeNull()
      if (action!.type === 'attack') {
        expect(action!.target).toEqual({ kind: 'hero', name: 'enemy2' })
      }
    })

    it('does not attack dead enemy heroes', () => {
      const bot = makePlayer({ zone: 'mid-river', hp: 400, maxHp: 500, mp: 0 })
      const deadEnemy = makePlayer({
        id: 'enemy1',
        team: 'dire',
        zone: 'mid-river',
        hp: 0,
        alive: false,
      })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: deadEnemy } })
      const action = decideBotAction(state, bot, 'mid')
      // Should not target dead enemy, should move instead
      expect(action!.type).not.toBe('attack')
    })
  })

  describe('combat - ability usage', () => {
    it('casts ability when enemy is present and ability is off cooldown', () => {
      const bot = makePlayer({ zone: 'mid-river', hp: 400, maxHp: 500, mp: 300 })
      const enemy = makePlayer({
        id: 'enemy1',
        team: 'dire',
        zone: 'mid-river',
        hp: 300,
      })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'mid')
      // Should try to cast (r first in priority order)
      expect(action).not.toBeNull()
      expect(action!.type).toBe('cast')
    })

    it('does not cast when on cooldown', () => {
      const bot = makePlayer({
        zone: 'mid-river',
        hp: 400,
        maxHp: 500,
        mp: 300,
        cooldowns: { q: 5, w: 5, e: 5, r: 5 },
      })
      const enemy = makePlayer({
        id: 'enemy1',
        team: 'dire',
        zone: 'mid-river',
        hp: 300,
      })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'mid')
      // All abilities on cooldown, should attack instead
      expect(action).toEqual({ type: 'attack', target: { kind: 'hero', name: 'enemy1' } })
    })

    it('does not cast when not enough mana', () => {
      const bot = makePlayer({
        zone: 'mid-river',
        hp: 400,
        maxHp: 500,
        mp: 0,
        maxMp: 200,
      })
      const enemy = makePlayer({
        id: 'enemy1',
        team: 'dire',
        zone: 'mid-river',
        hp: 300,
      })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'mid')
      // No mana, should attack
      expect(action).toEqual({ type: 'attack', target: { kind: 'hero', name: 'enemy1' } })
    })
  })

  describe('combat - creep targeting', () => {
    it('attacks enemy creeps when no heroes in zone', () => {
      const bot = makePlayer({ zone: 'mid-t1-rad', hp: 400, maxHp: 500, mp: 0 })
      const creeps: CreepState[] = [
        { id: 'creep-1', team: 'dire', zone: 'mid-t1-rad', hp: 200, type: 'melee' },
        { id: 'creep-2', team: 'dire', zone: 'mid-t1-rad', hp: 100, type: 'ranged' },
      ]
      const state = makeGameState({ players: { [bot.id]: bot }, creeps })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).not.toBeNull()
      expect(action!.type).toBe('attack')
      if (action!.type === 'attack') {
        // Should target lowest HP creep (index 1)
        expect(action!.target).toEqual({ kind: 'creep', index: 1 })
      }
    })

    it('ignores friendly creeps', () => {
      const bot = makePlayer({ zone: 'mid-t1-rad', hp: 400, maxHp: 500, mp: 0 })
      const creeps: CreepState[] = [
        { id: 'creep-1', team: 'radiant', zone: 'mid-t1-rad', hp: 100, type: 'melee' },
      ]
      const state = makeGameState({ players: { [bot.id]: bot }, creeps })
      const action = decideBotAction(state, bot, 'mid')
      // No enemies, should move forward
      expect(action!.type).toBe('move')
    })
  })

  describe('tower targeting', () => {
    it('attacks enemy tower when allied creeps are present', () => {
      const bot = makePlayer({ zone: 'mid-t1-dire', hp: 400, maxHp: 500, mp: 0 })
      const alliedCreeps: CreepState[] = [
        { id: 'creep-1', team: 'radiant', zone: 'mid-t1-dire', hp: 400, type: 'melee' },
      ]
      const state = makeGameState({
        players: { [bot.id]: bot },
        creeps: alliedCreeps,
      })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).not.toBeNull()
      expect(action!.type).toBe('attack')
      if (action!.type === 'attack') {
        expect(action!.target).toEqual({ kind: 'tower', zone: 'mid-t1-dire' })
      }
    })

    it('does not attack tower without allied creeps', () => {
      const bot = makePlayer({ zone: 'mid-t1-dire', hp: 400, maxHp: 500, mp: 0 })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      // No allied creeps -> should move forward instead
      expect(action!.type).toBe('move')
    })
  })

  describe('movement - lane pathing', () => {
    it('moves forward along assigned lane when no targets', () => {
      const bot = makePlayer({ zone: 'mid-t1-rad', hp: 400, maxHp: 500, mp: 0 })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toEqual({ type: 'move', zone: 'mid-river' })
    })

    it('moves toward lane start when off-lane', () => {
      const bot = makePlayer({ zone: 'jungle-rad-top', hp: 400, maxHp: 500, mp: 0 })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      // Should pathfind toward mid-t3-rad (the first lane zone after fountain/base)
      expect(action).not.toBeNull()
      expect(action!.type).toBe('move')
    })
  })

  describe('shopping', () => {
    it('buys first item in build order', () => {
      const bot = makePlayer({ zone: 'radiant-fountain', gold: 600 })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toEqual({ type: 'buy', item: 'boots_of_speed' })
    })

    it('skips items already owned', () => {
      const bot = makePlayer({
        zone: 'radiant-fountain',
        gold: 1500,
        items: ['boots_of_speed', null, null, null, null, null],
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toEqual({ type: 'buy', item: 'null_pointer' })
    })

    it('does not buy when inventory is full', () => {
      const bot = makePlayer({
        zone: 'radiant-fountain',
        gold: 10000,
        items: ['boots_of_speed', 'null_pointer', 'garbage_collector', 'blink_module', 'stack_overflow', 'segfault_blade'],
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      // Can't buy, inventory full, should move to lane
      expect(action).toEqual({ type: 'move', zone: 'radiant-base' })
    })

    it('does not buy when gold is insufficient', () => {
      const bot = makePlayer({ zone: 'radiant-fountain', gold: 100 })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      // Can't afford anything, hp is full so should move to lane
      expect(action).toEqual({ type: 'move', zone: 'radiant-base' })
    })
  })

  describe('priority ordering', () => {
    it('prioritizes retreat over combat when HP < 25%', () => {
      const bot = makePlayer({ zone: 'mid-river', hp: 50, maxHp: 500, mp: 300 })
      const enemy = makePlayer({
        id: 'enemy1',
        team: 'dire',
        zone: 'mid-river',
        hp: 300,
      })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'mid')
      // Should retreat despite enemy presence
      expect(action!.type).toBe('move')
    })

    it('prioritizes abilities over basic attack', () => {
      const bot = makePlayer({ zone: 'mid-river', hp: 400, maxHp: 500, mp: 300 })
      const enemy = makePlayer({
        id: 'enemy1',
        team: 'dire',
        zone: 'mid-river',
        hp: 300,
      })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action!.type).toBe('cast')
    })

    it('prioritizes hero attacks over creep attacks', () => {
      const bot = makePlayer({ zone: 'mid-river', hp: 400, maxHp: 500, mp: 0 })
      const enemy = makePlayer({
        id: 'enemy1',
        team: 'dire',
        zone: 'mid-river',
        hp: 300,
      })
      const creeps: CreepState[] = [
        { id: 'creep-1', team: 'dire', zone: 'mid-river', hp: 100, type: 'melee' },
      ]
      const state = makeGameState({
        players: { [bot.id]: bot, enemy1: enemy },
        creeps,
      })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toEqual({ type: 'attack', target: { kind: 'hero', name: 'enemy1' } })
    })
  })
})
