import { describe, it, expect } from 'vitest'
import { Effect, Exit } from 'effect'
import {
  buyItem,
  sellItem,
  useItem,
  NotInShopError,
  InsufficientGoldError,
  InventoryFullError,
  ItemNotFoundError,
  ItemOnCooldownError,
} from '../../../server/game/items/shop'
import type { GameState, PlayerState, ZoneRuntimeState } from '../../../shared/types/game'

// ── Helpers ────────────────────────────────────────────────────────

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'player_1',
    name: 'TestPlayer',
    team: 'radiant',
    heroId: 'echo',
    zone: 'radiant-fountain', // shop zone by default
    hp: 500,
    maxHp: 500,
    mp: 300,
    maxMp: 300,
    level: 1,
    xp: 0,
    gold: 1000,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnTick: null,
    defense: 5,
    magicResist: 5,
    kills: 0,
    deaths: 0,
    assists: 0,
    damageDealt: 0,
    towerDamageDealt: 0,
    ...overrides,
  }
}

function makeZone(id: string, overrides: Partial<ZoneRuntimeState> = {}): ZoneRuntimeState {
  return {
    id,
    wards: [],
    creeps: [],
    ...overrides,
  }
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  const player = makePlayer()
  return {
    tick: 10,
    phase: 'playing',
    teams: {
      radiant: { id: 'radiant', kills: 0, towerKills: 0, gold: 0 },
      dire: { id: 'dire', kills: 0, towerKills: 0, gold: 0 },
    },
    players: { player_1: player },
    zones: {
      'radiant-fountain': makeZone('radiant-fountain'),
      'radiant-base': makeZone('radiant-base'),
      'mid-t1-rad': makeZone('mid-t1-rad'),
      'mid-river': makeZone('mid-river'),
      'mid-t1-dire': makeZone('mid-t1-dire'),
    },
    creeps: [],
    towers: [],
    events: [],
    ...overrides,
  }
}

function runEffect<A, E>(effect: Effect.Effect<A, E>): Promise<Exit.Exit<A, E>> {
  return Effect.runPromiseExit(effect)
}

// ── Tests ──────────────────────────────────────────────────────────

