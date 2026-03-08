import { Effect, Data } from 'effect'
import type { GameState, PlayerState } from '~~/shared/types/game'
import type { TargetRef } from '~~/shared/types/commands'
import { ZONE_MAP } from '~~/shared/constants/zones'
import {
  MAX_ITEMS,
  OBSERVER_WARD_DURATION_TICKS,
  WARD_LIMIT_PER_TEAM,
} from '~~/shared/constants/balance'
import { getItem } from './registry'
import {
  applyBuff,
  updatePlayer,
  getAlliesInZone,
  updatePlayers,
  findTargetPlayer,
} from '../heroes/_base'
import { areAdjacent } from '../map/topology'
import { calculateMagicalDamage } from '../engine/DamageCalculator'

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

export class InvalidTargetError extends Data.TaggedError('InvalidTargetError')<{
  readonly reason: string
}> {}
/* eslint-enable unicorn/throw-new-error */

export type ShopError =
  | NotInShopError
  | InsufficientGoldError
  | InventoryFullError
  | ItemNotFoundError

export type ItemError = ItemNotFoundError | ItemOnCooldownError | InvalidTargetError

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
      // Consumables
      case 'healing_salve':
        updatedState = useHealingSalve(state, player, slotIdx)
        break
      case 'mana_vial':
        updatedState = useManaVial(state, player, slotIdx)
        break
      case 'observer_ward':
        updatedState = yield* useObserverWard(state, player, slotIdx, target)
        break
      case 'smoke_of_deceit':
        updatedState = useSmokeOfDeceit(state, player, slotIdx)
        break
      case 'dust_of_appearance':
        updatedState = useDustOfAppearance(state, player, slotIdx)
        break
      case 'town_portal_scroll':
        updatedState = yield* useTownPortalScroll(state, player, slotIdx)
        break

      // Movement items
      case 'blink_module':
        updatedState = yield* useBlinkModule(state, player, target)
        break
      case 'force_staff':
        updatedState = yield* useForceStaff(state, player, target)
        break
      case 'hurricane_pike':
        updatedState = yield* useHurricanePike(state, player, target)
        break

      // Offensive items
      case 'silver_edge':
        updatedState = useSilverEdge(state, player)
        break
      case 'dagon':
        updatedState = yield* useDagon(state, player, target)
        break
      case 'ethereal_blade':
        updatedState = yield* useEtherealBlade(state, player, target)
        break

      // Defensive items
      case 'firewall_item':
        updatedState = useFirewallItem(state, player)
        break
      case 'black_king_bar':
        updatedState = useBlackKingBar(state, player)
        break
      case 'blade_mail':
        updatedState = useBladeMail(state, player)
        break
      case 'ghost_scepter':
        updatedState = useGhostScepter(state, player)
        break
      case 'lotus_orb':
        updatedState = yield* useLotusOrb(state, player, target)
        break

      // Utility items
      case 'stack_overflow':
        updatedState = useStackOverflow(state, player)
        break
      case 'refresher_orb':
        updatedState = useRefresherOrb(state, player)
        break
      case 'euls_scepter':
        updatedState = yield* useEulsScepter(state, player, target)
        break
      case 'scythe_of_vyse':
        updatedState = yield* useScytheOfVyse(state, player, target)
        break
      case 'veil_of_discord':
        updatedState = useVeilOfDiscord(state, player)
        break
      case 'shivas_guard':
        updatedState = useShivasGuard(state, player)
        break

      // Power Treads toggle
      case 'power_treads':
        updatedState = usePowerTreads(state, player)
        break

      default:
        return yield* Effect.fail(new ItemNotFoundError({ itemId }))
    }

    return updatedState
  })
}

// ── Consumable Implementations ────────────────────────────────────

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
            expiryTick: state.tick + OBSERVER_WARD_DURATION_TICKS,
            type: 'observer' as const,
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

