import { Effect, Data } from 'effect'
import type { GameState, PlayerState } from '~~/shared/types/game'
import type { TargetRef } from '~~/shared/types/commands'
import { ZONE_MAP } from '~~/shared/constants/zones'
import {
  MAX_ITEMS,
  CAMTAP_DURATION_CYCLES,
  SNIFFER_DURATION_CYCLES,
  SELL_REFUND_RATIO,
  WARD_LIMIT_PER_TEAM,
} from '~~/shared/constants/balance'
import { getItem } from '~~/shared/constants/items'
import {
  applyBuff,
  updatePlayer,
  getAlliesInZone,
  getEnemiesInZone,
  updatePlayers,
  findTargetPlayer,
} from '~~/server/game/heroes/_base'
import { areAdjacent, getDistance } from '~~/server/game/map/topology'
import {
  calculateCodeDamage,
  getIncomingDamageMultiplier,
  isDamageImmune,
} from '~~/server/game/engine/DamageCalculator'

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
  readonly cyclesRemaining: number
}> {}

export class InvalidTargetError extends Data.TaggedError('InvalidTargetError')<{
  readonly reason: string
}> {}

export class MaxStacksError extends Data.TaggedError('MaxStacksError')<{
  readonly itemId: string
  readonly maxStacks: number
}> {}

export class ItemNotSellableError extends Data.TaggedError('ItemNotSellableError')<{
  readonly itemId: string
}> {}
/* eslint-enable unicorn/throw-new-error */

