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
} from '~~/server/game/items/shop'
import { filterStateForPlayer } from '~~/server/game/engine/VisionCalculator'
import type { GameState, PlayerState, ZoneRuntimeState } from '~~/shared/types/game'

// ── Helpers ────────────────────────────────────────────────────────

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  const player = {
    id: 'player_1',
    name: 'TestPlayer',
    team: 'chaff',
    heroId: 'echo',
    zone: 'chaff-fountain', // shop zone by default
    integ: 500,
    maxInteg: 500,
    bw: 300,
    maxBw: 300,
    level: 1,
    xp: 0,
    gold: 1000,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnTick: null,
    plate: 5,
    ice: 5,
    kills: 0,
    deaths: 0,
    assists: 0,
    damageDealt: 0,
    iceDamageDealt: 0,
    killStreak: 0,
    ...overrides,
  }
  if (player.team === 'audit' && !player.buffs.some((b) => b.id === 'breached')) {
    return {
      ...player,
      buffs: [...player.buffs, { id: 'breached', stacks: 1, ticksRemaining: 99, source: 'test' }],
    }
  }
  return player
}

function makeZone(id: string, overrides: Partial<ZoneRuntimeState> = {}): ZoneRuntimeState {
  return {
    id,
    wards: [],
    waves: [],
    ...overrides,
  }
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  const player = makePlayer()
  return {
    tick: 10,
    phase: 'playing',
    teams: {
      chaff: { id: 'chaff', kills: 0, iceKills: 0, gold: 0 },
      audit: { id: 'audit', kills: 0, iceKills: 0, gold: 0 },
    },
    players: { player_1: player },
    zones: {
      'chaff-fountain': makeZone('chaff-fountain'),
      'chaff-base': makeZone('chaff-base'),
      'mid-t1-chaff': makeZone('mid-t1-chaff'),
      'mid-river': makeZone('mid-river'),
      'mid-t1-audit': makeZone('mid-t1-audit'),
    },
    waves: [],
    ice: [],
    events: [],
    ...overrides,
  }
}

function cacheEffect<A, E>(effect: Effect.Effect<A, E>): Promise<Exit.Exit<A, E>> {
  return Effect.runPromiseExit(effect)
}

// ── Tests ──────────────────────────────────────────────────────────