function useDustOfAppearance(state: GameState, player: PlayerState, slot: number): GameState {
  let updated = consumeItem(player, slot)
  updated = applyBuff(updated, {
    id: 'item_cd_dust_of_appearance',
    stacks: 1,
    ticksRemaining: 0, // No cooldown
    source: 'dust_of_appearance',
  })

  // Apply reveal buff to self
  updated = applyBuff(updated, {
    id: 'dust_reveal',
    stacks: 1,
    ticksRemaining: 2,
    source: player.id,
  })

  return updatePlayer(state, updated)
}

function useTownPortalScroll(
  state: GameState,
  player: PlayerState,
  slot: number,
): Effect.Effect<GameState, ItemError> {
  let updated = consumeItem(player, slot)

  const fountainZone = player.team === 'radiant' ? 'radiant-fountain' : 'dire-fountain'

  updated = applyBuff(updated, {
    id: 'tp_channeling',
    stacks: 1,
    ticksRemaining: 3,
    source: 'town_portal_scroll',
  })

  updated = applyBuff(updated, {
    id: 'tp_destination',
    stacks: 1,
    ticksRemaining: 4,
    source: 'town_portal_scroll',
    destination: fountainZone,
  })

  return Effect.succeed(updatePlayer(state, updated))
}

// ── Movement Item Implementations ─────────────────────────────────

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

function useForceStaff(
  state: GameState,
  player: PlayerState,
  target?: TargetRef | string,
): Effect.Effect<GameState, ItemError> {
  return Effect.gen(function* () {
    // Can target self or ally
    let targetPlayer = player
    if (target && typeof target !== 'string' && target.kind === 'hero') {
      const found = findTargetPlayer(state, target)
      if (found && found.team === player.team) {
        targetPlayer = found
      }
    }

    // Push to random adjacent zone (simulating forced movement direction)
    const currentZone = ZONE_MAP[targetPlayer.zone]
    if (!currentZone || currentZone.adjacentTo.length === 0) {
      return yield* Effect.fail(new InvalidTargetError({ reason: 'No adjacent zone to push to' }))
    }

    const pushZone =
      currentZone.adjacentTo[Math.floor(Math.random() * currentZone.adjacentTo.length)]!

    let updated: PlayerState = { ...targetPlayer, zone: pushZone }

    // Apply cooldown to caster
    if (targetPlayer.id !== player.id) {
      const caster = applyBuff(player, {
        id: 'item_cd_force_staff',
        stacks: 1,
        ticksRemaining: 12,
        source: 'force_staff',
      })
      return updatePlayers(state, [caster, updated])
    }

    updated = applyBuff(updated, {
      id: 'item_cd_force_staff',
      stacks: 1,
      ticksRemaining: 12,
      source: 'force_staff',
    })

    return updatePlayer(state, updated)
  })
}

function useHurricanePike(
  state: GameState,
  player: PlayerState,
  target?: TargetRef | string,
): Effect.Effect<GameState, ItemError> {
  return Effect.gen(function* () {
    // Must target an enemy hero
    if (!target || typeof target === 'string' || target.kind !== 'hero') {
      return yield* Effect.fail(new InvalidTargetError({ reason: 'Must target an enemy hero' }))
    }

    const targetPlayer = findTargetPlayer(state, target)
    if (!targetPlayer || targetPlayer.team === player.team) {
      return yield* Effect.fail(new InvalidTargetError({ reason: 'Must target an enemy hero' }))
    }

    // Push self away (to adjacent zone not containing target)
    const currentZone = ZONE_MAP[player.zone]
    if (!currentZone) {
      return yield* Effect.fail(new InvalidTargetError({ reason: 'Invalid zone' }))
    }

    const safeZones = currentZone.adjacentTo.filter((z) => z !== targetPlayer.zone)
    if (safeZones.length === 0) {
      return yield* Effect.fail(new InvalidTargetError({ reason: 'No safe zone to push to' }))
    }

    const pushZone = safeZones[Math.floor(Math.random() * safeZones.length)]!

    let updated: PlayerState = { ...player, zone: pushZone }
    updated = applyBuff(updated, {
      id: 'hurricane_pike_attacks',
      stacks: 1,
      ticksRemaining: 2,
      source: 'hurricane_pike',
    })
    updated = applyBuff(updated, {
      id: 'item_cd_hurricane_pike',
      stacks: 1,
      ticksRemaining: 14,
      source: 'hurricane_pike',
    })

    return updatePlayer(state, updated)
  })
}