export type ShopError =
  | NotInShopError
  | InsufficientGoldError
  | InventoryFullError
  | ItemNotFoundError
  | MaxStacksError
  | ItemNotSellableError

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

    // Check scrip
    if (player.scrip < item.cost) {
      return yield* Effect.fail(
        new InsufficientGoldError({ required: item.cost, current: player.scrip }),
      )
    }

    // Stack-cap: consumables may stack up to maxStacks; non-consumables
    // default to unique (1 per inventory) unless maxStacks is set.
    const stackCap = item.consumable ? (item.maxStacks ?? Infinity) : (item.maxStacks ?? 1)
    const ownedCount = player.items.filter((i) => i === itemId).length
    if (ownedCount >= stackCap) {
      return yield* Effect.fail(new MaxStacksError({ itemId, maxStacks: stackCap }))
    }

    // Check inventory space
    const filledSlots = player.items.filter((i) => i !== null).length
    if (filledSlots >= MAX_ITEMS) {
      return yield* Effect.fail(new InventoryFullError({ maxItems: MAX_ITEMS }))
    }

    // Deduct scrip and add item to first empty slot
    const items = [...player.items]
    const emptySlot = items.indexOf(null)
    if (emptySlot === -1) {
      return yield* Effect.fail(new InventoryFullError({ maxItems: MAX_ITEMS }))
    }
    items[emptySlot] = itemId

    const updatedPlayer: PlayerState = {
      ...player,
      scrip: player.scrip - item.cost,
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

    // Divine Rapier cannot be sold — its defining drawback (you can only get rid
    // of it by dying, which hands it to your killer; see handleDeaths).
    if (itemId === 'last_word') {
      return yield* Effect.fail(new ItemNotSellableError({ itemId }))
    }

    const refund = Math.floor(item.cost * SELL_REFUND_RATIO)
    const items = [...player.items]
    items[itemSlot] = null

    const updatedPlayer: PlayerState = {
      ...player,
      scrip: player.scrip + refund,
      items,
      // Drop any effect the item was granting (e.g. Gait Rig' near-permanent
      // mode buff, an item cooldown). Otherwise you could toggle Treads to +15
      // attack, sell it, and keep the stat forever — plus the refund.
      buffs: player.buffs.filter((b) => b.source !== itemId),
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
    if (cdBuff && cdBuff.cyclesRemaining > 0) {
      return yield* Effect.fail(
        new ItemOnCooldownError({ itemId, cyclesRemaining: cdBuff.cyclesRemaining }),
      )
    }

    // Apply item effect
    let updatedState = state
    switch (itemId) {
      // Consumables
      case 'trauma_patch':
        updatedState = useHealingSalve(state, player, slotIdx)
        break
      case 'charge_tab':
        updatedState = useManaVial(state, player, slotIdx)
        break
      case 'camtap':
        updatedState = yield* usePlaceWard(state, player, slotIdx, target, 'camtap')
        break
      case 'sniffer':
        updatedState = yield* usePlaceWard(state, player, slotIdx, target, 'sniffer')
        break
      case 'blackout_can':
        updatedState = useSmokeOfDeceit(state, player, slotIdx)
        break
      case 'tracer_dust':
        updatedState = useDustOfAppearance(state, player, slotIdx)
        break
      case 'recall_token':
        updatedState = yield* useTownPortalScroll(state, player, slotIdx)
        break

      // Movement items
      case 'jump_shunt':
        updatedState = yield* useBlinkModule(state, player, target)
        break
      case 'shove_splice':
        updatedState = yield* useForceStaff(state, player, target)
        break
      case 'kickback_splice':
        updatedState = yield* useHurricanePike(state, player, target)
        break

      // Offensive items
      case 'ghostwire_edge':
        updatedState = useSilverEdge(state, player)
        break
      case 'burnout':
        updatedState = yield* useBurnout(state, player, target)
        break
      case 'phase_shim':
        updatedState = yield* useEtherealBlade(state, player, target)
        break

      // Defensive items
      case 'ablative_shell':
        updatedState = useFirewallItem(state, player)
        break
      case 'hardshell':
        updatedState = useBlackKingBar(state, player)
        break
      case 'spite_plate':
        updatedState = useBladeMail(state, player)
        break
      case 'phase_shunt':
        updatedState = useGhostScepter(state, player)
        break
      case 'mirror_shell':
        updatedState = yield* useLotusOrb(state, player, target)
        break

      // Utility items
      case 'stack_overflow':
        updatedState = useStackOverflow(state, player)
        break
      case 'redline_splice':
        updatedState = useRefresherOrb(state, player)
        break
      case 'stasis_shunt':
        updatedState = yield* useEulsScepter(state, player, target)
        break
      case 'lockout_shunt':
        updatedState = yield* useScytheOfVyse(state, player, target)
        break
      case 'discord_routine':
        updatedState = useVeilOfDiscord(state, player)
        break
      case 'cryo_routine':
        updatedState = useShivasGuard(state, player)
        break

      // Gait Rig toggle
      case 'gait_rig':
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
    id: 'trauma_patch_regen',
    stacks: 50, // 200 INTEG / 4 ticks = 50 per cycle
    cyclesRemaining: 4,
    source: 'trauma_patch',
  })
  updated = consumeItem(updated, slot)
  return updatePlayer(state, updated)
}

function useManaVial(state: GameState, player: PlayerState, slot: number): GameState {
  let updated: PlayerState = {
    ...player,
    bw: Math.min(player.maxBw, player.bw + 150),
  }
  updated = consumeItem(updated, slot)
  return updatePlayer(state, updated)
}