describe('Shop', () => {
  describe('buyItem', () => {
    it('purchases an item and deducts gold', async () => {
      const state = makeGameState()
      const exit = await cacheEffect(buyItem(state, 'player_1', 'scrap_lot'))

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        const newState = exit.value
        const player = newState.players['player_1']!
        expect(player.gold).toBe(1000 - 50) // scrap_lot costs 50
        expect(player.items).toContain('scrap_lot')
      }
    })

    it('places item in first empty slot', async () => {
      const player = makePlayer({ items: ['trauma_patch', null, null, null, null, null] })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await cacheEffect(buyItem(state, 'player_1', 'scrap_lot'))

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        const items = exit.value.players['player_1']!.items
        expect(items[0]).toBe('trauma_patch')
        expect(items[1]).toBe('scrap_lot')
      }
    })

    it('fails when player is not in a shop zone', async () => {
      const player = makePlayer({ zone: 'mid-t1-chaff' })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await cacheEffect(buyItem(state, 'player_1', 'scrap_lot'))

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

      const exit = await cacheEffect(buyItem(state, 'player_1', 'jump_shunt'))

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const error = exit.cause.toString()
        expect(error).toContain('InsufficientGoldError')
      }
    })

    it('fails when inventory is full', async () => {
      // 6 distinct items so we hit InventoryFullError, not MaxStacksError
      const player = makePlayer({
        items: ['jump_shunt', 'clock_lens', 'burnout', 'cryo_routine', 'rust_driver', 'arc_coil'],
        gold: 5000,
      })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await cacheEffect(buyItem(state, 'player_1', 'scrap_lot'))

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const error = exit.cause.toString()
        expect(error).toContain('InventoryFullError')
      }
    })

    it('fails when buying past maxStacks for a consumable', async () => {
      // scrap_lot has maxStacks: 3
      const player = makePlayer({
        items: ['scrap_lot', 'scrap_lot', 'scrap_lot', null, null, null],
        gold: 5000,
      })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await cacheEffect(buyItem(state, 'player_1', 'scrap_lot'))

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const error = exit.cause.toString()
        expect(error).toContain('MaxStacksError')
      }
    })

    it('fails when buying a duplicate of a non-consumable unique item', async () => {
      // clock_lens has no maxStacks set -> defaults to 1 for non-consumables
      const player = makePlayer({
        items: ['clock_lens', null, null, null, null, null],
        gold: 5000,
      })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await cacheEffect(buyItem(state, 'player_1', 'clock_lens'))

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const error = exit.cause.toString()
        expect(error).toContain('MaxStacksError')
      }
    })

    it('fails when item does not exist', async () => {
      const state = makeGameState()
      const exit = await cacheEffect(buyItem(state, 'player_1', 'nonexistent_item'))

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const error = exit.cause.toString()
        expect(error).toContain('ItemNotFoundError')
      }
    })

    it('fails when player does not exist', async () => {
      const state = makeGameState()
      const exit = await cacheEffect(buyItem(state, 'nonexistent_player', 'scrap_lot'))

      expect(Exit.isFailure(exit)).toBe(true)
    })

    it('can buy multiple items sequentially', async () => {
      let state = makeGameState({
        players: { player_1: makePlayer({ gold: 5000 }) },
      })

      // Buy first item
      let exit = await cacheEffect(buyItem(state, 'player_1', 'scrap_lot'))
      expect(Exit.isSuccess(exit)).toBe(true)
      state = (exit as Exit.Success<GameState, never>).value

      // Buy second item
      exit = await cacheEffect(buyItem(state, 'player_1', 'trauma_patch'))
      expect(Exit.isSuccess(exit)).toBe(true)
      state = (exit as Exit.Success<GameState, never>).value

      const player = state.players['player_1']!
      expect(player.items[0]).toBe('scrap_lot')
      expect(player.items[1]).toBe('trauma_patch')
      expect(player.gold).toBe(5000 - 50 - 150)
    })

    it('deducts exact cost for expensive items', async () => {
      const player = makePlayer({ gold: 6000 })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await cacheEffect(buyItem(state, 'player_1', 'segfault_blade'))

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        expect(exit.value.players['player_1']!.gold).toBe(6000 - 5500)
      }
    })
  })

  describe('sellItem', () => {
    it('sells an item and refunds 50% gold', async () => {
      const player = makePlayer({
        items: ['scrap_lot', null, null, null, null, null],
        gold: 500,
      })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await cacheEffect(sellItem(state, 'player_1', 0))

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        const newPlayer = exit.value.players['player_1']!
        expect(newPlayer.gold).toBe(500 + Math.floor(50 * 0.5)) // 525
        expect(newPlayer.items[0]).toBeNull()
      }
    })

    it('selling an item drops its lingering buffs but keeps unrelated ones', async () => {
      // Gait Rig' mode buff is near-permanent (ticksRemaining 999); without
      // cleanup you could toggle +15 attack, sell the boots, and keep the stat.
      const player = makePlayer({
        items: ['gait_rig', null, null, null, null, null],
        gold: 500,
        buffs: [
          { id: 'gait_rig_attack', stacks: 15, ticksRemaining: 999, source: 'gait_rig' },
          { id: 'haste', stacks: 1, ticksRemaining: 10, source: 'cache_haste' },
        ],
      })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await cacheEffect(sellItem(state, 'player_1', 0))

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        const newPlayer = exit.value.players['player_1']!
        expect(newPlayer.items[0]).toBeNull()
        // The item's own buff is gone…
        expect(newPlayer.buffs.some((b) => b.id === 'gait_rig_attack')).toBe(false)
        // …but an unrelated buff (a cache) survives.
        expect(newPlayer.buffs.some((b) => b.id === 'haste')).toBe(true)
      }
    })

    it('cannot sell Divine Rapier (its defining drawback)', async () => {
      const player = makePlayer({
        items: ['last_word', null, null, null, null, null],
        gold: 500,
      })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await cacheEffect(sellItem(state, 'player_1', 0))

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(exit.cause.toString()).toContain('ItemNotSellableError')
      }
      // unchanged: still holds the Rapier, no gold gained
      expect(state.players['player_1']!.items[0]).toBe('last_word')
    })

    it('fails when not in shop zone', async () => {
      const player = makePlayer({
        zone: 'mid-river',
        items: ['scrap_lot', null, null, null, null, null],
      })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await cacheEffect(sellItem(state, 'player_1', 0))

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(exit.cause.toString()).toContain('NotInShopError')
      }
    })

    it('fails when selling empty slot', async () => {
      const state = makeGameState()

      const exit = await cacheEffect(sellItem(state, 'player_1', 0))

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

      const exit = await cacheEffect(sellItem(state, 'player_1', 0))

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        expect(exit.value.players['player_1']!.gold).toBe(Math.floor(5500 * 0.5))
      }
    })

    it('clears the correct inventory slot', async () => {
      const player = makePlayer({
        items: ['scrap_lot', 'trauma_patch', 'scrap_lot', null, null, null],
      })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await cacheEffect(sellItem(state, 'player_1', 1))

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        const items = exit.value.players['player_1']!.items
        expect(items[0]).toBe('scrap_lot')
        expect(items[1]).toBeNull()
        expect(items[2]).toBe('scrap_lot')
      }
    })
  })

  describe('useItem', () => {
    it('uses healing salve and removes it from inventory', async () => {
      const player = makePlayer({
        items: ['trauma_patch', null, null, null, null, null],
        integ: 300,
        maxInteg: 500,
      })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await cacheEffect(useItem(state, 'player_1', 'trauma_patch'))

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        const newPlayer = exit.value.players['player_1']!
        expect(newPlayer.items[0]).toBeNull() // consumed
        expect(newPlayer.buffs.some((b) => b.id === 'trauma_patch_regen')).toBe(true)
      }
    })

    it('uses BW vial and restores BW', async () => {
      const player = makePlayer({
        items: ['charge_tab', null, null, null, null, null],
        bw: 100,
        maxBw: 300,
      })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await cacheEffect(useItem(state, 'player_1', 'charge_tab'))

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        const newPlayer = exit.value.players['player_1']!
        expect(newPlayer.bw).toBe(250) // 100 + 150
        expect(newPlayer.items[0]).toBeNull() // consumed
      }
    })

    it('BW vial does not exceed max BW', async () => {
      const player = makePlayer({
        items: ['charge_tab', null, null, null, null, null],
        bw: 250,
        maxBw: 300,
      })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await cacheEffect(useItem(state, 'player_1', 'charge_tab'))

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        expect(exit.value.players['player_1']!.bw).toBe(300)
      }
    })

    it('uses stack_overflow and applies buff', async () => {
      const player = makePlayer({
        items: ['stack_overflow', null, null, null, null, null],
      })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await cacheEffect(useItem(state, 'player_1', 'stack_overflow'))

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        const newPlayer = exit.value.players['player_1']!
        expect(newPlayer.buffs.some((b) => b.id === 'stack_overflow_buff')).toBe(true)
        expect(newPlayer.buffs.some((b) => b.id === 'item_cd_stack_overflow')).toBe(true)
      }
    })

    it('uses ablative_shell and applies block buff', async () => {
      const player = makePlayer({
        items: ['ablative_shell', null, null, null, null, null],
      })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await cacheEffect(useItem(state, 'player_1', 'ablative_shell'))

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        const newPlayer = exit.value.players['player_1']!
        expect(newPlayer.buffs.some((b) => b.id === 'firewall_block')).toBe(true)
      }
    })

    it('fails when item is not in inventory', async () => {
      const state = makeGameState()

      const exit = await cacheEffect(useItem(state, 'player_1', 'trauma_patch'))

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(exit.cause.toString()).toContain('ItemNotFoundError')
      }
    })

    it('fails when item has no active ability', async () => {
      const player = makePlayer({
        items: ['scrap_lot', null, null, null, null, null],
      })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await cacheEffect(useItem(state, 'player_1', 'scrap_lot'))

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(exit.cause.toString()).toContain('ItemNotFoundError')
      }
    })

    it('fails when item is on cooldown', async () => {
      const player = makePlayer({
        items: ['stack_overflow', null, null, null, null, null],
        buffs: [
          { id: 'item_cd_stack_overflow', stacks: 1, ticksRemaining: 5, source: 'stack_overflow' },
        ],
      })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await cacheEffect(useItem(state, 'player_1', 'stack_overflow'))

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(exit.cause.toString()).toContain('ItemOnCooldownError')
      }
    })

    it('fails when player does not exist', async () => {
      const state = makeGameState()

      const exit = await cacheEffect(useItem(state, 'nonexistent', 'trauma_patch'))

      expect(Exit.isFailure(exit)).toBe(true)
    })

    it('Veil of Discord debuffs enemies in zone, not the caster', async () => {
      const caster = makePlayer({
        id: 'player_1',
        team: 'chaff',
        zone: 'mid-river',
        items: ['discord_routine', null, null, null, null, null],
      })
      const enemyInZone = makePlayer({ id: 'enemy_1', team: 'audit', zone: 'mid-river' })
      const enemyElsewhere = makePlayer({ id: 'enemy_2', team: 'audit', zone: 'mid-t1-audit' })
      const state = makeGameState({
        players: { player_1: caster, enemy_1: enemyInZone, enemy_2: enemyElsewhere },
      })

      const exit = await cacheEffect(useItem(state, 'player_1', 'discord_routine'))
      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        const s = exit.value
        const has = (id: string, buff: string) => s.players[id]!.buffs.some((b) => b.id === buff)
        // Debuff lands on the in-zone enemy only.
        expect(has('enemy_1', 'veil_discord')).toBe(true)
        expect(has('enemy_2', 'veil_discord')).toBe(false) // out of zone
        // Caster no longer self-debuffs; it just holds the cooldown marker.
        expect(has('player_1', 'veil_discord')).toBe(false)
        expect(has('player_1', 'item_cd_veil_of_discord')).toBe(true)
      }
    })

    it('Burnout deals no damage to a magic-immune (Hardshell) target', async () => {
      const caster = makePlayer({
        id: 'player_1',
        team: 'chaff',
        zone: 'mid-river',
        items: ['burnout', null, null, null, null, null],
      })
      const target = makePlayer({
        id: 'enemy_1',
        team: 'audit',
        zone: 'mid-river',
        integ: 800,
        buffs: [{ id: 'airgap', stacks: 1, ticksRemaining: 4, source: 'bkb' }],
      })
      const state = makeGameState({ players: { player_1: caster, enemy_1: target } })

      const exit = await cacheEffect(
        useItem(state, 'player_1', 'burnout', { kind: 'hero', name: 'enemy_1' }),
      )
      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        // Magic immunity zeroes the 300 code nuke; cooldown still applies.
        expect(exit.value.players['enemy_1']!.integ).toBe(800)
        expect(exit.value.players['player_1']!.buffs.some((b) => b.id === 'item_cd_burnout')).toBe(
          true,
        )
      }
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
      const error = new ItemOnCooldownError({ itemId: 'jump_shunt', ticksRemaining: 5 })
      expect(error._tag).toBe('ItemOnCooldownError')
      expect(error.itemId).toBe('jump_shunt')
      expect(error.ticksRemaining).toBe(5)
    })
  })

  describe('SNIFFER (true-sight)', () => {
    it('places a type:"sentry" ward in the target zone (active was previously unhandled)', async () => {
      const player = makePlayer({
        id: 'player_1',
        team: 'chaff',
        items: ['sniffer', null, null, null, null, null],
      })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await cacheEffect(useItem(state, 'player_1', 'sniffer', 'mid-river'))

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        const wards = exit.value.zones['mid-river']!.wards
        expect(wards).toHaveLength(1)
        expect(wards[0]!.type).toBe('sniffer')
        expect(wards[0]!.team).toBe('chaff')
        // the ward was consumed from the inventory
        expect(exit.value.players['player_1']!.items[0]).toBeNull()
      }
    })

    it('reveals an invisible enemy in the warded zone (true-sight — previously unreachable)', async () => {
      const player = makePlayer({
        id: 'player_1',
        team: 'chaff',
        zone: 'mid-river',
        items: ['sniffer', null, null, null, null, null],
      })
      const invisEnemy = makePlayer({
        id: 'enemy_1',
        team: 'audit',
        zone: 'mid-river',
        buffs: [{ id: 'invisible', stacks: 1, ticksRemaining: 5, source: 'enemy_1' }],
      })
      const state = makeGameState({
        players: { player_1: player, enemy_1: invisEnemy },
      })

      // Before the sentry: the invisible enemy is fogged even though co-located.
      const before = filterStateForPlayer(state, 'player_1')
      expect('fogged' in before.players['enemy_1']!).toBe(true)

      const exit = await cacheEffect(useItem(state, 'player_1', 'sniffer', 'mid-river'))
      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        // After the sentry: true-sight in the zone reveals the enemy.
        const after = filterStateForPlayer(exit.value, 'player_1')
        expect('fogged' in after.players['enemy_1']!).toBe(false)
      }
    })
  })

  describe('Item actives — behavioral effects', () => {
    const hasBuff = (s: GameState, pid: string, id: string) =>
      s.players[pid]!.buffs.some((b) => b.id === id)

    it('Black King Bar grants magic immunity to the caster', async () => {
      const player = makePlayer({
        id: 'player_1',
        items: ['hardshell', null, null, null, null, null],
      })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await cacheEffect(useItem(state, 'player_1', 'hardshell'))

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) expect(hasBuff(exit.value, 'player_1', 'airgap')).toBe(true)
    })

    it('Ghost Scepter puts the caster into ghost form', async () => {
      const player = makePlayer({
        id: 'player_1',
        items: ['phase_shunt', null, null, null, null, null],
      })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await cacheEffect(useItem(state, 'player_1', 'phase_shunt'))

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) expect(hasBuff(exit.value, 'player_1', 'ghost_form')).toBe(true)
    })

    it('Refresher Orb resets the caster ability cooldowns', async () => {
      const player = makePlayer({
        id: 'player_1',
        items: ['redline_splice', null, null, null, null, null],
        cooldowns: { q: 5, w: 5, e: 5, r: 5 },
      })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await cacheEffect(useItem(state, 'player_1', 'redline_splice'))

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        expect(exit.value.players['player_1']!.cooldowns).toEqual({ q: 0, w: 0, e: 0, r: 0 })
      }
    })

    it('Stasis Shunt Scepter cyclones a co-located enemy (invulnerable + disabled)', async () => {
      const caster = makePlayer({
        id: 'player_1',
        team: 'chaff',
        zone: 'mid-river',
        items: ['stasis_shunt', null, null, null, null, null],
      })
      const enemy = makePlayer({ id: 'enemy_1', team: 'audit', zone: 'mid-river' })
      const state = makeGameState({ players: { player_1: caster, enemy_1: enemy } })

      const exit = await cacheEffect(
        useItem(state, 'player_1', 'stasis_shunt', { kind: 'hero', name: 'enemy_1' }),
      )

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        expect(hasBuff(exit.value, 'enemy_1', 'cyclone')).toBe(true)
        expect(hasBuff(exit.value, 'enemy_1', 'invulnerable')).toBe(true)
      }
    })

    it('Lockout Shunt hexes a co-located enemy (hex + silence)', async () => {
      const caster = makePlayer({
        id: 'player_1',
        team: 'chaff',
        zone: 'mid-river',
        items: ['lockout_shunt', null, null, null, null, null],
      })
      const enemy = makePlayer({ id: 'enemy_1', team: 'audit', zone: 'mid-river' })
      const state = makeGameState({ players: { player_1: caster, enemy_1: enemy } })

      const exit = await cacheEffect(
        useItem(state, 'player_1', 'lockout_shunt', { kind: 'hero', name: 'enemy_1' }),
      )

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        expect(hasBuff(exit.value, 'enemy_1', 'hex')).toBe(true)
        expect(hasBuff(exit.value, 'enemy_1', 'silence')).toBe(true)
      }
    })

    it('Spite Plate puts the damage-return buff on the caster', async () => {
      const player = makePlayer({
        id: 'player_1',
        items: ['spite_plate', null, null, null, null, null],
      })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await cacheEffect(useItem(state, 'player_1', 'spite_plate'))

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) expect(hasBuff(exit.value, 'player_1', 'spite_plate')).toBe(true)
    })

    it('Silver Edge grants invisibility to the caster', async () => {
      const player = makePlayer({
        id: 'player_1',
        items: ['ghostwire_edge', null, null, null, null, null],
      })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await cacheEffect(useItem(state, 'player_1', 'ghostwire_edge'))

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit))
        expect(hasBuff(exit.value, 'player_1', 'ghostwire_edge_invis')).toBe(true)
    })

    it('Gait Rig (first toggle) sets attack mode on the caster', async () => {
      const player = makePlayer({
        id: 'player_1',
        items: ['gait_rig', null, null, null, null, null],
      })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await cacheEffect(useItem(state, 'player_1', 'gait_rig'))

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit))
        expect(hasBuff(exit.value, 'player_1', 'gait_rig_attack')).toBe(true)
    })

    it('Gait Rig cycles attack → hp → mp → attack with exactly one mode active', async () => {
      let state = makeGameState({
        players: {
          player_1: makePlayer({
            id: 'player_1',
            items: ['gait_rig', null, null, null, null, null],
          }),
        },
      })

      // Modes must SWITCH, not stack — toggling four times wraps back to attack,
      // and only ever one gait_rig_* buff is present at a time.
      const order = ['gait_rig_attack', 'gait_rig_hp', 'gait_rig_mp', 'gait_rig_attack']
      for (const expected of order) {
        const exit = await cacheEffect(useItem(state, 'player_1', 'gait_rig'))
        expect(Exit.isSuccess(exit)).toBe(true)
        if (!Exit.isSuccess(exit)) return
        state = exit.value
        const modeBuffs = state.players['player_1']!.buffs.filter((b) =>
          b.id.startsWith('gait_rig_'),
        )
        expect(modeBuffs).toHaveLength(1)
        expect(modeBuffs[0]!.id).toBe(expected)
      }
    })

    it('Tracer Dust applies the reveal buff to the caster', async () => {
      const player = makePlayer({
        id: 'player_1',
        items: ['tracer_dust', null, null, null, null, null],
      })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await cacheEffect(useItem(state, 'player_1', 'tracer_dust'))

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) expect(hasBuff(exit.value, 'player_1', 'dust_reveal')).toBe(true)
    })

    it('Blackout Can smokes the caster and in-zone allies', async () => {
      const caster = makePlayer({
        id: 'player_1',
        team: 'chaff',
        zone: 'mid-river',
        items: ['blackout_can', null, null, null, null, null],
      })
      const ally = makePlayer({ id: 'ally_1', team: 'chaff', zone: 'mid-river' })
      const state = makeGameState({ players: { player_1: caster, ally_1: ally } })

      const exit = await cacheEffect(useItem(state, 'player_1', 'blackout_can'))

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        expect(hasBuff(exit.value, 'player_1', 'smoke')).toBe(true)
        expect(hasBuff(exit.value, 'ally_1', 'smoke')).toBe(true)
      }
    })

    it('Force Staff pushes the caster to an adjacent zone (fountain → base)', async () => {
      const player = makePlayer({
        id: 'player_1',
        zone: 'chaff-fountain', // only adjacent is chaff-base → deterministic push
        items: ['shove_splice', null, null, null, null, null],
      })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await cacheEffect(useItem(state, 'player_1', 'shove_splice'))

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) expect(exit.value.players['player_1']!.zone).toBe('chaff-base')
    })

    it('Blink Module teleports the caster to an adjacent zone', async () => {
      const player = makePlayer({
        id: 'player_1',
        zone: 'chaff-fountain', // adjacent: chaff-base
        items: ['jump_shunt', null, null, null, null, null],
      })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await cacheEffect(useItem(state, 'player_1', 'jump_shunt', 'chaff-base'))

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) expect(exit.value.players['player_1']!.zone).toBe('chaff-base')
    })

    it('Phase Shim etherealizes a co-located enemy (kinetic-immune + magic vuln)', async () => {
      const caster = makePlayer({
        id: 'player_1',
        team: 'chaff',
        zone: 'mid-river',
        items: ['phase_shim', null, null, null, null, null],
      })
      const enemy = makePlayer({ id: 'enemy_1', team: 'audit', zone: 'mid-river' })
      const state = makeGameState({ players: { player_1: caster, enemy_1: enemy } })

      const exit = await cacheEffect(
        useItem(state, 'player_1', 'phase_shim', { kind: 'hero', name: 'enemy_1' }),
      )

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        expect(hasBuff(exit.value, 'enemy_1', 'ethereal')).toBe(true)
        expect(hasBuff(exit.value, 'enemy_1', 'magic_vuln_40')).toBe(true)
      }
    })

    it('Hurricane Pike pushes the caster to a zone away from the target', async () => {
      const caster = makePlayer({
        id: 'player_1',
        team: 'chaff',
        zone: 'chaff-fountain', // adjacent chaff-base; enemy elsewhere → push to base
        items: ['kickback_splice', null, null, null, null, null],
      })
      const enemy = makePlayer({ id: 'enemy_1', team: 'audit', zone: 'mid-river' })
      const state = makeGameState({ players: { player_1: caster, enemy_1: enemy } })

      const exit = await cacheEffect(
        useItem(state, 'player_1', 'kickback_splice', { kind: 'hero', name: 'enemy_1' }),
      )

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) expect(exit.value.players['player_1']!.zone).toBe('chaff-base')
    })

    it('Recall Token starts a channel toward the home fountain', async () => {
      const player = makePlayer({
        id: 'player_1',
        team: 'chaff',
        zone: 'mid-river',
        items: ['recall_token', null, null, null, null, null],
      })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await cacheEffect(useItem(state, 'player_1', 'recall_token'))

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        expect(hasBuff(exit.value, 'player_1', 'tp_channeling')).toBe(true)
        const dest = exit.value.players['player_1']!.buffs.find((b) => b.id === 'tp_destination')
        expect(dest?.destination).toBe('chaff-fountain')
      }
    })

    it('CAMTAP places a vision ward in the target zone', async () => {
      const player = makePlayer({
        id: 'player_1',
        team: 'chaff',
        items: ['camtap', null, null, null, null, null],
      })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await cacheEffect(useItem(state, 'player_1', 'camtap', 'mid-river'))

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        const wards = exit.value.zones['mid-river']!.wards
        expect(wards).toHaveLength(1)
        expect(wards[0]!.type).toBe('camtap')
      }
    })

    it('accepts a {kind:"zone"} target too (the bare-use auto-target form)', async () => {
      // The client's `use camtap` auto-target resolves to a zone TargetRef
      // (zone:<current>); usePlaceWard must read the zone from it, not just a string.
      const player = makePlayer({
        id: 'player_1',
        team: 'chaff',
        items: ['camtap', null, null, null, null, null],
      })
      const state = makeGameState({ players: { player_1: player } })

      const exit = await cacheEffect(
        useItem(state, 'player_1', 'camtap', { kind: 'zone', zone: 'mid-river' }),
      )

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        expect(exit.value.zones['mid-river']!.wards).toHaveLength(1)
      }
    })
  })

  describe('Item actives — reject + revived-item paths', () => {
    it("Cryo Routine blasts and slows enemies in the caster's zone only", async () => {
      const caster = makePlayer({
        id: 'player_1',
        team: 'chaff',
        zone: 'mid-river',
        items: ['cryo_routine', null, null, null, null, null],
      })
      const enemyInZone = makePlayer({
        id: 'enemy_1',
        team: 'audit',
        zone: 'mid-river',
        integ: 600,
        maxInteg: 600,
      })
      const enemyElsewhere = makePlayer({
        id: 'enemy_2',
        team: 'audit',
        zone: 'mid-t1-audit',
        integ: 600,
        maxInteg: 600,
      })
      const state = makeGameState({
        players: { player_1: caster, enemy_1: enemyInZone, enemy_2: enemyElsewhere },
      })

      const exit = await cacheEffect(useItem(state, 'player_1', 'cryo_routine'))
      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        const s = exit.value
        // In-zone enemy is blasted (INTEG down) and slowed.
        expect(s.players['enemy_1']!.integ).toBeLessThan(600)
        expect(s.players['enemy_1']!.buffs.some((b) => b.id === 'slow')).toBe(true)
        // Out-of-zone enemy is untouched.
        expect(s.players['enemy_2']!.integ).toBe(600)
        expect(s.players['enemy_2']!.buffs.some((b) => b.id === 'slow')).toBe(false)
        // Caster keeps only the cooldown marker.
        expect(s.players['player_1']!.buffs.some((b) => b.id === 'item_cd_shivas_guard')).toBe(true)
      }
    })

    it('Burnout burns INTEG on a non-immune target and can kill it', async () => {
      const caster = makePlayer({
        id: 'player_1',
        team: 'chaff',
        zone: 'mid-river',
        items: ['burnout', null, null, null, null, null],
      })
      const target = makePlayer({
        id: 'enemy_1',
        team: 'audit',
        zone: 'mid-river',
        integ: 120,
        maxInteg: 800,
        ice: 0,
      })
      const state = makeGameState({ players: { player_1: caster, enemy_1: target } })

      const exit = await cacheEffect(
        useItem(state, 'player_1', 'burnout', { kind: 'hero', name: 'enemy_1' }),
      )
      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        // 300 code (no resist) overkills the 120-HP target.
        expect(exit.value.players['enemy_1']!.integ).toBe(0)
        expect(exit.value.players['enemy_1']!.alive).toBe(false)
      }
    })

    it('Lotus Orb cast on an ally shields the ally and cools down the caster', async () => {
      const caster = makePlayer({
        id: 'player_1',
        team: 'chaff',
        zone: 'mid-river',
        items: ['mirror_shell', null, null, null, null, null],
      })
      const ally = makePlayer({ id: 'ally_1', team: 'chaff', zone: 'mid-river' })
      const state = makeGameState({ players: { player_1: caster, ally_1: ally } })

      const exit = await cacheEffect(
        useItem(state, 'player_1', 'mirror_shell', { kind: 'hero', name: 'ally_1' }),
      )
      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        const s = exit.value
        // Reflect buff lands on the ally; the caster only carries the cooldown.
        expect(s.players['ally_1']!.buffs.some((b) => b.id === 'mirror_shell')).toBe(true)
        expect(s.players['player_1']!.buffs.some((b) => b.id === 'mirror_shell')).toBe(false)
        expect(s.players['player_1']!.buffs.some((b) => b.id === 'item_cd_lotus_orb')).toBe(true)
      }
    })

    it('placing a ward past the per-team limit (3) is rejected', async () => {
      const player = makePlayer({
        id: 'player_1',
        team: 'chaff',
        items: ['camtap', null, null, null, null, null],
      })
      // The team already has WARD_LIMIT_PER_TEAM (3) wards out across the map.
      const state = makeGameState({
        players: { player_1: player },
        zones: {
          'chaff-fountain': makeZone('chaff-fountain'),
          'mid-river': makeZone('mid-river'),
          'mid-t1-chaff': makeZone('mid-t1-chaff', {
            wards: [
              { team: 'chaff', placedTick: 1, expiryTick: 46, type: 'camtap' },
              { team: 'chaff', placedTick: 2, expiryTick: 47, type: 'camtap' },
              { team: 'chaff', placedTick: 3, expiryTick: 48, type: 'camtap' },
            ],
          }),
        },
      })

      const exit = await cacheEffect(
        useItem(state, 'player_1', 'camtap', { kind: 'zone', zone: 'mid-river' }),
      )
      // Over the cap → rejected, and no 4th ward is placed.
      expect(Exit.isFailure(exit)).toBe(true)
      expect(state.zones['mid-river']!.wards).toHaveLength(0)
    })

    it('Veil + Ethereal magic-vuln stack additively through the real resolvers (+65%)', async () => {
      // Composition test: each amp is unit-tested in isolation, but this drives
      // the real veil -> ethereal -> burnout resolver CHAIN to prove the two
      // magic-vuln debuffs (veil_discord +25%, magic_vuln_40 +40%) co-exist on
      // the target and that Burnout's nuke reads BOTH (additive, the MOBA
      // convention) — a regression to multiplicative or last-wins would break it.
      const caster = makePlayer({
        id: 'player_1',
        team: 'chaff',
        zone: 'mid-river',
        items: ['discord_routine', 'phase_shim', 'burnout', null, null, null],
      })
      const target = makePlayer({
        id: 'enemy_1',
        team: 'audit',
        zone: 'mid-river',
        integ: 800,
        maxInteg: 800,
        ice: 0,
      })
      const state = makeGameState({ players: { player_1: caster, enemy_1: target } })
      const enemyRef = { kind: 'hero', name: 'enemy_1' } as const

      // Veil debuffs every enemy in the caster's zone; Ethereal adds its own
      // magic-vuln on the target; Burnout then nukes the doubly-amped target.
      const afterVeil = await Effect.runPromise(useItem(state, 'player_1', 'discord_routine'))
      const afterEth = await Effect.runPromise(
        useItem(afterVeil, 'player_1', 'phase_shim', enemyRef),
      )
      const enemyMidCombo = afterEth.players['enemy_1']!
      expect(enemyMidCombo.buffs.some((b) => b.id === 'veil_discord')).toBe(true)
      expect(enemyMidCombo.buffs.some((b) => b.id === 'magic_vuln_40')).toBe(true)

      const afterBurnout = await Effect.runPromise(
        useItem(afterEth, 'player_1', 'burnout', enemyRef),
      )
      // 300 base code (0 resist) × (1 + (25 + 40)/100) = 495 → 800 - 495 = 305.
      expect(afterBurnout.players['enemy_1']!.integ).toBe(305)
    })
  })

  describe('Item actives — target rejection guards', () => {
    // The caster sits in the fountain (adjacent ONLY to chaff-base), so a target
    // in mid-river is both a DIFFERENT zone and OUT OF RANGE — which exercises the
    // zone/range guards without depending on finer adjacency.
    const withItem = (item: string) =>
      makePlayer({
        id: 'player_1',
        team: 'chaff',
        zone: 'chaff-fountain',
        items: [item, null, null, null, null, null],
      })
    const fail = async (item: string, target: Parameters<typeof useItem>[3]) =>
      Exit.isFailure(
        await cacheEffect(useItem(makeGameState({ players: state }), 'player_1', item, target)),
      )
    let state: Record<string, PlayerState>

    it('Burnout rejects a non-hero target, a dead target, and an out-of-range target', async () => {
      state = { player_1: withItem('burnout') }
      expect(await fail('burnout', { kind: 'zone', zone: 'mid-river' })).toBe(true) // non-hero
      state = {
        player_1: withItem('burnout'),
        e1: makePlayer({ id: 'e1', team: 'audit', zone: 'chaff-fountain', alive: false, integ: 0 }),
      }
      expect(await fail('burnout', { kind: 'hero', name: 'e1' })).toBe(true) // dead
      state = {
        player_1: withItem('burnout'),
        e1: makePlayer({ id: 'e1', team: 'audit', zone: 'mid-river' }),
      }
      expect(await fail('burnout', { kind: 'hero', name: 'e1' })).toBe(true) // out of range
    })

    it('Phase Shim rejects a target in a different zone', async () => {
      state = {
        player_1: withItem('phase_shim'),
        e1: makePlayer({ id: 'e1', team: 'audit', zone: 'mid-river' }),
      }
      expect(await fail('phase_shim', { kind: 'hero', name: 'e1' })).toBe(true)
    })

    it('Lockout Shunt rejects a non-hero target and an out-of-zone target', async () => {
      state = {
        player_1: withItem('lockout_shunt'),
        e1: makePlayer({ id: 'e1', team: 'audit', zone: 'mid-river' }),
      }
      expect(await fail('lockout_shunt', { kind: 'zone', zone: 'mid-river' })).toBe(true) // non-hero
      expect(await fail('lockout_shunt', { kind: 'hero', name: 'e1' })).toBe(true) // different zone
    })

    it("Stasis Shunt Scepter rejects an out-of-zone target that isn't the caster", async () => {
      state = {
        player_1: withItem('stasis_shunt'),
        e1: makePlayer({ id: 'e1', team: 'audit', zone: 'mid-river' }),
      }
      expect(await fail('stasis_shunt', { kind: 'hero', name: 'e1' })).toBe(true)
    })

    it('Hurricane Pike rejects an ally target (must target an enemy)', async () => {
      state = {
        player_1: withItem('kickback_splice'),
        a1: makePlayer({ id: 'a1', team: 'chaff', zone: 'chaff-fountain' }),
      }
      expect(await fail('kickback_splice', { kind: 'hero', name: 'a1' })).toBe(true)
    })

    it('Blink Module rejects a non-adjacent destination', async () => {
      state = { player_1: withItem('jump_shunt') }
      expect(await fail('jump_shunt', { kind: 'zone', zone: 'mid-river' })).toBe(true)
    })
  })
})
