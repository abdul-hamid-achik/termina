import { Effect, Data } from 'effect'
import type { GameState, PlayerState } from '~~/shared/types/game'
import type { TargetRef } from '~~/shared/types/commands'
import { ZONE_MAP } from '~~/shared/constants/zones'
import { MAX_ITEMS, WARD_DURATION_TICKS, WARD_LIMIT_PER_TEAM } from '~~/shared/constants/balance'
import { getItem } from './registry'
import {
  applyBuff,
  updatePlayer,
  getAlliesInZone,
  updatePlayers,
} from '../heroes/_base'
import { areAdjacent } from '../map/topology'

// ── Typed Errors ──────────────────────────────────────────────────
/* eslint-disable unicorn/throw-new-error */

export class NotInShopError extends Data.TaggedError('NotInShopError')<{
  readonly zone: string
}> {}

export class InsufficientGoldError extends Data.TaggedError('InsufficientGoldError')<{
  readonly required: number
  readonly current: number
}> {}

export class InventoryFullError extends Data.TaggedError('InventoryFullError')<{
  readonly maxItems: number
}> {}

export class ItemNotFoundError extends Data.TaggedError('ItemNotFoundError')<{
  readonly itemId: string
}> {}

export class ItemOnCooldownError extends Data.TaggedError('ItemOnCooldownError')<{
  readonly itemId: string
  readonly ticksRemaining: number
}> {}
/* eslint-enable unicorn/throw-new-error */

export type ShopError =
  | NotInShopError
  | InsufficientGoldError
  | InventoryFullError
  | ItemNotFoundError

export type ItemError = ItemNotFoundError | ItemOnCooldownError

// ── Buy Item ──────────────────────────────────────────────────────

export function buyItem(
  state: GameState,
  playerId: string,
  itemId: string,
): Effect.Effect<GameState, ShopError> {
  return Effect.gen(function* () {
    const player = state.players[playerId]
    if (!player) {
      return yield* Effect.fail(new ItemNotFoundError({ itemId: playerId }))
    }

    // Must be in a shop zone (fountain)
    const zone = ZONE_MAP[player.zone]
    if (!zone?.shop) {
      return yield* Effect.fail(new NotInShopError({ zone: player.zone }))
    }

    const item = getItem(itemId)
    if (!item) {
      return yield* Effect.fail(new ItemNotFoundError({ itemId }))
    }

    // Check gold
    if (player.gold < item.cost) {
      return yield* Effect.fail(
        new InsufficientGoldError({ required: item.cost, current: player.gold }),
      )
    }

    // Check inventory space
    const filledSlots = player.items.filter((i) => i !== null).length
    if (filledSlots >= MAX_ITEMS) {
      return yield* Effect.fail(new InventoryFullError({ maxItems: MAX_ITEMS }))
    }

    // Deduct gold and add item to first empty slot
    const items = [...player.items]
    const emptySlot = items.indexOf(null)
    if (emptySlot === -1) {
      return yield* Effect.fail(new InventoryFullError({ maxItems: MAX_ITEMS }))
    }
    items[emptySlot] = itemId

    const updatedPlayer: PlayerState = {
      ...player,
      gold: player.gold - item.cost,
      items,
    }

    return updatePlayer(state, updatedPlayer)
  })
}

// ── Sell Item ─────────────────────────────────────────────────────

export function sellItem(
  state: GameState,
  playerId: string,
  itemSlot: number,
): Effect.Effect<GameState, ShopError> {
  return Effect.gen(function* () {
    const player = state.players[playerId]
    if (!player) {
      return yield* Effect.fail(new ItemNotFoundError({ itemId: playerId }))
    }

    const zone = ZONE_MAP[player.zone]
    if (!zone?.shop) {
      return yield* Effect.fail(new NotInShopError({ zone: player.zone }))
    }

    const itemId = player.items[itemSlot]
    if (!itemId) {
      return yield* Effect.fail(new ItemNotFoundError({ itemId: `slot_${itemSlot}` }))
    }

    const item = getItem(itemId)
    if (!item) {
      return yield* Effect.fail(new ItemNotFoundError({ itemId }))
    }

    // 50% gold refund
    const refund = Math.floor(item.cost * 0.5)
    const items = [...player.items]
    items[itemSlot] = null

    const updatedPlayer: PlayerState = {
      ...player,
      gold: player.gold + refund,
      items,
    }

    return updatePlayer(state, updatedPlayer)
  })
}

// ── Use Item ──────────────────────────────────────────────────────