describe('Shop', () => {
  describe('buyItem', () => {
    it('purchases an item and deducts gold', async () => {
      const state = makeGameState()
      const exit = await runEffect(buyItem(state, 'player_1', 'iron_branch'))

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        const newState = exit.value
        const player = newState.players['player_1']!
        expect(player.gold).toBe(1000 - 50) // iron_branch costs 50
        expect(player.items).toContain('iron_branch')
      }
    })

    it('places item in first empty slot', async () => {
      const player = makePlayer({ items: ['healing_salve', null, null, null, null, null] })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await runEffect(buyItem(state, 'player_1', 'iron_branch'))

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        const items = exit.value.players['player_1']!.items
        expect(items[0]).toBe('healing_salve')
        expect(items[1]).toBe('iron_branch')
      }
    })

    it('fails when player is not in a shop zone', async () => {
      const player = makePlayer({ zone: 'mid-t1-rad' })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await runEffect(buyItem(state, 'player_1', 'iron_branch'))

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const cause = exit.cause
        const error = cause.toString()
        expect(error).toContain('NotInShopError')
      }
    })

    it('fails when player has insufficient gold', async () => {
      const player = makePlayer({ gold: 10 })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await runEffect(buyItem(state, 'player_1', 'blink_module'))

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const error = exit.cause.toString()
        expect(error).toContain('InsufficientGoldError')
      }
    })

    it('fails when inventory is full', async () => {
      const player = makePlayer({
        items: ['iron_branch', 'iron_branch', 'iron_branch', 'iron_branch', 'iron_branch', 'iron_branch'],
        gold: 5000,
      })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await runEffect(buyItem(state, 'player_1', 'iron_branch'))

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const error = exit.cause.toString()
        expect(error).toContain('InventoryFullError')
      }
    })

    it('fails when item does not exist', async () => {
      const state = makeGameState()
      const exit = await runEffect(buyItem(state, 'player_1', 'nonexistent_item'))

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const error = exit.cause.toString()
        expect(error).toContain('ItemNotFoundError')
      }
    })

    it('fails when player does not exist', async () => {
      const state = makeGameState()
      const exit = await runEffect(buyItem(state, 'nonexistent_player', 'iron_branch'))

      expect(Exit.isFailure(exit)).toBe(true)
    })

    it('can buy multiple items sequentially', async () => {
      let state = makeGameState({
        players: { player_1: makePlayer({ gold: 5000 }) },
      })

      // Buy first item
      let exit = await runEffect(buyItem(state, 'player_1', 'iron_branch'))
      expect(Exit.isSuccess(exit)).toBe(true)
      state = (exit as Exit.Success<GameState, never>).value

      // Buy second item
      exit = await runEffect(buyItem(state, 'player_1', 'healing_salve'))
      expect(Exit.isSuccess(exit)).toBe(true)
      state = (exit as Exit.Success<GameState, never>).value

      const player = state.players['player_1']!
      expect(player.items[0]).toBe('iron_branch')
      expect(player.items[1]).toBe('healing_salve')
      expect(player.gold).toBe(5000 - 50 - 150)
    })

    it('deducts exact cost for expensive items', async () => {
      const player = makePlayer({ gold: 6000 })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await runEffect(buyItem(state, 'player_1', 'segfault_blade'))

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        expect(exit.value.players['player_1']!.gold).toBe(6000 - 5500)
      }
    })
  })

  describe('sellItem', () => {
    it('sells an item and refunds 50% gold', async () => {
      const player = makePlayer({
        items: ['iron_branch', null, null, null, null, null],
        gold: 500,
      })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await runEffect(sellItem(state, 'player_1', 0))

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        const newPlayer = exit.value.players['player_1']!
        expect(newPlayer.gold).toBe(500 + Math.floor(50 * 0.5)) // 525
        expect(newPlayer.items[0]).toBeNull()
      }
    })

    it('fails when not in shop zone', async () => {
      const player = makePlayer({
        zone: 'mid-river',
        items: ['iron_branch', null, null, null, null, null],
      })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await runEffect(sellItem(state, 'player_1', 0))

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(exit.cause.toString()).toContain('NotInShopError')
      }
    })

    it('fails when selling empty slot', async () => {
      const state = makeGameState()

      const exit = await runEffect(sellItem(state, 'player_1', 0))

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(exit.cause.toString()).toContain('ItemNotFoundError')
      }
    })

    it('sells expensive items for correct refund', async () => {
      const player = makePlayer({
        items: ['segfault_blade', null, null, null, null, null],
        gold: 0,
      })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await runEffect(sellItem(state, 'player_1', 0))

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        expect(exit.value.players['player_1']!.gold).toBe(Math.floor(5500 * 0.5))
      }
    })

    it('clears the correct inventory slot', async () => {
      const player = makePlayer({
        items: ['iron_branch', 'healing_salve', 'boots_of_speed', null, null, null],
      })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await runEffect(sellItem(state, 'player_1', 1))

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        const items = exit.value.players['player_1']!.items
        expect(items[0]).toBe('iron_branch')
        expect(items[1]).toBeNull()
        expect(items[2]).toBe('boots_of_speed')
      }
    })
  })

  describe('useItem', () => {
    it('uses healing salve and removes it from inventory', async () => {
      const player = makePlayer({
        items: ['healing_salve', null, null, null, null, null],
        hp: 300,
        maxHp: 500,
      })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await runEffect(useItem(state, 'player_1', 'healing_salve'))

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        const newPlayer = exit.value.players['player_1']!
        expect(newPlayer.items[0]).toBeNull() // consumed
        expect(newPlayer.buffs.some((b) => b.id === 'healing_salve_regen')).toBe(true)
      }
    })

    it('uses mana vial and restores MP', async () => {
      const player = makePlayer({
        items: ['mana_vial', null, null, null, null, null],
        mp: 100,
        maxMp: 300,
      })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await runEffect(useItem(state, 'player_1', 'mana_vial'))

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        const newPlayer = exit.value.players['player_1']!
        expect(newPlayer.mp).toBe(250) // 100 + 150
        expect(newPlayer.items[0]).toBeNull() // consumed
      }
    })

    it('mana vial does not exceed max MP', async () => {
      const player = makePlayer({
        items: ['mana_vial', null, null, null, null, null],
        mp: 250,
        maxMp: 300,
      })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await runEffect(useItem(state, 'player_1', 'mana_vial'))

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        expect(exit.value.players['player_1']!.mp).toBe(300)
      }
    })

    it('uses stack_overflow and applies buff', async () => {
      const player = makePlayer({
        items: ['stack_overflow', null, null, null, null, null],
      })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await runEffect(useItem(state, 'player_1', 'stack_overflow'))

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        const newPlayer = exit.value.players['player_1']!
        expect(newPlayer.buffs.some((b) => b.id === 'stack_overflow_buff')).toBe(true)
        expect(newPlayer.buffs.some((b) => b.id === 'item_cd_stack_overflow')).toBe(true)
      }
    })

    it('uses firewall_item and applies block buff', async () => {
      const player = makePlayer({
        items: ['firewall_item', null, null, null, null, null],
      })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await runEffect(useItem(state, 'player_1', 'firewall_item'))

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        const newPlayer = exit.value.players['player_1']!
        expect(newPlayer.buffs.some((b) => b.id === 'firewall_block')).toBe(true)
      }
    })

    it('fails when item is not in inventory', async () => {
      const state = makeGameState()

      const exit = await runEffect(useItem(state, 'player_1', 'healing_salve'))

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(exit.cause.toString()).toContain('ItemNotFoundError')
      }
    })

    it('fails when item has no active ability', async () => {
      const player = makePlayer({
        items: ['boots_of_speed', null, null, null, null, null],
      })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await runEffect(useItem(state, 'player_1', 'boots_of_speed'))

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(exit.cause.toString()).toContain('ItemNotFoundError')
      }
    })

    it('fails when item is on cooldown', async () => {
      const player = makePlayer({
        items: ['stack_overflow', null, null, null, null, null],
        buffs: [{ id: 'item_cd_stack_overflow', stacks: 1, ticksRemaining: 5, source: 'stack_overflow' }],
      })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await runEffect(useItem(state, 'player_1', 'stack_overflow'))

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(exit.cause.toString()).toContain('ItemOnCooldownError')
      }
    })

    it('fails when player does not exist', async () => {
      const state = makeGameState()

      const exit = await runEffect(useItem(state, 'nonexistent', 'healing_salve'))

      expect(Exit.isFailure(exit)).toBe(true)
    })
  })

  describe('error types', () => {
    it('NotInShopError has zone info', () => {
      const error = new NotInShopError({ zone: 'mid-river' })
      expect(error._tag).toBe('NotInShopError')
      expect(error.zone).toBe('mid-river')
    })

    it('InsufficientGoldError has required and current', () => {
      const error = new InsufficientGoldError({ required: 500, current: 100 })
      expect(error._tag).toBe('InsufficientGoldError')
      expect(error.required).toBe(500)
      expect(error.current).toBe(100)
    })

    it('InventoryFullError has maxItems', () => {
      const error = new InventoryFullError({ maxItems: 6 })
      expect(error._tag).toBe('InventoryFullError')
      expect(error.maxItems).toBe(6)
    })

    it('ItemNotFoundError has itemId', () => {
      const error = new ItemNotFoundError({ itemId: 'unknown' })
      expect(error._tag).toBe('ItemNotFoundError')
      expect(error.itemId).toBe('unknown')
    })

    it('ItemOnCooldownError has itemId and ticksRemaining', () => {
      const error = new ItemOnCooldownError({ itemId: 'blink_module', ticksRemaining: 5 })
      expect(error._tag).toBe('ItemOnCooldownError')
      expect(error.itemId).toBe('blink_module')
      expect(error.ticksRemaining).toBe(5)
    })
  })
})