// Handles both Observer (vision) and Sentry (vision + true-sight) wards. A sentry
// ward's `type: 'sniffer'` is what VisionCalculator reads to build its true-sight
// zones — the only path that reveals invisible enemies. Previously sniffer
// had no handler at all, so true-sight was unreachable.
function usePlaceWard(
  state: GameState,
  player: PlayerState,
  slot: number,
  target: TargetRef | string | undefined,
  wardType: 'camtap' | 'sniffer',
): Effect.Effect<GameState, ItemError> {
  return Effect.gen(function* () {
    const itemId = `${wardType}_ward`
    const zoneId =
      typeof target === 'string'
        ? target
        : target?.kind === 'zone'
          ? target.zone
          : target?.kind === 'hero'
            ? target.name
            : undefined
    if (!zoneId || !state.zones[zoneId]) {
      return yield* Effect.fail(new ItemNotFoundError({ itemId }))
    }

    // Check team ward limit
    const zoneState = state.zones[zoneId]!
    const teamWardCount = Object.values(state.zones).reduce(
      (count, z) => count + z.wards.filter((w) => w.team === player.team).length,
      0,
    )
    if (teamWardCount >= WARD_LIMIT_PER_TEAM) {
      return yield* Effect.fail(new ItemNotFoundError({ itemId }))
    }

    const duration = wardType === 'camtap' ? CAMTAP_DURATION_CYCLES : SNIFFER_DURATION_CYCLES
    const updated = consumeItem(player, slot)
    const updatedZones = {
      ...state.zones,
      [zoneId]: {
        ...zoneState,
        wards: [
          ...zoneState.wards,
          {
            team: player.team,
            placedTick: state.cycle,
            expiryTick: state.cycle + duration,
            type: wardType,
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
      cyclesRemaining: 3,
      source: player.id,
    }),
  )

  return updatePlayers(state, allAffected)
}

function useDustOfAppearance(state: GameState, player: PlayerState, slot: number): GameState {
  let updated = consumeItem(player, slot)
  updated = applyBuff(updated, {
    id: 'item_cd_tracer_dust',
    stacks: 1,
    cyclesRemaining: 0, // No cooldown
    source: 'tracer_dust',
  })

  // Apply reveal buff to self
  updated = applyBuff(updated, {
    id: 'dust_reveal',
    stacks: 1,
    cyclesRemaining: 2,
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

  const fountainZone = player.team === 'chaff' ? 'chaff-fountain' : 'audit-fountain'

  updated = applyBuff(updated, {
    id: 'tp_channeling',
    stacks: 1,
    cyclesRemaining: 3,
    source: 'recall_token',
  })

  updated = applyBuff(updated, {
    id: 'tp_destination',
    stacks: 1,
    cyclesRemaining: 4,
    source: 'recall_token',
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
      return yield* Effect.fail(new ItemNotFoundError({ itemId: 'jump_shunt' }))
    }

    let updated: PlayerState = { ...player, zone: zoneId }
    updated = applyBuff(updated, {
      id: 'item_cd_blink_module',
      stacks: 1,
      cyclesRemaining: 12,
      source: 'jump_shunt',
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

    const currentZone = ZONE_MAP[targetPlayer.zone]
    if (!currentZone || currentZone.adjacentTo.length === 0) {
      return yield* Effect.fail(new InvalidTargetError({ reason: 'No adjacent zone to push to' }))
    }

    // Deterministic disengage: shove the target one zone toward THEIR OWN
    // fountain (the safe direction). Replaces an earlier random push that could
    // fling them DEEPER into danger — and keeps the active replay-deterministic.
    const homeFountain = targetPlayer.team === 'chaff' ? 'chaff-fountain' : 'audit-fountain'
    const hasZone = (id: string) => id in state.zones
    const pushZone = [...currentZone.adjacentTo].sort(
      (a, b) => getDistance(a, homeFountain, hasZone) - getDistance(b, homeFountain, hasZone),
    )[0]!

    let updated: PlayerState = { ...targetPlayer, zone: pushZone }

    // Apply cooldown to caster
    if (targetPlayer.id !== player.id) {
      const caster = applyBuff(player, {
        id: 'item_cd_force_staff',
        stacks: 1,
        cyclesRemaining: 12,
        source: 'shove_splice',
      })
      return updatePlayers(state, [caster, updated])
    }

    updated = applyBuff(updated, {
      id: 'item_cd_force_staff',
      stacks: 1,
      cyclesRemaining: 12,
      source: 'shove_splice',
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

    // Deterministic disengage: among the zones away from the target, thrust to
    // the one closest to our OWN fountain. Was a random pick that could fling the
    // caster toward the ENEMY base — and broke replay determinism (same fix as
    // Shove Splice).
    const homeFountain = player.team === 'chaff' ? 'chaff-fountain' : 'audit-fountain'
    const hasZone = (id: string) => id in state.zones
    const pushZone = [...safeZones].sort(
      (a, b) => getDistance(a, homeFountain, hasZone) - getDistance(b, homeFountain, hasZone),
    )[0]!

    let updated: PlayerState = { ...player, zone: pushZone }
    // "Can attack during push": a brief attack steroid for the 2-tick thrust
    // window. The flat bonus lives in `stacks` and is summed in getEffectiveAttack
    // (mirrors gait_rig_attack). Previously stacks:1 with no reader = dead.
    updated = applyBuff(updated, {
      id: 'kickback_splice_attacks',
      stacks: 30,
      cyclesRemaining: 2,
      source: 'kickback_splice',
    })
    updated = applyBuff(updated, {
      id: 'item_cd_hurricane_pike',
      stacks: 1,
      cyclesRemaining: 14,
      source: 'kickback_splice',
    })

    return updatePlayer(state, updated)
  })
}

// ── Offensive Item Implementations ────────────────────────────────

function useSilverEdge(state: GameState, player: PlayerState): GameState {
  let updated = applyBuff(player, {
    id: 'ghostwire_edge_invis',
    stacks: 1,
    cyclesRemaining: 3,
    source: 'ghostwire_edge',
  })
  updated = applyBuff(updated, {
    id: 'ghostwire_edge_bonus',
    // Matches the invis window (3 ticks) so the empowered hit can't linger past
    // stealth even if the holder never attacks; the attack-gate already requires
    // active invis, so this is belt-and-suspenders.
    stacks: 150,
    cyclesRemaining: 3,
    source: 'ghostwire_edge',
  })
  updated = applyBuff(updated, {
    id: 'item_cd_silver_edge',
    stacks: 1,
    cyclesRemaining: 18,
    source: 'ghostwire_edge',
  })
  return updatePlayer(state, updated)
}

function useBurnout(
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

    // Deal 300 code damage — blocked by magic immunity (Hardshell/invulnerable),
    // amplified by magic-vuln / Yield on the target.
    const baseDamage = isDamageImmune(targetPlayer, 'code')
      ? 0
      : calculateCodeDamage(300, targetPlayer.ice)
    const damage = Math.round(baseDamage * getIncomingDamageMultiplier(targetPlayer, 'code'))
    const newInteg = Math.max(0, targetPlayer.integ - damage)

    const updatedCaster = applyBuff(player, {
      id: 'item_cd_burnout',
      stacks: 1,
      cyclesRemaining: 18,
      source: 'burnout',
    })

    const updatedTarget: PlayerState = {
      ...targetPlayer,
      integ: newInteg,
      alive: newInteg > 0,
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

    // Apply ethereal form: immune to kinetic, +40% magic vuln
    let updatedTarget = applyBuff(targetPlayer, {
      id: 'ethereal',
      stacks: 1,
      cyclesRemaining: 2,
      source: 'phase_shim',
    })
    updatedTarget = applyBuff(updatedTarget, {
      id: 'magic_vuln_40',
      stacks: 40,
      cyclesRemaining: 2,
      source: 'phase_shim',
    })

    const updatedCaster = applyBuff(player, {
      id: 'item_cd_ethereal_blade',
      stacks: 1,
      cyclesRemaining: 15,
      source: 'phase_shim',
    })

    return updatePlayers(state, [updatedCaster, updatedTarget])
  })
}

// ── Defensive Item Implementations ────────────────────────────────

function useFirewallItem(state: GameState, player: PlayerState): GameState {
  let updated = applyBuff(player, {
    id: 'firewall_block',
    stacks: 1,
    cyclesRemaining: 30,
    source: 'ablative_shell',
  })
  updated = applyBuff(updated, {
    id: 'item_cd_firewall_item',
    stacks: 1,
    cyclesRemaining: 30,
    source: 'ablative_shell',
  })
  return updatePlayer(state, updated)
}

function useBlackKingBar(state: GameState, player: PlayerState): GameState {
  let updated = applyBuff(player, {
    id: 'airgap',
    stacks: 1,
    cyclesRemaining: 4,
    source: 'hardshell',
  })
  updated = applyBuff(updated, {
    id: 'item_cd_hardshell',
    stacks: 1,
    cyclesRemaining: 25,
    source: 'hardshell',
  })
  return updatePlayer(state, updated)
}

function useBladeMail(state: GameState, player: PlayerState): GameState {
  let updated = applyBuff(player, {
    id: 'spite_plate',
    stacks: 100, // 100% return
    cyclesRemaining: 3,
    source: 'spite_plate',
  })
  updated = applyBuff(updated, {
    id: 'item_cd_spite_plate',
    stacks: 1,
    cyclesRemaining: 18,
    source: 'spite_plate',
  })
  return updatePlayer(state, updated)
}

function useGhostScepter(state: GameState, player: PlayerState): GameState {
  let updated = applyBuff(player, {
    id: 'ghost_form',
    stacks: 1,
    cyclesRemaining: 2,
    source: 'phase_shunt',
  })
  updated = applyBuff(updated, {
    id: 'item_cd_ghost_scepter',
    stacks: 1,
    cyclesRemaining: 20,
    source: 'phase_shunt',
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
    id: 'mirror_shell',
    stacks: 1,
    cyclesRemaining: 5,
    source: 'mirror_shell',
  })

  // Apply cooldown to caster
  if (targetPlayer.id !== player.id) {
    const caster = applyBuff(player, {
      id: 'item_cd_lotus_orb',
      stacks: 1,
      cyclesRemaining: 15,
      source: 'mirror_shell',
    })
    return Effect.succeed(updatePlayers(state, [caster, updated]))
  }

  updated = applyBuff(updated, {
    id: 'item_cd_lotus_orb',
    stacks: 1,
    cyclesRemaining: 15,
    source: 'mirror_shell',
  })

  return Effect.succeed(updatePlayer(state, updated))
}

// ── Utility Item Implementations ──────────────────────────────────

function useStackOverflow(state: GameState, player: PlayerState): GameState {
  let updated = applyBuff(player, {
    id: 'stack_overflow_buff',
    stacks: 1,
    cyclesRemaining: 10,
    source: 'stack_overflow',
  })
  updated = applyBuff(updated, {
    id: 'item_cd_stack_overflow',
    stacks: 1,
    cyclesRemaining: 20,
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
    cyclesRemaining: 40,
    source: 'redline_splice',
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
      cyclesRemaining: 2,
      source: 'stasis_shunt',
    })
    updated = applyBuff(updated, {
      id: 'invulnerable',
      stacks: 1,
      cyclesRemaining: 2,
      source: 'stasis_shunt',
    })

    // Apply cooldown to caster
    if (targetPlayer.id !== player.id) {
      const caster = applyBuff(player, {
        id: 'item_cd_euls_scepter',
        stacks: 1,
        cyclesRemaining: 15,
        source: 'stasis_shunt',
      })
      return updatePlayers(state, [caster, updated])
    }

    updated = applyBuff(updated, {
      id: 'item_cd_euls_scepter',
      stacks: 1,
      cyclesRemaining: 15,
      source: 'stasis_shunt',
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
      cyclesRemaining: 2,
      source: 'lockout_shunt',
    })
    updatedTarget = applyBuff(updatedTarget, {
      id: 'silence',
      stacks: 1,
      cyclesRemaining: 2,
      source: 'lockout_shunt',
    })

    const updatedCaster = applyBuff(player, {
      id: 'item_cd_scythe_of_vyse',
      stacks: 1,
      cyclesRemaining: 20,
      source: 'lockout_shunt',
    })

    return updatePlayers(state, [updatedCaster, updatedTarget])
  })
}

function useVeilOfDiscord(state: GameState, player: PlayerState): GameState {
  // "Enemies in zone take 25% more code damage." The debuff belongs on the
  // enemies in the caster's zone — it was previously (wrongly) applied to the
  // caster. The magic-vuln amp is consumed by dealDamage's incoming-magic
  // multiplier.
  const enemies = getEnemiesInZone(state, player).map((e) =>
    applyBuff(e, {
      id: 'veil_discord',
      stacks: 25, // +25% code damage taken
      cyclesRemaining: 4,
      source: 'discord_routine',
    }),
  )
  // Only the cooldown marker stays on the caster.
  const caster = applyBuff(player, {
    id: 'item_cd_veil_of_discord',
    stacks: 1,
    cyclesRemaining: 15,
    source: 'discord_routine',
  })
  return updatePlayers(state, [caster, ...enemies])
}

function useShivasGuard(state: GameState, player: PlayerState): GameState {
  // Arctic Blast: a code nova that DAMAGES and SLOWS every enemy in the
  // caster's zone. (Previously applied shivas_blast/shivas_slow buffs to the
  // caster that nothing consumed — the active did nothing.)
  const BLAST_DAMAGE = 100
  const players = { ...state.players }
  for (const enemy of Object.values(state.players)) {
    if (enemy.team === player.team || !enemy.alive || enemy.zone !== player.zone) continue
    const base = isDamageImmune(enemy, 'code') ? 0 : calculateCodeDamage(BLAST_DAMAGE, enemy.ice)
    const dmg = Math.round(base * getIncomingDamageMultiplier(enemy, 'code'))
    // 'slow' (not the dead 'shivas_slow') is the id ActionResolver consumes:
    // total stacks = % chance a move fails this cycle.
    const slowed = applyBuff(enemy, {
      id: 'slow',
      stacks: 40,
      cyclesRemaining: 2,
      source: 'cryo_routine',
    })
    players[enemy.id] = { ...slowed, integ: Math.max(0, slowed.integ - dmg) }
  }
  players[player.id] = applyBuff(player, {
    id: 'item_cd_shivas_guard',
    stacks: 1,
    cyclesRemaining: 20,
    source: 'cryo_routine',
  })
  return { ...state, players }
}

function usePowerTreads(state: GameState, player: PlayerState): GameState {
  // Cycle through modes: attack -> hp -> mp -> attack
  const currentMode = player.buffs.find((b) => b.id.startsWith('gait_rig_'))?.id

  // Modes SWITCH, they don't stack — the three mode buffs have distinct ids, so
  // applyBuff wouldn't replace the old one. Strip any existing mode buff first,
  // otherwise toggling leaves attack+hp both active and the cycle gets stuck.
  const base: PlayerState = {
    ...player,
    buffs: player.buffs.filter((b) => !b.id.startsWith('gait_rig_')),
  }

  let updated: PlayerState
  switch (currentMode) {
    case 'gait_rig_attack':
      // Switch to INTEG mode
      updated = applyBuff(base, {
        id: 'gait_rig_hp',
        stacks: 150,
        cyclesRemaining: 999,
        source: 'gait_rig',
      })
      break
    case 'gait_rig_hp':
      // Switch to BW mode
      updated = applyBuff(base, {
        id: 'gait_rig_mp',
        stacks: 100,
        cyclesRemaining: 999,
        source: 'gait_rig',
      })
      break
    default:
      // Default to attack mode
      updated = applyBuff(base, {
        id: 'gait_rig_attack',
        stacks: 15,
        cyclesRemaining: 999,
        source: 'gait_rig',
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
