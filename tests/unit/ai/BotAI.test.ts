import { describe, it, expect } from 'vitest'
import { decideBotAction } from '../../../server/game/ai/BotAI'
import type { GameState, PlayerState, CreepState } from '../../../shared/types/game'
import { initializeZoneStates, initializeTowers } from '../../../server/game/map/zones'
import { initializeAncients } from '../../../server/game/engine/AncientSystem'

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
    killStreak: 0,
    buybackCost: 0,
    talents: { tier10: null, tier15: null, tier20: null, tier25: null },
    ...overrides,
  }
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    tick: 10,
    phase: 'playing',
    teams: {
      radiant: { id: 'radiant', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: null },
      dire: { id: 'dire', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: null },
    },
    players: {},
    zones: initializeZoneStates(),
    creeps: [],
    neutrals: [],
    towers: initializeTowers(),
    ancients: initializeAncients(),
    runes: [],
    roshan: { alive: true, hp: 5000, maxHp: 5000, deathTick: null },
    aegis: null,
    events: [],
    surrenderVotes: { radiant: new Set(), dire: new Set() },
    lastSeen: {},
    timeOfDay: 'day',
    dayNightTick: 0,
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
      // Defensive consumables are stocked first
      expect(action).toEqual({ type: 'buy', item: 'healing_salve' })
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
        items: [
          'boots_of_speed',
          'null_pointer',
          'garbage_collector',
          'blink_module',
          'stack_overflow',
          'segfault_blade',
        ],
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

    it('does not retreat when HP is above retreat threshold', () => {
      const bot = makePlayer({ zone: 'mid-t1-rad', hp: 180, maxHp: 500 }) // 36% HP
      const allyCreep = { id: 'c1', team: 'radiant' as const, zone: 'mid-t1-rad', hp: 300, type: 'melee' as const }
      const state = makeGameState({ players: { [bot.id]: bot }, creeps: [allyCreep] })
      const action = decideBotAction(state, bot, 'mid')
      // 180/500 = 36% => above 30% retreat threshold, advances with creep support
      expect(action).not.toBeNull()
      expect(action!.type).toBe('move')
      // Should advance along lane (forward), not retreat (backward toward base)
      if (action!.type === 'move') {
        expect(action!.zone).toBe('mid-river') // forward, not mid-t2-rad (backward)
      }
    })

    it('holds position at the frontier without creep support', () => {
      const bot = makePlayer({ zone: 'mid-t1-rad', hp: 400, maxHp: 500 })
      const state = makeGameState({ players: { [bot.id]: bot } })
      // Next zone is mid-river (neutral territory) and no allied creeps — wait
      expect(decideBotAction(state, bot, 'mid')).toBeNull()
    })
  })

  describe('combat - hero targeting', () => {
    it('attacks enemy hero in same zone', () => {
      const bot = makePlayer({
        zone: 'mid-river',
        hp: 400,
        maxHp: 500,
        mp: 0,
        cooldowns: { q: 1, w: 1, e: 1, r: 1 },
      })
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
      const bot = makePlayer({
        zone: 'mid-river',
        hp: 400,
        maxHp: 500,
        mp: 0,
        cooldowns: { q: 1, w: 1, e: 1, r: 1 },
      })
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
      // Should not target the dead enemy (may hold position or move)
      expect(action?.type ?? 'hold').not.toBe('attack')
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
        cooldowns: { q: 0, w: 0, e: 1, r: 0 }, // E costs 0 mana, so put it on CD
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
        { id: 'creep-2', team: 'dire', zone: 'mid-t1-rad', hp: 50, type: 'ranged' },
      ]
      const state = makeGameState({ players: { [bot.id]: bot }, creeps })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).not.toBeNull()
      expect(action!.type).toBe('attack')
      if (action!.type === 'attack') {
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
      // No allied creeps -> holds position (deep in enemy territory, no support)
      expect(action?.type ?? 'hold').not.toBe('attack')
    })
  })

  describe('movement - lane pathing', () => {
    it('moves forward along assigned lane with creep support', () => {
      const bot = makePlayer({ zone: 'mid-t1-rad', hp: 400, maxHp: 500, mp: 0 })
      const allyCreep = { id: 'c1', team: 'radiant' as const, zone: 'mid-t1-rad', hp: 300, type: 'melee' as const }
      const state = makeGameState({ players: { [bot.id]: bot }, creeps: [allyCreep] })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toEqual({ type: 'move', zone: 'mid-river' })
    })

    it('advances freely on its own side of the map', () => {
      const bot = makePlayer({ zone: 'mid-t3-rad', hp: 400, maxHp: 500, mp: 0 })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toEqual({ type: 'move', zone: 'mid-t2-rad' })
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
    it('stocks defensive consumables before core items', () => {
      const bot = makePlayer({ zone: 'radiant-fountain', gold: 600 })
      const state = makeGameState({ players: { [bot.id]: bot } })
      expect(decideBotAction(state, bot, 'mid')).toEqual({ type: 'buy', item: 'healing_salve' })

      const withSalve = makePlayer({
        zone: 'radiant-fountain',
        gold: 450,
        items: ['healing_salve', null, null, null, null, null],
      })
      const state2 = makeGameState({ players: { [withSalve.id]: withSalve } })
      expect(decideBotAction(state2, withSalve, 'mid')).toEqual({
        type: 'buy',
        item: 'town_portal_scroll',
      })
    })

    it('buys first item in build order once consumables are stocked', () => {
      const bot = makePlayer({
        zone: 'radiant-fountain',
        gold: 600,
        items: ['healing_salve', 'town_portal_scroll', null, null, null, null],
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      // blades_of_attack: +12 attack — a stat the engine actually consumes
      expect(action).toEqual({ type: 'buy', item: 'blades_of_attack' })
    })

    it('does not buy dead moveSpeed-only items (boots_of_speed)', () => {
      const bot = makePlayer({
        zone: 'radiant-fountain',
        gold: 99999,
        items: ['healing_salve', 'town_portal_scroll', null, null, null, null],
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).not.toBeNull()
      expect(action!.type).toBe('buy')
      if (action!.type === 'buy') {
        expect(action!.item).not.toBe('boots_of_speed')
      }
    })

    it('skips items already owned', () => {
      const bot = makePlayer({
        zone: 'radiant-fountain',
        gold: 1500,
        items: ['healing_salve', 'town_portal_scroll', 'blades_of_attack', null, null, null],
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toEqual({ type: 'buy', item: 'null_pointer' })
    })

    it('does not buy when inventory is full', () => {
      const bot = makePlayer({
        zone: 'radiant-fountain',
        gold: 10000,
        items: [
          'boots_of_speed',
          'null_pointer',
          'garbage_collector',
          'blink_module',
          'stack_overflow',
          'segfault_blade',
        ],
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      // Can't buy, inventory full, should move to lane
      expect(action).toEqual({ type: 'move', zone: 'radiant-base' })
    })

    it('does not buy when gold is insufficient', () => {
      const bot = makePlayer({ zone: 'radiant-fountain', gold: 20 })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      // Can't afford anything (cheapest consumable is 50g), hp is full so should move to lane
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
      const bot = makePlayer({
        zone: 'mid-river',
        hp: 400,
        maxHp: 500,
        mp: 0,
        cooldowns: { q: 1, w: 1, e: 1, r: 1 },
      })
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

  describe('rune pickup', () => {
    it('issues a rune command when standing on a rune (not a wasted Q cast)', () => {
      const bot = makePlayer({
        zone: 'rune-top',
        hp: 500,
        maxHp: 500,
        mp: 300,
        cooldowns: { q: 0, w: 0, e: 0, r: 0 },
      })
      const state = makeGameState({
        players: { [bot.id]: bot },
        runes: [{ zone: 'rune-top', type: 'haste', tick: 5 }],
      })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toEqual({ type: 'rune' })
    })
  })

  describe('support ability targeting', () => {
    it('heals the most-hurt ally instead of the lowest-HP enemy', () => {
      const bot = makePlayer({
        id: 'bot_alpha',
        heroId: 'sentry',
        zone: 'mid-river',
        hp: 600,
        maxHp: 600,
        mp: 100,
        maxMp: 350,
        cooldowns: { q: 0, w: 5, e: 5, r: 5 },
      })
      const ally = makePlayer({
        id: 'bot_ally',
        team: 'radiant',
        zone: 'mid-river',
        hp: 150,
        maxHp: 600,
      })
      const enemy = makePlayer({
        id: 'enemy1',
        team: 'dire',
        zone: 'mid-river',
        hp: 100, // lowest HP overall — the old code would heal-target this enemy
        maxHp: 500,
      })
      const state = makeGameState({
        players: { [bot.id]: bot, bot_ally: ally, enemy1: enemy },
      })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toEqual({
        type: 'cast',
        ability: 'q',
        target: { kind: 'hero', name: 'bot_ally' },
      })
    })

    it('heals itself when hurt and no ally needs it more', () => {
      const bot = makePlayer({
        id: 'bot_alpha',
        heroId: 'sentry',
        zone: 'mid-river',
        hp: 300,
        maxHp: 600,
        mp: 100,
        maxMp: 350,
        cooldowns: { q: 0, w: 5, e: 5, r: 5 },
      })
      const enemy = makePlayer({
        id: 'enemy1',
        team: 'dire',
        zone: 'mid-river',
        hp: 100,
        maxHp: 500,
      })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toEqual({
        type: 'cast',
        ability: 'q',
        target: { kind: 'hero', name: 'bot_alpha' },
      })
    })

    it('does not waste heals when the team is healthy — attacks instead', () => {
      const bot = makePlayer({
        id: 'bot_alpha',
        heroId: 'sentry',
        zone: 'mid-river',
        hp: 600,
        maxHp: 600,
        mp: 100,
        maxMp: 350,
        cooldowns: { q: 0, w: 5, e: 5, r: 5 },
      })
      const enemy = makePlayer({
        id: 'enemy1',
        team: 'dire',
        zone: 'mid-river',
        hp: 100,
        maxHp: 500,
      })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toEqual({ type: 'attack', target: { kind: 'hero', name: 'enemy1' } })
    })

    it('still targets the lowest-HP enemy with damage abilities', () => {
      const bot = makePlayer({
        heroId: 'echo',
        zone: 'mid-river',
        hp: 400,
        maxHp: 500,
        mp: 300,
        cooldowns: { q: 0, w: 5, e: 5, r: 5 },
      })
      const ally = makePlayer({
        id: 'bot_ally',
        team: 'radiant',
        zone: 'mid-river',
        hp: 50,
        maxHp: 500,
      })
      const enemy1 = makePlayer({ id: 'enemy1', team: 'dire', zone: 'mid-river', hp: 300 })
      const enemy2 = makePlayer({ id: 'enemy2', team: 'dire', zone: 'mid-river', hp: 100 })
      const state = makeGameState({
        players: { [bot.id]: bot, bot_ally: ally, enemy1, enemy2 },
      })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toEqual({
        type: 'cast',
        ability: 'q',
        target: { kind: 'hero', name: 'enemy2' },
      })
    })
  })

  describe('defensive consumables', () => {
    it('pops a healing salve when hurt and out of combat', () => {
      const bot = makePlayer({
        zone: 'mid-t1-rad',
        hp: 250,
        maxHp: 500,
        items: ['healing_salve', null, null, null, null, null],
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toEqual({ type: 'use', item: 'healing_salve' })
    })

    it('does not re-pop a salve while regen is already active', () => {
      const bot = makePlayer({
        zone: 'mid-t1-rad',
        hp: 250,
        maxHp: 500,
        items: ['healing_salve', null, null, null, null, null],
        buffs: [
          { id: 'healing_salve_regen', stacks: 50, ticksRemaining: 3, source: 'healing_salve' },
        ],
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action?.type).not.toBe('use')
    })

    it('does not pop a salve while enemies are in the zone', () => {
      const bot = makePlayer({
        zone: 'mid-river',
        hp: 250,
        maxHp: 500,
        items: ['healing_salve', null, null, null, null, null],
      })
      const enemy = makePlayer({ id: 'enemy1', team: 'dire', zone: 'mid-river', hp: 400 })
      const state = makeGameState({ players: { [bot.id]: bot, enemy1: enemy } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action?.type).not.toBe('use')
    })

    it('teleports home when retreating from deep map positions', () => {
      const bot = makePlayer({
        zone: 'mid-t1-dire',
        hp: 100,
        maxHp: 500,
        items: ['town_portal_scroll', null, null, null, null, null],
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toEqual({ type: 'use', item: 'town_portal_scroll' })
    })

    it('walks home instead of TPing when already near the fountain', () => {
      const bot = makePlayer({
        zone: 'mid-t3-rad',
        hp: 100,
        maxHp: 500,
        items: ['town_portal_scroll', null, null, null, null, null],
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toEqual({ type: 'move', zone: 'radiant-base' })
    })

    it('stands still while channeling a teleport', () => {
      const bot = makePlayer({
        zone: 'mid-t1-rad',
        hp: 100,
        maxHp: 500,
        buffs: [
          { id: 'tp_channeling', stacks: 1, ticksRemaining: 2, source: 'town_portal_scroll' },
        ],
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      expect(decideBotAction(state, bot, 'mid')).toBeNull()
    })
  })

  describe('ancient push', () => {
    it('attacks the enemy ancient when in the enemy base and it is vulnerable', () => {
      const bot = makePlayer({
        zone: 'dire-base',
        hp: 400,
        maxHp: 500,
        mp: 0,
        cooldowns: { q: 1, w: 1, e: 1, r: 1 },
      })
      const ancients = initializeAncients()
      const state = makeGameState({
        players: { [bot.id]: bot },
        ancients: { ...ancients, dire: { ...ancients.dire, vulnerable: true } },
      })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toEqual({ type: 'attack', target: { kind: 'ancient' } })
    })

    it('does not attack the ancient while it is invulnerable', () => {
      const bot = makePlayer({
        zone: 'dire-base',
        hp: 400,
        maxHp: 500,
        mp: 0,
        cooldowns: { q: 1, w: 1, e: 1, r: 1 },
      })
      const state = makeGameState({ players: { [bot.id]: bot } })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).not.toEqual({ type: 'attack', target: { kind: 'ancient' } })
    })

    it('fights defending heroes before the ancient', () => {
      const bot = makePlayer({
        zone: 'dire-base',
        hp: 400,
        maxHp: 500,
        mp: 0,
        cooldowns: { q: 1, w: 1, e: 1, r: 1 },
      })
      const defender = makePlayer({ id: 'enemy1', team: 'dire', zone: 'dire-base', hp: 300 })
      const ancients = initializeAncients()
      const state = makeGameState({
        players: { [bot.id]: bot, enemy1: defender },
        ancients: { ...ancients, dire: { ...ancients.dire, vulnerable: true } },
      })
      const action = decideBotAction(state, bot, 'mid')
      expect(action).toEqual({ type: 'attack', target: { kind: 'hero', name: 'enemy1' } })
    })
  })
})