// ── Offensive Item Implementations ────────────────────────────────

function useSilverEdge(state: GameState, player: PlayerState): GameState {
  let updated = applyBuff(player, {
    id: 'silver_edge_invis',
    stacks: 1,
    ticksRemaining: 3,
    source: 'silver_edge',
  })
  updated = applyBuff(updated, {
    id: 'silver_edge_bonus',
    stacks: 150,
    ticksRemaining: 5,
    source: 'silver_edge',
  })
  updated = applyBuff(updated, {
    id: 'item_cd_silver_edge',
    stacks: 1,
    ticksRemaining: 18,
    source: 'silver_edge',
  })
  return updatePlayer(state, updated)
}

function useDagon(
  state: GameState,
  player: PlayerState,
  target?: TargetRef | string,
): Effect.Effect<GameState, ItemError> {
  return Effect.gen(function* () {
    if (!target || typeof target === 'string' || target.kind !== 'hero') {
      return yield* Effect.fail(new InvalidTargetError({ reason: 'Must target a hero' }))
    }

    const targetPlayer = findTargetPlayer(state, target)
    if (!targetPlayer || !targetPlayer.alive) {
      return yield* Effect.fail(new InvalidTargetError({ reason: 'Target not found or dead' }))
    }

    // Check range: same zone or adjacent
    if (targetPlayer.zone !== player.zone && !areAdjacent(player.zone, targetPlayer.zone)) {
      return yield* Effect.fail(new InvalidTargetError({ reason: 'Target out of range' }))
    }

    // Deal 300 magical damage
    const damage = calculateMagicalDamage(300, targetPlayer.magicResist)
    const newHp = Math.max(0, targetPlayer.hp - damage)

    const updatedCaster = applyBuff(player, {
      id: 'item_cd_dagon',
      stacks: 1,
      ticksRemaining: 18,
      source: 'dagon',
    })

    const updatedTarget: PlayerState = {
      ...targetPlayer,
      hp: newHp,
      alive: newHp > 0,
    }

    return updatePlayers(state, [updatedCaster, updatedTarget])
  })
}

function useEtherealBlade(
  state: GameState,
  player: PlayerState,
  target?: TargetRef | string,
): Effect.Effect<GameState, ItemError> {
  return Effect.gen(function* () {
    if (!target || typeof target === 'string' || target.kind !== 'hero') {
      return yield* Effect.fail(new InvalidTargetError({ reason: 'Must target a hero' }))
    }

    const targetPlayer = findTargetPlayer(state, target)
    if (!targetPlayer || !targetPlayer.alive) {
      return yield* Effect.fail(new InvalidTargetError({ reason: 'Target not found or dead' }))
    }

    if (targetPlayer.zone !== player.zone) {
      return yield* Effect.fail(new InvalidTargetError({ reason: 'Target not in same zone' }))
    }

    // Apply ethereal form: immune to physical, +40% magic vuln
    let updatedTarget = applyBuff(targetPlayer, {
      id: 'ethereal',
      stacks: 1,
      ticksRemaining: 2,
      source: 'ethereal_blade',
    })
    updatedTarget = applyBuff(updatedTarget, {
      id: 'magic_vuln_40',
      stacks: 40,
      ticksRemaining: 2,
      source: 'ethereal_blade',
    })

    const updatedCaster = applyBuff(player, {
      id: 'item_cd_ethereal_blade',
      stacks: 1,
      ticksRemaining: 15,
      source: 'ethereal_blade',
    })

    return updatePlayers(state, [updatedCaster, updatedTarget])
  })
}

// ── Defensive Item Implementations ────────────────────────────────

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