export function useItem(
  state: GameState,
  playerId: string,
  itemId: string,
  target?: TargetRef | string,
): Effect.Effect<GameState, ItemError> {
  return Effect.gen(function* () {
    const player = state.players[playerId]
    if (!player) {
      return yield* Effect.fail(new ItemNotFoundError({ itemId: playerId }))
    }

    // Find item in inventory
    const slotIdx = player.items.indexOf(itemId)
    if (slotIdx === -1) {
      return yield* Effect.fail(new ItemNotFoundError({ itemId }))
    }

    const item = getItem(itemId)
    if (!item?.active) {
      return yield* Effect.fail(new ItemNotFoundError({ itemId }))
    }

    // Check cooldown (stored as buff)
    const cdBuff = player.buffs.find((b) => b.id === `item_cd_${itemId}`)
    if (cdBuff && cdBuff.ticksRemaining > 0) {
      return yield* Effect.fail(
        new ItemOnCooldownError({ itemId, ticksRemaining: cdBuff.ticksRemaining }),
      )
    }

    // Apply item effect
    let updatedState = state
    switch (itemId) {
      case 'healing_salve':
        updatedState = useHealingSalve(state, player, slotIdx)
        break
      case 'mana_vial':
        updatedState = useManaVial(state, player, slotIdx)
        break
      case 'blink_module':
        updatedState = yield* useBlinkModule(state, player, target)
        break
      case 'stack_overflow':
        updatedState = useStackOverflow(state, player)
        break
      case 'firewall_item':
        updatedState = useFirewallItem(state, player)
        break
      case 'observer_ward':
        updatedState = yield* useObserverWard(state, player, slotIdx, target)
        break
      case 'smoke_of_deceit':
        updatedState = useSmokeOfDeceit(state, player, slotIdx)
        break
      default:
        return yield* Effect.fail(new ItemNotFoundError({ itemId }))
    }

    return updatedState
  })
}

// ── Item Effect Implementations ───────────────────────────────────

function useHealingSalve(state: GameState, player: PlayerState, slot: number): GameState {
  let updated = applyBuff(player, {
    id: 'healing_salve_regen',
    stacks: 50, // 200 HP / 4 ticks = 50 per tick
    ticksRemaining: 4,
    source: 'healing_salve',
  })
  updated = consumeItem(updated, slot)
  return updatePlayer(state, updated)
}

function useManaVial(state: GameState, player: PlayerState, slot: number): GameState {
  let updated: PlayerState = {
    ...player,
    mp: Math.min(player.maxMp, player.mp + 150),
  }
  updated = consumeItem(updated, slot)
  return updatePlayer(state, updated)
}

function useBlinkModule(
  state: GameState,
  player: PlayerState,
  target?: TargetRef | string,
): Effect.Effect<GameState, ItemError> {
  return Effect.gen(function* () {
    const zoneId =
      typeof target === 'string' ? target : target?.kind === 'hero' ? target.name : undefined
    if (!zoneId || !areAdjacent(player.zone, zoneId)) {
      return yield* Effect.fail(new ItemNotFoundError({ itemId: 'blink_module' }))
    }

    let updated: PlayerState = { ...player, zone: zoneId }
    updated = applyBuff(updated, {
      id: 'item_cd_blink_module',
      stacks: 1,
      ticksRemaining: 12,
      source: 'blink_module',
    })

    return updatePlayer(state, updated)
  })
}

function useStackOverflow(state: GameState, player: PlayerState): GameState {
  let updated = applyBuff(player, {
    id: 'stack_overflow_buff',
    stacks: 1,
    ticksRemaining: 10,
    source: 'stack_overflow',
  })
  updated = applyBuff(updated, {
    id: 'item_cd_stack_overflow',
    stacks: 1,
    ticksRemaining: 20,
    source: 'stack_overflow',
  })
  return updatePlayer(state, updated)
}

function useFirewallItem(state: GameState, player: PlayerState): GameState {
  let updated = applyBuff(player, {
    id: 'firewall_block',
    stacks: 1,
    ticksRemaining: 30,
    source: 'firewall_item',
  })
  updated = applyBuff(updated, {
    id: 'item_cd_firewall_item',
    stacks: 1,
    ticksRemaining: 30,
    source: 'firewall_item',
  })
  return updatePlayer(state, updated)
}

function useObserverWard(
  state: GameState,
  player: PlayerState,
  slot: number,
  target?: TargetRef | string,
): Effect.Effect<GameState, ItemError> {
  return Effect.gen(function* () {
    const zoneId =
      typeof target === 'string' ? target : target?.kind === 'hero' ? target.name : undefined
    if (!zoneId || !state.zones[zoneId]) {
      return yield* Effect.fail(new ItemNotFoundError({ itemId: 'observer_ward' }))
    }

    // Check team ward limit
    const zoneState = state.zones[zoneId]!
    const teamWardCount = Object.values(state.zones).reduce(
      (count, z) => count + z.wards.filter((w) => w.team === player.team).length,
      0,
    )
    if (teamWardCount >= WARD_LIMIT_PER_TEAM) {
      return yield* Effect.fail(new ItemNotFoundError({ itemId: 'observer_ward' }))
    }

    const updated = consumeItem(player, slot)
    const updatedZones = {
      ...state.zones,
      [zoneId]: {
        ...zoneState,
        wards: [
          ...zoneState.wards,
          {
            team: player.team,
            placedTick: state.tick,
            expiryTick: state.tick + WARD_DURATION_TICKS,
          },
        ],
      },
    }

    return { ...updatePlayer(state, updated), zones: updatedZones }
  })
}

function useSmokeOfDeceit(state: GameState, player: PlayerState, slot: number): GameState {
  const updated = consumeItem(player, slot)

  // Apply smoke buff to self and all allies in zone
  const allies = getAlliesInZone(state, player)
  const allAffected = [updated, ...allies].map((p) =>
    applyBuff(p, {
      id: 'smoke',
      stacks: 1,
      ticksRemaining: 3,
      source: player.id,
    }),
  )

  return updatePlayers(state, allAffected)
}

// ── Helpers ───────────────────────────────────────────────────────

function consumeItem(player: PlayerState, slot: number): PlayerState {
  const items = [...player.items]
  items[slot] = null
  return { ...player, items }
}