function useBlackKingBar(state: GameState, player: PlayerState): GameState {
  let updated = applyBuff(player, {
    id: 'magic_immune',
    stacks: 1,
    ticksRemaining: 4,
    source: 'black_king_bar',
  })
  updated = applyBuff(updated, {
    id: 'item_cd_black_king_bar',
    stacks: 1,
    ticksRemaining: 25,
    source: 'black_king_bar',
  })
  return updatePlayer(state, updated)
}

function useBladeMail(state: GameState, player: PlayerState): GameState {
  let updated = applyBuff(player, {
    id: 'blade_mail',
    stacks: 100, // 100% return
    ticksRemaining: 3,
    source: 'blade_mail',
  })
  updated = applyBuff(updated, {
    id: 'item_cd_blade_mail',
    stacks: 1,
    ticksRemaining: 18,
    source: 'blade_mail',
  })
  return updatePlayer(state, updated)
}

function useGhostScepter(state: GameState, player: PlayerState): GameState {
  let updated = applyBuff(player, {
    id: 'ghost_form',
    stacks: 1,
    ticksRemaining: 2,
    source: 'ghost_scepter',
  })
  updated = applyBuff(updated, {
    id: 'item_cd_ghost_scepter',
    stacks: 1,
    ticksRemaining: 20,
    source: 'ghost_scepter',
  })
  return updatePlayer(state, updated)
}

function useLotusOrb(
  state: GameState,
  player: PlayerState,
  target?: TargetRef | string,
): Effect.Effect<GameState, ItemError> {
  // Can target self or ally
  let targetPlayer = player
  if (target && typeof target !== 'string' && target.kind === 'hero') {
    const found = findTargetPlayer(state, target)
    if (found && found.team === player.team) {
      targetPlayer = found
    }
  }

  let updated = applyBuff(targetPlayer, {
    id: 'lotus_orb',
    stacks: 1,
    ticksRemaining: 5,
    source: 'lotus_orb',
  })

  // Apply cooldown to caster
  if (targetPlayer.id !== player.id) {
    const caster = applyBuff(player, {
      id: 'item_cd_lotus_orb',
      stacks: 1,
      ticksRemaining: 15,
      source: 'lotus_orb',
    })
    return Effect.succeed(updatePlayers(state, [caster, updated]))
  }

  updated = applyBuff(updated, {
    id: 'item_cd_lotus_orb',
    stacks: 1,
    ticksRemaining: 15,
    source: 'lotus_orb',
  })

  return Effect.succeed(updatePlayer(state, updated))
}

// ── Utility Item Implementations ──────────────────────────────────

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

function useRefresherOrb(state: GameState, player: PlayerState): GameState {
  // Reset all ability cooldowns
  let updated: PlayerState = {
    ...player,
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
  }
  updated = applyBuff(updated, {
    id: 'item_cd_refresher_orb',
    stacks: 1,
    ticksRemaining: 40,
    source: 'refresher_orb',
  })
  return updatePlayer(state, updated)
}

function useEulsScepter(
  state: GameState,
  player: PlayerState,
  target?: TargetRef | string,
): Effect.Effect<GameState, ItemError> {
  return Effect.gen(function* () {
    // Can target self, ally, or enemy
    let targetPlayer = player
    if (target && typeof target !== 'string' && target.kind === 'hero') {
      const found = findTargetPlayer(state, target)
      if (found) {
        targetPlayer = found
      }
    }

    if (targetPlayer.zone !== player.zone && targetPlayer.id !== player.id) {
      return yield* Effect.fail(new InvalidTargetError({ reason: 'Target not in same zone' }))
    }

    // Cyclone: invulnerable and disabled
    let updated = applyBuff(targetPlayer, {
      id: 'cyclone',
      stacks: 1,
      ticksRemaining: 2,
      source: 'euls_scepter',
    })
    updated = applyBuff(updated, {
      id: 'invulnerable',
      stacks: 1,
      ticksRemaining: 2,
      source: 'euls_scepter',
    })

    // Apply cooldown to caster
    if (targetPlayer.id !== player.id) {
      const caster = applyBuff(player, {
        id: 'item_cd_euls_scepter',
        stacks: 1,
        ticksRemaining: 15,
        source: 'euls_scepter',
      })
      return updatePlayers(state, [caster, updated])
    }

    updated = applyBuff(updated, {
      id: 'item_cd_euls_scepter',
      stacks: 1,
      ticksRemaining: 15,
      source: 'euls_scepter',
    })

    return updatePlayer(state, updated)
  })
}

function useScytheOfVyse(
  state: GameState,
  player: PlayerState,
  target?: TargetRef | string,
): Effect.Effect<GameState, ItemError> {
  return Effect.gen(function* () {
    if (!target || typeof target === 'string' || target.kind !== 'hero') {
      return yield* Effect.fail(new InvalidTargetError({ reason: 'Must target a hero' }))
    }

    const targetPlayer = findTargetPlayer(state, target)
    if (!targetPlayer || !targetPlayer.alive) {
      return yield* Effect.fail(new InvalidTargetError({ reason: 'Target not found or dead' }))
    }

    if (targetPlayer.zone !== player.zone) {
      return yield* Effect.fail(new InvalidTargetError({ reason: 'Target not in same zone' }))
    }

    // Hex: cannot attack or cast
    let updatedTarget = applyBuff(targetPlayer, {
      id: 'hex',
      stacks: 1,
      ticksRemaining: 2,
      source: 'scythe_of_vyse',
    })
    updatedTarget = applyBuff(updatedTarget, {
      id: 'silence',
      stacks: 1,
      ticksRemaining: 2,
      source: 'scythe_of_vyse',
    })

    const updatedCaster = applyBuff(player, {
      id: 'item_cd_scythe_of_vyse',
      stacks: 1,
      ticksRemaining: 20,
      source: 'scythe_of_vyse',
    })

    return updatePlayers(state, [updatedCaster, updatedTarget])
  })
}

function useVeilOfDiscord(state: GameState, player: PlayerState): GameState {
  let updated = applyBuff(player, {
    id: 'veil_discord',
    stacks: 25, // 25% magic vuln
    ticksRemaining: 4,
    source: 'veil_of_discord',
  })
  updated = applyBuff(updated, {
    id: 'item_cd_veil_of_discord',
    stacks: 1,
    ticksRemaining: 15,
    source: 'veil_of_discord',
  })
  return updatePlayer(state, updated)
}

function useShivasGuard(state: GameState, player: PlayerState): GameState {
  let updated = applyBuff(player, {
    id: 'shivas_blast',
    stacks: 100, // 100 damage
    ticksRemaining: 1,
    source: 'shivas_guard',
  })
  updated = applyBuff(updated, {
    id: 'shivas_slow',
    stacks: 1,
    ticksRemaining: 2,
    source: 'shivas_guard',
  })
  updated = applyBuff(updated, {
    id: 'item_cd_shivas_guard',
    stacks: 1,
    ticksRemaining: 20,
    source: 'shivas_guard',
  })
  return updatePlayer(state, updated)
}

function usePowerTreads(state: GameState, player: PlayerState): GameState {
  // Cycle through modes: attack -> hp -> mp -> attack
  const currentMode = player.buffs.find((b) => b.id.startsWith('power_treads_'))?.id

  let updated: PlayerState
  switch (currentMode) {
    case 'power_treads_attack':
      // Switch to HP mode
      updated = applyBuff(player, {
        id: 'power_treads_hp',
        stacks: 150,
        ticksRemaining: 999,
        source: 'power_treads',
      })
      break
    case 'power_treads_hp':
      // Switch to MP mode
      updated = applyBuff(player, {
        id: 'power_treads_mp',
        stacks: 100,
        ticksRemaining: 999,
        source: 'power_treads',
      })
      break
    default:
      // Default to attack mode
      updated = applyBuff(player, {
        id: 'power_treads_attack',
        stacks: 15,
        ticksRemaining: 999,
        source: 'power_treads',
      })
  }

  return updatePlayer(state, updated)
}

// ── Helpers ───────────────────────────────────────────────────────

function consumeItem(player: PlayerState, slot: number): PlayerState {
  const items = [...player.items]
  items[slot] = null
  return { ...player, items }
}
