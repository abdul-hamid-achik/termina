import { Effect, Either } from 'effect'
import type {
  WaveUnitState,
  GameState,
  PlayerState,
  TeamId,
  TeamState,
  IceState,
  TerminalState,
  ZoneRuntimeState,
  SiltDwellerState,
  CacheState,
} from '~~/shared/types/game'
import type { DamageType } from '~~/shared/types/hero'
import type { Command, TargetRef } from '~~/shared/types/commands'
import {
  resolveAbility,
  getAbilityLevel,
  absorbShield,
  findTargetPlayer,
  type AbilitySlot,
} from '~~/server/game/heroes'
import {
  getEffectiveAttack,
  getEffectivePlate,
  getEffectiveIce,
  getAttackMultiplier,
  getTalentStatBonus,
  getItemStatBonuses,
  hasTalentCastEffect,
} from '~~/shared/utils/effectiveStats'
import { areAdjacent, findPath } from '~~/server/game/map/topology'
import { isCommandAllowedInTutorial, tutorialLockMessage } from '~~/server/game/modes/tutorial'
import { isBot } from '~~/server/game/ai/BotManager'
import { isTrainingWave } from '~~/shared/constants/tutorial'
import { isShopZoneFor, ZONE_MAP } from '~~/shared/constants/zones'
import {
  calculateKineticDamage,
  calculateCodeDamage,
  getIncomingDamageMultiplier,
  isDamageImmune,
} from '~~/shared/utils/damageCalc'
import { computeSpitePlateReflect } from './CombatResolver'
import { filterStateForPlayer } from './VisionCalculator'
import {
  describeHopSources,
  holdsWalk,
  predictHopDamage,
  type HopDamage,
} from '~~/shared/utils/hopDamage'
import { placeWard, canAttackIce } from '~~/server/game/map/zones'
import { HEROES } from '~~/shared/constants/heroes'
import { stampEventZones, type GameEngineEvent } from '~~/server/game/protocol/events'
import { applyBuff, isBreached, hasBuff, isHardControlBuffId } from '~~/server/game/heroes/_base'
import { DEBUFF_ID_SETS, hasDebuff, disableBlockReason } from './disables'
import { buyItem, sellItem, useItem, itemCooldownId } from '~~/server/game/items/shop'
import { awardLastHit, awardIceKill, waveStripScrip } from './ScripDistributor'
import { pickupBackup } from './TenantAI'
import { pickupCache } from './CacheAI'
import { resolveTerminalAttack, TERMINAL_ZONES } from './TerminalSystem'
import {
  STRUCTURE_REFUSAL,
  structureRefusal,
  structureWalkNote,
  structureZone,
} from '~~/shared/utils/structureRules'
import { ITEMS } from '~~/shared/constants/items'
import {
  WAVE_XP,
  SILT_DWELLERS,
  type SiltDwellerType,
  WAVE_SCRIP_MIN,
  WAVE_SCRIP_MAX,
  waveUnitMaxHp,
  WAVE_XP_SHARED,
  HARDEN_COOLDOWN_CYCLES,
  BREACH_DURATION_CYCLES,
  BREACH_COOLDOWN_CYCLES,
  BREACH_BW_COST,
  BURN_HP_THRESHOLD,
  STRIP_HP_THRESHOLD,
  BURN_SCRIP_RATIO,
  BURN_XP_RATIO,
  NULL_POINTER_CRIT_CHANCE,
  NULL_POINTER_CRIT_MULTIPLIER,
  FRACTURE_EDGE_CRIT_CHANCE,
  FRACTURE_EDGE_CRIT_MULTIPLIER,
  KILLSHOT_COIL_CRIT_CHANCE,
  KILLSHOT_COIL_CRIT_MULTIPLIER,
  BULWARK_PLATE_BLOCK_CHANCE,
  BULWARK_PLATE_BLOCK_AMOUNT,
  RUST_DRIVER_PLATE_REDUCTION,
  SIEGE_LATTICE_AURA_PLATE,
  TRUESTRIKE_RIG_BONUS_DAMAGE,
  CLOT_RING_REGEN_PERCENT,
  DRIP_MASK_REGEN_PERCENT,
  BULK_LATTICE_REGEN_PERCENT,
  SELL_REFUND_RATIO,
  DOUBLE_CAST_CHANCE,
  SPELL_LIFESTEAL_PERCENT,
} from '~~/shared/constants/balance'
import type { ItemStats } from '~~/shared/types/items'
import { runAntiCheatChecks, type CheatDetection } from '~~/server/utils/AntiCheat'
import { wsLog } from '~~/server/utils/log'
import { isRealProduction } from '~~/server/utils/testHooks'
import { awardZoneXp } from './XpDistributor'
import { compareCodePoints } from './rng'

/** Ticks before Intercept Shell recharges its spell-block after spending one. */
const LINKENS_RECHARGE_TICKS = 12

// ── Types ──────────────────────────────────────────────────────

export interface PlayerAction {
  playerId: string
  command: Command
  /** Auto-path continuation synthesized by GameLoop (not typed by the player)
   *  — its rejections are silent so a rooted/slowed walker isn't spammed with
   *  warnings for a command they issued ticks ago. */
  synthesized?: boolean
  /** A swing the engine forced (taunt) in place of the player's own action. It
   *  resolves like any attack but is not the player's order, so it never
   *  becomes the held attack (holdTarget). */
  forced?: boolean
  /** Set when GameLoop converted a control cast into a CLOSED hero into this
   *  breach (convertClosedControlCast) — names the ability that was ordered. */
  convertedFrom?: { ability: AbilitySlot; abilityName: string }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface ResolvedChanges {
  players: Record<string, PlayerState>
  events: GameEngineEvent[]
  heroAttackers: Map<string, string> // attackerId -> victimId
}

// ── Batch Update System ────────────────────────────────────────

interface PlayerUpdates {
  [playerId: string]: Partial<PlayerState>
}

function applyPlayerUpdates(
  players: Record<string, PlayerState>,
  updates: PlayerUpdates,
): Record<string, PlayerState> {
  if (Object.keys(updates).length === 0) return players

  const newPlayers = { ...players }
  for (const [id, changes] of Object.entries(updates)) {
    const player = newPlayers[id]
    if (player) {
      newPlayers[id] = { ...player, ...changes }
    }
  }
  return newPlayers
}

/**
 * Resolve a zone-local wave index to the wave and its global array index.
 * Clients (look / ActionRow, autocomplete) count waves within the player's zone —
 * the global waves array is vision-filtered before broadcast, so global
 * indices mean different things on each side. Filtering preserves order, so
 * "Nth wave in this zone" is identical for client and server.
 */
/** Total INTEG a hero's shield buffs can still soak. */
function shieldPool(p: PlayerState): number {
  return p.buffs.reduce((sum, b) => (b.id === 'shield' ? sum + Math.max(0, b.stacks) : sum), 0)
}

/**
 * Why a damaging cast cost an enemy hero (pre → post) no INTEG, read off the
 * state the cast left behind (dealDamage consumes phaseShift on a dodge and
 * shield stacks on an absorb; immunity leaves no trace, so it is only claimed
 * for the cast's own single target). Null when nothing says the hit landed on
 * them at all (an AoE that never reached them).
 */
function castBlockReason(
  pre: PlayerState,
  post: PlayerState,
  isCastTarget: boolean,
  damageType: DamageType,
): { reason: 'shield' | 'dodge' | 'immune'; amount?: number } | null {
  const hadDodge = pre.buffs.some((b) => b.id === 'phaseShift')
  if (hadDodge && !post.buffs.some((b) => b.id === 'phaseShift')) return { reason: 'dodge' }
  const soaked = shieldPool(pre) - shieldPool(post)
  if (soaked > 0) return { reason: 'shield', amount: soaked }
  if (isCastTarget && isDamageImmune(pre, damageType)) return { reason: 'immune' }
  return null
}

/**
 * Tutorial training units (TRAINING_WAVE_PREFIX) belong to the human's drill:
 * a bot's swing or burn aimed at one is refused. BotAI never picks one; this is
 * the engine-side guarantee (a stale index, a converted slot), so no bot can
 * strip the replanted unit for scrip or burn the player's drill target.
 */
function trainingUnitRefusal(
  state: GameState,
  action: PlayerAction,
  target: TargetRef,
): string | null {
  if (target.kind !== 'wave' || !isBot(action.playerId)) return null
  const zone = state.players[action.playerId]?.zone
  if (zone === undefined) return null
  const hit = waveInZoneByIndex(state.waves ?? [], zone, target.index)
  return hit && isTrainingWave(hit.wave) ? 'Training unit — reserved for the drill' : null
}

function waveInZoneByIndex(
  waves: WaveUnitState[],
  zone: string,
  index: number,
): { wave: WaveUnitState; globalIdx: number } | null {
  let seen = 0
  for (let i = 0; i < waves.length; i++) {
    const c = waves[i]!
    if (c.zone !== zone) continue
    if (seen === index) return { wave: c, globalIdx: i }
    seen++
  }
  return null
}

/**
 * The refusal for `attack wave:N` at one of the attacker's OWN units. wave:N
 * counts every unit in the zone, both crews, in list order (waveInZoneByIndex)
 * — so "your own wave" alone left the player guessing which N is the enemy
 * (playtest 2). Names the indices that would work, in that same index space:
 * the first living enemy unit to strip, and the burn when this unit is inside
 * the burn window.
 */
function ownWaveRefusal(
  waves: WaveUnitState[],
  attacker: PlayerState,
  index: number,
  wave: WaveUnitState,
): string {
  const inZone = waves.filter((w) => w.zone === attacker.zone)
  const enemyIdx = inZone.findIndex((w) => w.team !== attacker.team && w.integ > 0)
  const burnMax = wave.maxInteg ?? waveUnitMaxHp(wave.type, 0)
  const burnable = wave.integ <= burnMax * BURN_HP_THRESHOLD
  const head = `wave:${index} is YOUR unit — `
  const burn = `\`burn wave:${index}\` denies it`
  const windowNote = `(burn opens at ≤${Math.round(BURN_HP_THRESHOLD * 100)}% INTEG)`
  if (enemyIdx < 0) {
    const none = 'no enemy unit in this zone right now'
    return burnable ? `${head}${burn} (${none})` : `${head}${none} ${windowNote}`
  }
  const enemy = `\`attack wave:${enemyIdx}\` is the enemy one`
  return burnable ? `${head}${burn}, or ${enemy}` : `${head}${enemy} ${windowNote}`
}

/**
 * Resolve a zone-local neutral index to the camp and its global array index —
 * mirrors `waveInZoneByIndex` for the same reason. `state.neutrals` is now
 * vision-filtered before broadcast (Silt camps respect fog like waves), so a
 * client-side GLOBAL index would name a different camp than the one it
 * showed. Filtering preserves order, so "Nth camp in this zone" is identical
 * for client and server.
 */
function neutralInZoneByIndex(
  neutrals: SiltDwellerState[],
  zone: string,
  index: number,
): { neutral: SiltDwellerState; globalIdx: number } | null {
  let seen = 0
  for (let i = 0; i < neutrals.length; i++) {
    const n = neutrals[i]!
    if (n.zone !== zone) continue
    if (seen === index) return { neutral: n, globalIdx: i }
    seen++
  }
  return null
}

// ── Validation ─────────────────────────────────────────────────

/** Validate an action against the current game state. */
export function validateAction(state: GameState, action: PlayerAction): string | null {
  const player = state.players[action.playerId]
  if (!player) return 'Player not found'
  if (!player.alive) return 'Player is dead'
  // Stasis Shunt Cyclone lifts the target into a tornado — fully disabled (and
  // invulnerable, enforced in the damage paths) until it expires.
  if (hasDebuff(player, 'cyclone')) return 'Cannot act while cycloned'

  // Lockout Shunt Hex is a hard disable — no move, attack, OR cast. (The
  // co-applied 'silence' only gates casting, so without this a hexed hero could
  // still basic-attack.)
  if (hasDebuff(player, 'hex')) return 'Cannot act while hexed'

  // Hardshell (airgap) grants debuff immunity ("immune to ... debuffs"):
  // a Hardshell-active hero acts through the standard control debuffs — stun, silence,
  // root, fear, taunt (see disableBlockReason). Cyclone and Hex are hard
  // disables that pierce it (checked above), matching the usual convention.

  const cmd = action.command

  // Tutorial mode gates commands behind staggered unlocks so a new player learns
  // one verb at a time. Informational commands always pass; everything else must
  // be unlocked by the current step (the gate is a no-op in normal games).
  // BOTS are exempt: gating them froze the whole tutorial world — no farming
  // ally, no pushing waves, a silent feed — until the human advanced the steps.
  // The learner should study a LIVE game; safety comes from the 'easy' bot
  // difficulty, not from paralysis.
  if (
    state.mode === 'tutorial' &&
    !isBot(action.playerId) &&
    !isCommandAllowedInTutorial(cmd.type, state.tutorialStep ?? 0)
  ) {
    return tutorialLockMessage(state.tutorialStep ?? 0)
  }

  switch (cmd.type) {
    case 'move': {
      // Auto-path: ANY zone of THIS game's map with a path from here is a valid
      // order — the hero walks one zone per cycle toward it (resolveMovementPhase
      // takes the next hop; GameLoop re-issues the move until arrival). Gating on
      // the game's live zone set keeps subset maps (one-lane) closed, else a
      // player could step out of the map into an uninitialized zone.
      const reachable =
        player.zone === cmd.zone ||
        (!!state.zones[cmd.zone] &&
          findPath(player.zone, cmd.zone, (id) => !!state.zones[id]).length > 0)
      if (!reachable) {
        return 'No path to that zone'
      }
      // Root/stun/taunt (taunt forces attacking — no fleeing). Hardshell bypasses.
      return disableBlockReason(player, 'move')
    }
    case 'attack': {
      return disableBlockReason(player, 'attack') ?? trainingUnitRefusal(state, action, cmd.target)
    }
    case 'cast': {
      const castBlocked = disableBlockReason(player, 'cast')
      if (castBlocked) return castBlocked
      if (!player.heroId) return 'No hero selected'

      const hero = HEROES[player.heroId]
      if (!hero) return 'Unknown hero'

      const ability = hero.abilities[cmd.ability]
      if (!ability) return 'Unknown ability'
      // Auto-leveling gate: Q/W/E unlock at level 1, R at level 6 (_base.getAbilityLevel)
      if (getAbilityLevel(player.level, cmd.ability) < 1) {
        return cmd.ability === 'r' ? 'Ultimate unlocks at level 6' : 'Ability not yet learned'
      }
      if (player.cooldowns[cmd.ability] > 0) {
        // Concrete rejection (design brief, quick win #1): name + ticks + ready cycle.
        const cd = player.cooldowns[cmd.ability]
        return `${ability.name} on cooldown — ${cd} cycle${cd === 1 ? '' : 's'} left (ready T${state.cycle + cd})`
      }
      // Single-target hard control on a CLOSED enemy. GameLoop converts such an
      // order into a breach whenever the caster could breach that target right
      // now (convertClosedControlCast), so reaching this branch means the
      // breach itself is blocked — name the precise blocker. AoE control cannot
      // be pre-rejected — it fizzles per-target inside applyBuff and is reported
      // as a control_resisted event.
      const closed = closedControlTarget(state, player, cmd)
      if (closed) return closedCastRejection(state, action.playerId, cmd, closed)
      // No BW check here — per-hero scaled costs live in the resolver files;
      // the resolver's InsufficientBwError is authoritative and surfaced
      // through resolveActions' rejected channel.
      return null
    }
    case 'buy': {
      if (!isShopZoneFor(player.zone, player.team)) return 'Not in a shop zone'
      return null
    }
    case 'sell': {
      if (!isShopZoneFor(player.zone, player.team)) return 'Not in a shop zone'
      return null
    }
    case 'use': {
      // Check player owns the item
      const ownedItems = player.items.filter(Boolean)
      if (!ownedItems.includes(cmd.item)) return 'Item not owned'
      // Check item has active ability
      const itemDef = ITEMS[cmd.item]
      if (!itemDef?.active) return 'Item has no active ability'
      // Check item is not on cooldown (via buff)
      const cdBuff = player.buffs.find((b) => b.id === itemCooldownId(cmd.item))
      if (cdBuff && cdBuff.cyclesRemaining > 0) return 'Item on cooldown'
      return null
    }
    case 'tap': {
      if (!areAdjacent(player.zone, cmd.zone) && player.zone !== cmd.zone) {
        return 'Ward zone must be current or adjacent'
      }
      return null
    }
    case 'scan':
    case 'status':
    case 'map':
    case 'help':
    case 'chat':
    case 'ping':
      return null
    case 'backup': {
      // Loud rejection instead of a silent no-op: pickupBackup only fires when
      // the player stands in the Hollow with a Backup on the ground, so a grab
      // anywhere else must not quietly burn the player's one action.
      if (!state.backup) return 'No Backup on the ground right now'
      if (player.zone !== 'hollow') return 'The Backup is in the Hollow — pick it up there'
      return null
    }
    case 'grab': {
      // Same rule as pickupCache: a cache must be standing in your zone. The
      // CACHE touch button only shows when one is, but the typed verb needs
      // the rejection to keep the cycle honest.
      if (!(state.caches ?? []).some((c) => c.zone === player.zone)) {
        return 'No cache in this zone to grab'
      }
      return null
    }
    case 'buyback':
      // Validation happens in GameLoop where we have access to buyback system
      return null
    case 'surrender':
      // Always valid, handled in GameLoop
      return null
    case 'missing':
      // Ping system, always valid
      return null
    case 'burn':
      if (cmd.target.kind !== 'wave') {
        return 'Can only burn waves'
      }
      return trainingUnitRefusal(state, action, cmd.target)
    case 'select_talent':
      return null
    case 'harden':
      return null
    case 'breach': {
      const breachBlocked = disableBlockReason(player, 'breach')
      if (breachBlocked) return breachBlocked
      if (hasDebuff(player, 'cyclone')) return 'Cannot act while cycloned'
      if (hasDebuff(player, 'hex')) return 'Cannot act while hexed'

      // Early flush: breach self strips own breached buff (costs cycle + BW).
      if (cmd.target.kind === 'self') {
        if (!isBreached(player)) return 'You are not breached'
        if (player.bw < BREACH_BW_COST) return `Need ${BREACH_BW_COST} BW to flush breach`
        return null
      }

      if (cmd.target.kind !== 'hero') return 'Can only breach an enemy hero'
      const target = findTargetPlayer(state, cmd.target)
      if (!target) return `Unknown target "${cmd.target.name}"`
      if (target.team === player.team) return 'Cannot breach an ally'
      if (!target.alive) return 'Target is down'
      if (target.zone !== player.zone) return 'Target not in your zone'
      if (hasBuff(target, 'airgap')) return `${target.name} is AIRGAPPED — breach fails`
      if (player.bw < BREACH_BW_COST) return `Need ${BREACH_BW_COST} BW to breach`
      const cd = player.buffs.find((b) => b.id === 'item_cd_breach' && b.cyclesRemaining > 0)
      if (cd) {
        return `Breach on cooldown — ${cd.cyclesRemaining} cycle${cd.cyclesRemaining === 1 ? '' : 's'} left`
      }
      return null
    }
    default:
      return null
  }
}

// ── Auto-breach (CLOSED control casts) ─────────────────────────

type CastCommand = Extract<Command, { type: 'cast' }>

/**
 * The CLOSED enemy hero a single-target hard-control cast is aimed at, or null.
 * CLOSED = alive enemy, not breached, not AIRGAPPED (an airgapped hero cannot be
 * breached; its control immunity is its own rule). Only `targetType: 'hero'`
 * abilities qualify — AoE control fizzles per target inside applyBuff and is
 * reported as `control_resisted` instead.
 * Effect types map to buff ids: fear → feared; the rest share names.
 */
function closedControlTarget(
  state: GameState,
  player: PlayerState,
  cmd: CastCommand,
): PlayerState | null {
  if (cmd.target?.kind !== 'hero' || !player.heroId) return null
  const ability = HEROES[player.heroId]?.abilities[cmd.ability]
  if (!ability || ability.targetType !== 'hero') return null
  const carriesHardControl = ability.effects.some((e) =>
    isHardControlBuffId(e.type === 'fear' ? 'feared' : e.type),
  )
  if (!carriesHardControl) return null
  const target = findTargetPlayer(state, cmd.target)
  // Out of the caster's zone the cast is left to its resolver: a reach/dash
  // (Malloc E next door) or a swap that finds them anywhere (Regex E) lands its
  // damage/movement and the control fizzles as control_resisted; a same-zone
  // ability is refused with the resolver's ordinary out-of-zone line. Reading
  // CLOSED / breached / AIRGAP before the zone would also hand the caster a free
  // status oracle on a hero they may not even see.
  if (!target || target.zone !== player.zone) return null
  if (
    target.team === player.team ||
    !target.alive ||
    isBreached(target) ||
    hasBuff(target, 'airgap')
  ) {
    return null
  }
  return target
}

/** The `breach` order a CLOSED control cast stands in for. */
function breachOrderFor(playerId: string, cmd: CastCommand): PlayerAction {
  return {
    playerId,
    command: { type: 'breach', target: cmd.target ?? { kind: 'self' } },
  }
}

/**
 * Why a control cast into a CLOSED hero cannot become a breach this cycle. The
 * breach's own validation (validateAction on the equivalent `breach` order) is
 * the single source of truth; this only rewords its blocker so the line names
 * the target and the fix. The caster-side disables (stun, fear, taunt, cyclone,
 * hex) were already reported by the cast gates that run first, and the target
 * shares the caster's zone (closedControlTarget), so what is left is BW,
 * cooldown — or a tutorial lock, passed through verbatim.
 */
function closedCastRejection(
  state: GameState,
  playerId: string,
  cmd: CastCommand,
  target: PlayerState,
): string {
  const n = target.name
  const blocker = validateAction(state, breachOrderFor(playerId, cmd))
  if (blocker === null) return `${n} is CLOSED — breach ${n} first`
  const player = state.players[playerId]!
  if (player.bw < BREACH_BW_COST) {
    return `${n} is CLOSED — need ${BREACH_BW_COST} BW to breach ${n} (have ${Math.floor(player.bw)})`
  }
  const cd = player.buffs.find((b) => b.id === 'item_cd_breach' && b.cyclesRemaining > 0)
  if (cd) {
    const c = cd.cyclesRemaining
    return `${n} is CLOSED — breach ready in ${c} cycle${c === 1 ? '' : 's'}`
  }
  return `${n} is CLOSED — ${blocker}`
}

/**
 * Auto-breach (owner decision). A single-target hard-control cast aimed at a
 * CLOSED enemy hero used to be refused and waste the cycle. When the CLOSED
 * target is the ONLY thing stopping the cast and the caster could legally
 * `breach` that target right now (the exact validation a typed breach gets),
 * the order is converted into that breach: it spends the cycle, the BW and the
 * breach cooldown exactly like a typed breach and resolves in the breach phase
 * (before movement — resolveBreachPhase); the ability's BW and cooldown are untouched. The breach_opened event
 * carries `fromAbility` so the caster is told why.
 *
 * Called by GameLoop BEFORE validateAction, for every drained action — humans
 * and bots alike — so the rest of the cycle (validation, hero passives, the
 * tutorial check) sees a breach, never a phantom cast. Idempotent; any other
 * action is returned unchanged.
 */
export function convertClosedControlCast(state: GameState, action: PlayerAction): PlayerAction {
  const cmd = action.command
  if (cmd.type !== 'cast' || cmd.target?.kind !== 'hero') return action
  const player = state.players[action.playerId]
  if (!player) return action
  const target = closedControlTarget(state, player, cmd)
  if (!target) return action
  // Every earlier cast gate (alive, disables, tutorial lock, learned,
  // cooldown) must have passed — i.e. the cast's rejection IS the CLOSED one.
  if (validateAction(state, action) !== closedCastRejection(state, action.playerId, cmd, target)) {
    return action
  }
  const breach = breachOrderFor(action.playerId, cmd)
  if (validateAction(state, breach) !== null) return action
  const abilityName =
    (player.heroId ? HEROES[player.heroId]?.abilities[cmd.ability]?.name : undefined) ??
    cmd.ability.toUpperCase()
  return { ...breach, convertedFrom: { ability: cmd.ability, abilityName } }
}

// ── Structure approach (ICE / Terminal attacked from range) ────

/** What GameLoop does with an attack on a structure the attacker is not standing at. */
export type StructureApproach =
  /** Walk: validate + resolve this `move` instead, and hold `target` as the attack order.
   *  `note` is the reply owed with it (a Hardened ICE: how long it holds). */
  | { walk: PlayerAction; target: TargetRef; note?: string }
  /** The order can never land — refuse it now instead of walking the player there. */
  | { refuse: string }

/**
 * `attack ice:<zone>` / `attack terminal` from outside the structure's zone.
 *
 * ICE and Terminals never move, so such an order is a standing one: the hero
 * walks there one hop per cycle (the `move` auto-path, so root/stun/taunt and
 * slow gate it exactly as they gate a walk) and the held attack order swings
 * on the cycle after arrival — GameLoop's standing-order continuation, the same
 * re-swing an in-zone ICE attack already gets. Hero targets are NOT converted:
 * heroes move, and walking at where one stood is a chase the player did not ask
 * for.
 *
 * A typed order that can never land (tier order, own ICE, a firewalled or dead
 * Terminal) is refused at the order — the player is not walked under a
 * structure only to be told on arrival. A Hardened ICE is NOT refused: Harden
 * is temporary (5 cycles), the walk may outlast it, and the held order waits
 * it out at the ICE anyway — the order goes ahead with a `note` saying how long
 * the Harden still holds (structureWalkNote).
 *
 * Only a TYPED order starts a walk. A synthesized re-swing that finds its
 * attacker out of the structure's zone means something else moved them — a
 * recall/TP (an item active keeps the attack order, see KEEPS_ATTACK), a pull, a
 * swap — and walking them back across the map would be an order nobody gave.
 * It is left unconverted, so the attack phase retires it silently (the one
 * place that rule lives). The walk itself never needs this: it is the held
 * `moveTarget`, and on arrival the re-swing is in zone.
 *
 * Returns null for anything else (other targets, in-zone attacks, no player).
 * Pure; GameLoop runs it after the original order passed validateAction, so
 * the tutorial gate and the attack disables are judged on what was typed.
 */
export function approachStructure(
  state: GameState,
  action: PlayerAction,
): StructureApproach | null {
  const cmd = action.command
  if (cmd.type !== 'attack' || action.synthesized) return null
  const player = state.players[action.playerId]
  if (!player || !player.alive) return null
  const zone = structureZone(player.team, cmd.target)
  if (!zone || zone === player.zone) return null
  const refusal = structureRefusal(state.ice, state.terminals, player.team, cmd.target, {
    fromRange: true,
  })
  if (refusal) return { refuse: refusal }
  const note = structureWalkNote(state.ice, state.teams, cmd.target, state.cycle)
  return {
    walk: { playerId: action.playerId, command: { type: 'move', zone } },
    target: cmd.target,
    ...(note ? { note } : {}),
  }
}

/** Whether `zone` is under enemy fire for a hero on `team`: a living enemy ICE
 *  stands there (ICE shoots heroes in its own zone — IceAI). The enemy base on
 *  its own is NOT: a Terminal never shoots a hero. */
function underEnemyIce(state: GameState, team: TeamId, zone: string): boolean {
  return (state.ice ?? []).some((t) => t.alive && t.team !== team && t.zone === zone)
}

/** Item actives that restore INTEG (shop.ts useHealingSalve — a regen buff). A
 *  hero who uses one this cycle is managing their INTEG: the hold is not judged
 *  on the pre-heal reading. */
const INTEG_HEAL_ACTIVES: ReadonlySet<string> = new Set(['trauma_patch'])

/**
 * What one cycle in `zone` throws at hero `p` — the shared prediction
 * (shared/utils/hopDamage, the SAME code the client's danger preview runs),
 * fed only the walker's own view: filterStateForPlayer's fog rule decides which
 * wave units, Silt dwellers and enemy heroes count, so a hold can never leak a
 * stack or a position the player's cycle_state does not show. ICE and THE
 * TENANT are public. Wave damage is read at `state.cycle` — inside
 * processCycle that is already the cycle being resolved, the value WaveAI uses.
 */
export function predictedHopDamage(
  state: GameState,
  p: PlayerState,
  zone: string,
  drawsIceAggro: boolean,
): HopDamage {
  if (!hasAnythingHostile(state, p, zone)) {
    return { damage: 0, units: 0, ice: false, heroes: 0, neutrals: 0, tenant: false }
  }
  const view = filterStateForPlayer(state, p.id)
  return predictHopDamage(
    {
      cycle: state.cycle,
      waves: view.waves,
      neutrals: view.neutrals,
      ice: state.ice ?? [],
      tenant: state.tenant,
      players: view.players,
    },
    p,
    zone,
    drawsIceAggro,
  )
}

/** Cheap pre-check before building the walker's view: nothing in the raw zone
 *  could hurt anyone (a zero answer reveals nothing). */
function hasAnythingHostile(state: GameState, p: PlayerState, zone: string): boolean {
  return (
    (zone === 'hollow' && state.tenant?.alive === true) ||
    underEnemyIce(state, p.team, zone) ||
    (state.waves ?? []).some((w) => w.zone === zone && w.team !== p.team && w.integ > 0) ||
    (state.neutrals ?? []).some((n) => n.zone === zone && n.alive) ||
    Object.values(state.players ?? {}).some((e) => e.team !== p.team && e.alive && e.zone === zone)
  )
}

/** A zone's player-facing name ("Coldstore T1 (AUDIT)") — never the raw id. */
function zoneName(zone: string): string {
  return ZONE_MAP[zone]?.name ?? zone
}

/**
 * Safe-by-default structure walk. Run by GameLoop for a hero whose walk would
 * CONTINUE this cycle (no order typed): when the held order is an ICE /
 * Terminal approach and the next hop's predicted fire (predictedHopDamage) is
 * at least APPROACH_HOLD_DAMAGE_RATIO of the walker's CURRENT INTEG, the walk
 * holds one hop short. Playtest 3 held on INTEG% alone; playtest 4 walked a
 * FULL-INTEG hero into 4 escalated units + ICE (550 → 72 → dead) and into a
 * 12-unit stack (540 in one cycle) — the threat, not the gauge, is what kills.
 *
 * A valid `use` of an INTEG-healing active in this cycle's `actions` waives the
 * hold (the heal resolves after this check). The caller drops the walk and the
 * held attack and sends `message` — once, since nothing is held after. A TYPED
 * order never comes through here, so retyping the attack pushes in anyway.
 * Already standing under an enemy ICE, the walk goes on (it is past the line —
 * stopping there is worse).
 *
 * Pure on state (the hop is the resolver's own BFS), so a replay — which runs
 * the same continuation step on the same state — holds at the same hop.
 * Returns null when the walk should go ahead.
 */
export function approachHold(
  state: GameState,
  playerId: string,
  actions: readonly PlayerAction[] = [],
): { message: string } | null {
  const p = state.players[playerId]
  if (!p || !p.alive || !p.moveTarget || !(p.integ > 0)) return null
  const target = p.attackTarget
  if (target?.kind !== 'ice' && target?.kind !== 'terminal') return null
  const nextHop = findPath(p.zone, p.moveTarget, (id) => !!state.zones[id])[1]
  if (!nextHop) return null
  if (underEnemyIce(state, p.team, p.zone)) return null
  const drawsIceAggro = target.kind === 'ice' && target.zone === nextHop
  const threat = predictedHopDamage(state, p, nextHop, drawsIceAggro)
  if (!holdsWalk(threat.damage, p.integ)) return null
  const healing = actions.some(
    (a) =>
      a.playerId === playerId &&
      !a.synthesized &&
      a.command.type === 'use' &&
      INTEG_HEAL_ACTIVES.has(a.command.item) &&
      validateAction(state, a) === null,
  )
  if (healing) return null
  const order = target.kind === 'ice' ? `attack ice:${target.zone}` : 'attack terminal'
  return {
    message:
      `Holding at ${zoneName(p.zone)}: ${describeHopSources(threat)} hit for ~${threat.damage}/cycle ` +
      `in ${zoneName(nextHop)}, you have ${p.integ} — retype \`${order}\` to push in`,
  }
}

/** Every action-gating debuff id, derived from the sets above so a new disable
 *  is narrated the moment it is enforced — the two can never drift apart. */
const NARRATED_STATUS_IDS: ReadonlySet<string> = new Set(
  Object.values(DEBUFF_ID_SETS).flatMap((set) => [...set]),
)

/**
 * Emit a `status_applied` event for every action-gating debuff that appears on
 * a hero across a resolution step. Deliberately state-diffed rather than read
 * off the hero resolvers' payloads: the payloads are wire-shaped and discarded,
 * and a diff picks up AoE secondary targets, item actives and riders on a
 * damage ability with no per-ability wiring.
 *
 * Slows/DoTs are out of scope — they are not action-gating and the damage line
 * already narrates their effect, so narrating them would double every nuke.
 * Only NEW ids fire: refreshing an existing stun is not news.
 */
function emitStatusApplied(
  pre: Record<string, PlayerState>,
  post: Record<string, PlayerState>,
  sourceId: string,
  cycle: number,
  events: GameEngineEvent[],
): void {
  for (const [pid, after] of Object.entries(post)) {
    const before = pre[pid]
    if (!before) continue
    for (const buff of after.buffs) {
      if (!NARRATED_STATUS_IDS.has(buff.id)) continue
      if (before.buffs.some((b) => b.id === buff.id)) continue
      events.push({
        _tag: 'status_applied',
        cycle,
        sourceId,
        targetId: pid,
        status: buff.id,
        cyclesRemaining: buff.cyclesRemaining,
      })
    }
  }
}

/**
 * The reason a typed order dropped by anti-cheat is refused with. A hero target
 * the attacker cannot see is ALSO an honest mistake, so it reads exactly as the
 * resolver's own out-of-zone / ally refusals do — generic, never the target's
 * zone. Anything else anti-cheat drops gets a plain refusal, so no order
 * vanishes without a word.
 */
function antiCheatDropReason(state: GameState, action: PlayerAction): string {
  const cmd = action.command
  if ((cmd.type === 'attack' || cmd.type === 'breach') && cmd.target.kind === 'hero') {
    const target = findTargetPlayer(state, cmd.target)
    const me = state.players[action.playerId]
    if (target && me && target.team === me.team) {
      return cmd.type === 'attack' ? `${target.name} is on your team` : 'Cannot breach an ally'
    }
    return cmd.type === 'attack' ? 'Target is not in your zone' : 'Target not in your zone'
  }
  return 'That order was refused'
}

// ── Resolution Pipeline ────────────────────────────────────────

/**
 * Resolve all player actions for a cycle.
 *
 * Priority-ordered resolution:
 * Phase 0: Item actives — blink/Hardshell/nukes, ahead of the ability they set up
 * Phase 1: Instant abilities (stuns, silences) — resolve simultaneously
 * Phase 2: Movement — all moves resolve at once
 * Phase 3: Attacks + targeted abilities — simultaneous
 * Phase 4: Passive effects, DoTs, regen, cooldown ticks
 * Phase 5: Buy/sell
 *
 * Within each phase, all actions resolve simultaneously.
 */
// ── Phase functions (extracted from resolveActions for readability) ───

/**
 * Phase 2: Movement — all moves resolve simultaneously.
 * Slow deterministically blocks movement on a fixed fraction of ticks (no RNG);
 * Haste cache ignores slow.
 * Moving cancels TP channeling.
 */
function resolveMovementPhase(
  cycle: number,
  validActions: PlayerAction[],
  players: Record<string, PlayerState>,
  zones: Record<string, ZoneRuntimeState>,
  events: GameEngineEvent[],
  rejected: Array<{ playerId: string; reason: string }>,
): { players: Record<string, PlayerState> } {
  const moves = validActions.filter((a) => a.command.type === 'move')
  let playerUpdates: PlayerUpdates = {}

  for (const action of moves) {
    const cmd = action.command as { type: 'move'; zone: string }
    const player = players[action.playerId]
    if (player && player.alive) {
      // Auto-path: the order names the DESTINATION; each cycle moves one hop
      // along the BFS path (recomputed per cycle, so it self-heals). A hop
      // beyond this one stores the destination as moveTarget — GameLoop
      // re-issues the move next cycle until arrival or a new deliberate action.
      const path = findPath(player.zone, cmd.zone, (id) => !!zones[id])
      const nextHop = path[1]
      if (!nextHop) {
        // Already there (or the path vanished — a stale target): stop walking.
        playerUpdates[action.playerId] = { ...playerUpdates[action.playerId], moveTarget: null }
        continue
      }

      const hasted = player.buffs.some((b) => b.id === 'haste')
      const totalSlow = Math.min(
        80,
        player.buffs
          .filter((b) => b.id === 'slow' || b.id === 'broadcast_slow')
          .reduce((sum, b) => sum + b.stacks, 0),
      )
      // Deterministic slow: instead of a per-cycle coin flip (Math.random < slow),
      // block movement on a fixed, evenly-spaced pattern that yields the SAME
      // average skip rate (totalSlow% of ticks) but is fully predictable — a
      // slowed escape no longer fails "because of dice". `(cycle * slow) % 100 < slow`
      // skips exactly slow/100 of ticks, distributed evenly across the slow.
      const slowBlocks = !hasted && totalSlow > 0 && (cycle * totalSlow) % 100 < totalSlow
      if (slowBlocks) {
        // Synthesized continuations fail silently — the player already got
        // their feedback when they issued the order.
        if (!action.synthesized) {
          rejected.push({ playerId: action.playerId, reason: 'Slowed — failed to move' })
        }
        // The slow costs a cycle of progress, not the order — keep walking.
        playerUpdates[action.playerId] = { ...playerUpdates[action.playerId], moveTarget: cmd.zone }
        continue
      }

      const updates: Partial<PlayerState> = {
        zone: nextHop,
        moveTarget: nextHop === cmd.zone ? null : cmd.zone,
      }

      if (player.buffs.some((b) => b.id === 'tp_channeling')) {
        updates.buffs = player.buffs.filter(
          (b) => b.id !== 'tp_channeling' && b.id !== 'tp_destination',
        )
        events.push({
          _tag: 'teleport_cancelled',
          cycle,
          playerId: action.playerId,
          reason: 'movement',
        })
      }

      playerUpdates[action.playerId] = playerUpdates[action.playerId]
        ? { ...playerUpdates[action.playerId], ...updates }
        : updates
    }
  }
  return { players: applyPlayerUpdates(players, playerUpdates) }
}

/**
 * Phase 1: Instant abilities (stuns, silences) — resolve simultaneously.
 * These apply before movement, but they do NOT gate the victim's SAME-cycle
 * action (which was already validated at cycle start) — a cast-applied disable
 * gates the victim's NEXT cycle, which is why those disables use cyclesRemaining 2
 * (see the applyBuff note in heroes/_base): a 1-cycle disable is reaped this same
 * cycle before any future validateAction sees it.
 */
function resolveInstantCastsPhase(
  state: GameState,
  validActions: PlayerAction[],
  players: Record<string, PlayerState>,
  zones: Record<string, ZoneRuntimeState>,
  waves: WaveUnitState[],
  ice: IceState[],
  neutrals: SiltDwellerState[],
  terminals: { chaff: TerminalState; audit: TerminalState },
  events: GameEngineEvent[],
  heroAttackers: Map<string, string>,
  rejected: Array<{ playerId: string; reason: string }>,
  damageTracker: Map<string, { hero: number; ice: number }>,
  waveKills: Array<{ playerId: string; waveId: string; waveType: 'line' | 'sweep' | 'breach' }>,
  neutralKills: Array<{ playerId: string; neutralId: string }>,
  findHero: (name: string) => string | null,
  rng: () => number = Math.random,
): {
  players: Record<string, PlayerState>
  zones: Record<string, ZoneRuntimeState>
  waves: WaveUnitState[]
  neutrals: SiltDwellerState[]
} {
  // Batch clock: every caster standing when the phase opens has committed
  // their cast — one killed (or stunned) by an earlier cast in this same phase
  // still resolves it. Resolution runs in sorted player-id order, never in
  // arrival order, so a replay of the same orders is the same cycle.
  const committed = aliveIds(players)
  const instantCasts = validActions
    .filter(
      (a) =>
        a.command.type === 'cast' &&
        isInstantAbility(
          players[a.playerId]!,
          a.command as { type: 'cast'; ability: 'q' | 'w' | 'e' | 'r' },
        ),
    )
    .sort((a, b) => compareCodePoints(a.playerId, b.playerId))
  for (const action of instantCasts) {
    const result = resolveHeroCast(
      state,
      players,
      zones,
      waves,
      ice,
      neutrals,
      terminals,
      action,
      events,
      heroAttackers,
      rejected,
      damageTracker,
      waveKills,
      neutralKills,
      findHero,
      rng,
      committed,
    )
    players = result.players
    zones = result.zones
    waves = result.waves
    neutrals = result.neutrals
  }
  return { players, zones, waves, neutrals }
}

/** Ids of every hero standing at this instant — a phase's committed casters. */
function aliveIds(players: Record<string, PlayerState>): ReadonlySet<string> {
  return new Set(
    Object.values(players)
      .filter((p) => p.alive)
      .map((p) => p.id),
  )
}

/**
 * Phase 3a: Burns — allied waves below 50% INTEG. The burner gets reduced scrip
 * + XP for denying (preventing the enemy from last-hitting).
 */
function resolveDenyPhase(
  cycle: number,
  validActions: PlayerAction[],
  players: Record<string, PlayerState>,
  waves: WaveUnitState[],
  events: GameEngineEvent[],
  rejected: Array<{ playerId: string; reason: string }>,
): { players: Record<string, PlayerState>; waves: WaveUnitState[] } {
  const burns = validActions.filter((a) => a.command.type === 'burn')
  let playerUpdates: PlayerUpdates = {}

  // Burns resolve against the waves as they stood when the phase OPENED — the
  // batch clock is canon, so two same-cycle burns on one unit are simultaneous
  // and share the deny payload, instead of arrival order paying the first in
  // full and eating the second's cycle in silence.
  const wavesAtPhaseStart = [...waves]
  const burnGroups = new Map<string, { wave: WaveUnitState; burnerIds: string[] }>()

  for (const action of burns) {
    const cmd = action.command as { type: 'burn'; target: { kind: 'wave'; index: number } }
    const denier = players[action.playerId]
    if (!denier || !denier.alive) continue

    // Every exit says why: a burn that resolves to nothing used to eat the
    // cycle in silence.
    const refuse = (reason: string): void => {
      rejected.push({ playerId: action.playerId, reason })
    }

    const resolved = waveInZoneByIndex(wavesAtPhaseStart, denier.zone, cmd.target.index)
    if (!resolved) {
      const wavesInZone = wavesAtPhaseStart.filter((c) => c.zone === denier.zone).length
      refuse(
        wavesInZone === 0
          ? 'No waves in this zone to burn'
          : wavesInZone === 1
            ? 'Only 1 wave here — use wave:0'
            : `Only ${wavesInZone} waves here — use wave:0-${wavesInZone - 1}`,
      )
      continue
    }
    const { wave } = resolved
    if (wave.integ <= 0) {
      refuse('That wave is already dead')
      continue
    }

    if (wave.team !== denier.team) {
      refuse('That is an enemy wave — burn only works on your own (use `attack` to strip it)')
      continue
    }
    // Read the max the wave SPAWNED with. Waves escalate with match time, so
    // neither the level-1 constant (the window shrinks every minute until
    // denying is impossible) nor the current tick's tier (the window widens past
    // the threshold for any wave that outlived an escalation boundary) is
    // right. Fall back to the cycle-0 base for fixtures that omit maxInteg.
    const burnMax = wave.maxInteg ?? waveUnitMaxHp(wave.type, 0)
    if (wave.integ > burnMax * BURN_HP_THRESHOLD) {
      refuse(
        `Too healthy to burn — it must be at or below ${Math.round(BURN_HP_THRESHOLD * 100)}% INTEG (${wave.integ}/${burnMax})`,
      )
      continue
    }

    const group = burnGroups.get(wave.id) ?? { wave, burnerIds: [] }
    group.burnerIds.push(action.playerId)
    burnGroups.set(wave.id, group)
  }

  // Groups and burners iterate sorted so the outcome — including remainder
  // pennies — is identical under any permutation of the cycle's actions.
  for (const [waveId, group] of [...burnGroups.entries()].sort(([a], [b]) =>
    compareCodePoints(a, b),
  )) {
    const liveIdx = waves.findIndex((w) => w.id === waveId)
    const live = waves[liveIdx]
    if (live) {
      waves[liveIdx] = { ...live, integ: 0 }
    }

    const burners = [...group.burnerIds].sort()
    const burnGold = Math.floor(((WAVE_SCRIP_MIN + WAVE_SCRIP_MAX) / 2) * BURN_SCRIP_RATIO)
    const burnXp = Math.floor(WAVE_XP * BURN_XP_RATIO)
    for (const [i, playerId] of burners.entries()) {
      const denier = players[playerId]
      if (!denier) continue
      const scripShare =
        Math.floor(burnGold / burners.length) + (i < burnGold % burners.length ? 1 : 0)
      playerUpdates[playerId] = {
        ...playerUpdates[playerId],
        scrip: denier.scrip + scripShare,
        xp: denier.xp + Math.floor(burnXp / burners.length),
      }

      events.push({
        _tag: 'wave_burn',
        cycle,
        playerId,
        waveId,
        waveType: group.wave.type,
        scripAwarded: scripShare,
      })
    }
  }
  return { players: applyPlayerUpdates(players, playerUpdates), waves }
}

/** A validated hero→hero basic attack, resolved after the attack loop. */
interface HeroSwing {
  attackerId: string
  targetId: string
}

/**
 * Split `amount` across `weights` pro rata (largest remainder; ties go to the
 * earlier index, which callers keep in sorted-attacker order). Sums exactly.
 */
function splitProRata(amount: number, weights: number[]): number[] {
  const total = weights.reduce((s, w) => s + w, 0)
  if (amount <= 0 || total <= 0) return weights.map(() => 0)
  const exact = weights.map((w) => (amount * w) / total)
  const out = exact.map((x) => Math.floor(x))
  let left = amount - out.reduce((s, x) => s + x, 0)
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (const { i } of order) {
    if (left <= 0) break
    out[i] = (out[i] ?? 0) + 1
    left--
  }
  return out
}

/**
 * Hero basic attacks — SIMULTANEOUS within a cycle (owner decision; the batch
 * clock commits every instruction at once, in no order).
 *
 * 1. Every swing is computed against the attack phase's OPENING snapshot of
 *    attacker and target (stats, items, buffs, alive). A hero killed this
 *    cycle still lands its swing; two heroes can kill each other.
 * 2. Rng draws happen in a stable order — swings sorted by attacker id, then
 *    target id; per swing: crit, Arc Coil (+ chain pick), Bulwark Plate,
 *    Concussion Hammer — so crits/procs never depend on submit order.
 * 3. Per target, the volley lands as one sum:
 *    - Echo's phaseShift dodges exactly ONE swing: the biggest (ties → sorted
 *      attacker id). The dodged swing deals nothing, procs nothing, credits
 *      nothing (its rng was still drawn, so the stream stays fixed).
 *    - Shields absorb the summed volley once; the post-shield INTEG loss is
 *      split across the landed swings pro rata (largest remainder, ties →
 *      sorted id). Spite Plate reflects each attacker's share.
 *    - One teleport_cancelled per target; each Concussion proc adds a stun.
 * 4. Arc Coil chain damage and Spite Plate reflect are unshielded (as before)
 *    and are summed with the volley, so all of a hero's INTEG loss this phase
 *    lands at once. Silver Edge invis/bonus is consumed off the attacker.
 *
 * Kill credit is settled at the end of resolveActions (rankHeroAttackers):
 * most damage to the victim this cycle, ties → sorted id.
 */
function resolveHeroSwings(
  cycle: number,
  swings: HeroSwing[],
  players: Record<string, PlayerState>,
  cuirassByZone: Map<string, { ally: boolean; enemy: boolean }>,
  events: GameEngineEvent[],
  heroAttackers: Map<string, string>,
  damageTracker: Map<string, { hero: number; ice: number }>,
  getCachedItemStats: (playerId: string, items: (string | null)[]) => ItemStats,
  rng: () => number,
): PlayerUpdates {
  interface Computed {
    attackerId: string
    targetId: string
    attackType: DamageType
    /** Post-mitigation basic damage (the amount the damage event reports). */
    damage: number
    /** Truestrike Rig bonus code damage (0 without the item / when immune). */
    magic: number
    /** What the swing puts into the target's shield/INTEG pool. */
    total: number
    stun: boolean
    /** The basic hit met immunity: what it would have dealt otherwise. */
    immuneLost: number | null
  }

  const sorted = [...swings].sort(
    (a, b) =>
      compareCodePoints(a.attackerId, b.attackerId) || compareCodePoints(a.targetId, b.targetId),
  )
  const computed: Computed[] = []
  // Unshielded INTEG loss (Arc Coil chain, Spite Plate reflect).
  const extraLoss = new Map<string, number>()
  const addLoss = (id: string, n: number): void => {
    extraLoss.set(id, (extraLoss.get(id) ?? 0) + n)
  }
  const consumesEdge = new Set<string>()

  for (const { attackerId, targetId } of sorted) {
    const attacker = players[attackerId]!
    const target = players[targetId]!
    const attackerItemStats = getCachedItemStats(attackerId, attacker.items)
    const targetItemStats = getCachedItemStats(targetId, target.items)

    let attackDamage = Math.round(
      getEffectiveAttack(attacker, attackerItemStats) * getAttackMultiplier(attacker),
    )

    const ownedCrits: Array<{ chance: number; multiplier: number }> = []
    if (attacker.items.includes('null_pointer'))
      ownedCrits.push({
        chance: NULL_POINTER_CRIT_CHANCE,
        multiplier: NULL_POINTER_CRIT_MULTIPLIER,
      })
    if (attacker.items.includes('fracture_edge'))
      ownedCrits.push({
        chance: FRACTURE_EDGE_CRIT_CHANCE,
        multiplier: FRACTURE_EDGE_CRIT_MULTIPLIER,
      })
    if (attacker.items.includes('killshot_coil'))
      ownedCrits.push({
        chance: KILLSHOT_COIL_CRIT_CHANCE,
        multiplier: KILLSHOT_COIL_CRIT_MULTIPLIER,
      })
    let critMultiplier = 1
    if (ownedCrits.length > 0) {
      const best = ownedCrits.reduce((a, b) => (b.chance > a.chance ? b : a))
      if (rng() < best.chance) critMultiplier = best.multiplier
    }
    attackDamage = Math.round(attackDamage * critMultiplier)

    const bonusMagicDamage = attacker.items.includes('truestrike_rig')
      ? TRUESTRIKE_RIG_BONUS_DAMAGE
      : 0

    if (attacker.items.includes('arc_coil') && rng() < 0.25) {
      const chainTargets = Object.values(players).filter(
        (p) => p.zone === attacker.zone && p.team !== attacker.team && p.alive && p.id !== targetId,
      )
      if (chainTargets.length > 0) {
        const chainTarget = chainTargets[Math.floor(rng() * chainTargets.length)]!
        const chainDamage = isDamageImmune(chainTarget, 'code')
          ? 0
          : Math.round(
              calculateCodeDamage(60, chainTarget.ice) *
                getIncomingDamageMultiplier(chainTarget, 'code'),
            )
        if (chainDamage > 0) {
          addLoss(chainTarget.id, chainDamage)
          events.push({
            _tag: 'damage',
            cycle,
            sourceId: attackerId,
            targetId: chainTarget.id,
            amount: chainDamage,
            damageType: 'code',
          })
        }
      }
    }

    // Silver Edge: the +bonus is an empowered NEXT-attack-from-invis, consumed
    // (with the invis) by the attack — which also breaks stealth on attacking.
    const silverEdgeInvis = attacker.buffs.some((b) => b.id === 'ghostwire_edge_invis')
    const silverEdgeBonus = attacker.buffs.find((b) => b.id === 'ghostwire_edge_bonus')
    if (silverEdgeBonus && silverEdgeInvis) attackDamage += silverEdgeBonus.stacks
    if (silverEdgeInvis) consumesEdge.add(attackerId)

    if (attacker.buffs.some((b) => b.id === 'stealth')) {
      attackDamage = Math.round(attackDamage * 1.5)
    }

    // R4-08: basic-attack damage type is per-hero (attackType). Kinetic is
    // mitigated by plate; code by ice. NPCs stay kinetic via CombatResolver.
    const attackType: DamageType =
      (attacker.heroId ? HEROES[attacker.heroId]?.attackType : undefined) ?? 'kinetic'

    let plate = getEffectivePlate(target, targetItemStats)
    const ice = getEffectiveIce(target, targetItemStats)
    if (attacker.items.includes('rust_driver')) {
      plate = Math.max(0, plate - RUST_DRIVER_PLATE_REDUCTION)
    }
    // Siege Lattice aura: ally = the target's team holds one here (+plate),
    // enemy = the other team does (−plate).
    const cuirass = cuirassByZone.get(target.zone)
    if (cuirass) {
      const allyCuirass = target.team === 'chaff' ? cuirass.ally : cuirass.enemy
      const enemyCuirass = target.team === 'chaff' ? cuirass.enemy : cuirass.ally
      if (allyCuirass) plate += SIEGE_LATTICE_AURA_PLATE
      if (enemyCuirass) plate = Math.max(0, plate - SIEGE_LATTICE_AURA_PLATE)
    }

    let blockedDamage = 0
    if (target.items.includes('bulwark_plate') && rng() < BULWARK_PLATE_BLOCK_CHANCE) {
      blockedDamage = BULWARK_PLATE_BLOCK_AMOUNT
    }

    let damage =
      attackType === 'code'
        ? calculateCodeDamage(attackDamage, ice)
        : calculateKineticDamage(attackDamage, plate)
    damage = Math.max(0, damage - blockedDamage)
    damage = Math.round(damage * getIncomingDamageMultiplier(target, attackType))
    const immune = isDamageImmune(target, attackType)
    const immuneLost = immune ? damage : null
    if (immune) damage = 0

    let magic = 0
    if (bonusMagicDamage > 0 && !isDamageImmune(target, 'code')) {
      magic = Math.round(
        calculateCodeDamage(bonusMagicDamage, ice) * getIncomingDamageMultiplier(target, 'code'),
      )
    }

    let total = damage + magic
    if (target.buffs.some((b) => b.id === 'hardened')) total = Math.round(total * 0.9)

    const stun = attacker.items.includes('concussion_hammer') && rng() < 0.25

    computed.push({ attackerId, targetId, attackType, damage, magic, total, stun, immuneLost })
  }

  // ── Land the volley, one target at a time ──
  const byTarget = new Map<string, Computed[]>()
  for (const c of computed) {
    const list = byTarget.get(c.targetId) ?? []
    list.push(c)
    byTarget.set(c.targetId, list)
  }
  const swingLoss = new Map<string, number>()
  const targetBuffs = new Map<string, PlayerState['buffs']>()

  for (const [targetId, list] of [...byTarget.entries()].sort(([a], [b]) =>
    compareCodePoints(a, b),
  )) {
    const target = players[targetId]!
    let buffs = [...target.buffs]

    // phaseShift ("dodge the next attack") eats ONE swing of a simultaneous
    // volley: the biggest, ties to the sorted-first attacker.
    let dodgedIdx = -1
    if (buffs.some((b) => b.id === 'phaseShift')) {
      list.forEach((c, i) => {
        if (dodgedIdx < 0 || c.total > list[dodgedIdx]!.total) dodgedIdx = i
      })
      buffs = buffs.filter((b) => b.id !== 'phaseShift')
    }
    const landed = list.filter((_, i) => i !== dodgedIdx)
    // Blocked hits say so (damage_blocked) — a dodged swing is otherwise
    // silent, an immune one a bare "0" (see DamageBlockedEvent for what
    // co-occurs with each).
    const blocked = (c: Computed, reason: 'shield' | 'dodge' | 'immune', amount: number) =>
      events.push({
        _tag: 'damage_blocked',
        cycle,
        sourceId: c.attackerId,
        targetId,
        reason,
        amount,
        damageType: c.attackType,
      })
    if (dodgedIdx >= 0) blocked(list[dodgedIdx]!, 'dodge', list[dodgedIdx]!.total)

    const sum = landed.reduce((s, c) => s + c.total, 0)
    const absorbed = absorbShield(buffs, sum)
    buffs = [...absorbed.buffs]
    for (const c of landed) {
      if (c.immuneLost !== null && c.total === 0) blocked(c, 'immune', c.immuneLost)
      else if (sum > 0 && absorbed.remaining === 0 && c.total > 0) blocked(c, 'shield', c.total)
    }
    swingLoss.set(targetId, absorbed.remaining)
    const shares = splitProRata(
      absorbed.remaining,
      landed.map((c) => c.total),
    )
    const spite = target.buffs.some((b) => b.id === 'spite_plate')

    for (const [i, c] of landed.entries()) {
      if (c.magic > 0) {
        events.push({
          _tag: 'damage',
          cycle,
          sourceId: c.attackerId,
          targetId,
          amount: c.magic,
          damageType: 'code',
        })
      }
      if (c.stun) {
        // cyclesRemaining 2 = one gated action: reaped same-cycle by
        // cycleAllBuffs (see the applyBuff note), so 1 would never reach the
        // next validateAction.
        buffs.push({ id: 'stun', stacks: 1, cyclesRemaining: 2, source: c.attackerId })
        events.push({
          _tag: 'status_applied',
          cycle,
          sourceId: c.attackerId,
          targetId,
          status: 'stun',
          cyclesRemaining: 2,
        })
      }
      if (spite) {
        const returnDamage = computeSpitePlateReflect(shares[i]!)
        addLoss(c.attackerId, returnDamage)
        events.push({
          _tag: 'damage',
          cycle,
          sourceId: targetId,
          targetId: c.attackerId,
          amount: returnDamage,
          damageType: 'black',
        })
      }
      heroAttackers.set(c.attackerId, targetId)
      const dt = damageTracker.get(c.attackerId) ?? { hero: 0, ice: 0 }
      dt.hero += c.damage
      damageTracker.set(c.attackerId, dt)
      events.push({
        _tag: 'damage',
        cycle,
        sourceId: c.attackerId,
        targetId,
        amount: c.damage,
        damageType: c.attackType,
      })
    }

    if (buffs.some((b) => b.id === 'tp_channeling')) {
      buffs = buffs.filter((b) => b.id !== 'tp_channeling' && b.id !== 'tp_destination')
      events.push({ _tag: 'teleport_cancelled', cycle, playerId: targetId, reason: 'damage' })
    }
    targetBuffs.set(targetId, buffs)
  }

  const updates: PlayerUpdates = {}
  const touched = new Set([...swingLoss.keys(), ...extraLoss.keys(), ...consumesEdge])
  for (const id of [...touched].sort()) {
    const p = players[id]!
    const integ = Math.max(0, p.integ - (swingLoss.get(id) ?? 0) - (extraLoss.get(id) ?? 0))
    let buffs = targetBuffs.get(id) ?? p.buffs
    if (consumesEdge.has(id)) {
      buffs = buffs.filter(
        (b) => b.id !== 'ghostwire_edge_invis' && b.id !== 'ghostwire_edge_bonus',
      )
    }
    updates[id] = { integ, alive: integ > 0, buffs }
  }
  return updates
}

/**
 * Kill credit order (handleDeaths takes the FIRST heroAttackers entry naming
 * the victim): most damage dealt to that victim this cycle, from any source
 * (attacks, casts, item actives), ties → sorted attacker id. Rebuilt once at
 * the end of resolveActions so arrival order never decides who gets the kill.
 */
function rankHeroAttackers(
  heroAttackers: Map<string, string>,
  events: GameEngineEvent[],
): Map<string, string> {
  const dealt = new Map<string, number>()
  for (const e of events) {
    if (e._tag !== 'damage') continue
    const key = `${e.sourceId}\u0000${e.targetId}`
    dealt.set(key, (dealt.get(key) ?? 0) + e.amount)
  }
  const d = (attackerId: string, victimId: string) =>
    dealt.get(`${attackerId}\u0000${victimId}`) ?? 0
  return new Map(
    [...heroAttackers.entries()].sort(
      ([a, va], [b, vb]) => d(b, vb) - d(a, va) || compareCodePoints(a, b),
    ),
  )
}

/**
 * Phase 3b: Attacks — hero/wave/ice/Tenant/neutral/Terminal, all simultaneous.
 * This is the largest phase (~440 lines): crit stacking, item on-hit effects
 * (MKB magic, Maelstrom chain, Skull Basher stun), plate mitigation (Desolator
 * shred, Assault Cuirass aura, Vanguard block), shield/phaseShift, Spite Plate
 * reflect, TP channeling cancel. Hero swings are simultaneous — computed
 * against the phase-start snapshot and landed together (resolveHeroSwings).
 */
function resolveAttackPhase(
  state: GameState,
  attacks: PlayerAction[],
  players: Record<string, PlayerState>,
  waves: WaveUnitState[],
  ice: IceState[],
  neutrals: SiltDwellerState[],
  terminals: { chaff: TerminalState; audit: TerminalState },
  events: GameEngineEvent[],
  rejected: Array<{ playerId: string; reason: string }>,
  heroAttackers: Map<string, string>,
  damageTracker: Map<string, { hero: number; ice: number }>,
  waveKills: Array<{ playerId: string; waveId: string; waveType: 'line' | 'sweep' | 'breach' }>,
  neutralKills: Array<{ playerId: string; neutralId: string }>,
  iceKills: Array<{ zone: string; team: TeamId }>,
  findHeroByName: (name: string) => string | null,
  getCachedItemStats: (playerId: string, items: (string | null)[]) => ItemStats,
  rng: () => number = Math.random,
): {
  players: Record<string, PlayerState>
  waves: WaveUnitState[]
  ice: IceState[]
  neutrals: SiltDwellerState[]
  terminals: { chaff: TerminalState; audit: TerminalState }
} {
  let playerUpdates: PlayerUpdates = {}

  // Precompute Assault Cuirass auras per zone once for the entire attack phase.
  // Previously this scanned all players on EVERY attack action — O(players × attacks).
  const cuirassByZone = new Map<string, { ally: boolean; enemy: boolean }>()
  for (const [, zonePlayer] of Object.entries(players)) {
    if (!zonePlayer.items.includes('siege_lattice')) continue
    let entry = cuirassByZone.get(zonePlayer.zone)
    if (!entry) {
      entry = { ally: false, enemy: false }
      cuirassByZone.set(zonePlayer.zone, entry)
    }
    // Aura direction is relative to the TARGET, so we store both team flags.
    // ally = at least one cuirass holder is on the target's team (plate buff)
    // enemy = at least one holder is on the opposite team (plate shred)
    // We use chaff/audit presence flags and resolve per-target below.
    if (zonePlayer.team === 'chaff') {
      entry.ally = true // chaff has cuirass in this zone
    } else {
      entry.enemy = true // audit has cuirass in this zone
    }
  }

  // THE BATCH CLOCK IS CANON: every wave swing in a cycle resolves against the
  // waves as they stood when the phase OPENED, never against what an earlier
  // iteration of this loop already applied — arrival order within a cycle must
  // not decide who collects a strip. Wave entries are replaced immutably, so a
  // shallow copy pins the phase-start refs; swings batch here and land after
  // the loop, once per unit.
  const wavesAtPhaseStart = [...waves]
  const waveAttackGroups = new Map<
    string,
    { wave: WaveUnitState; attackers: Array<{ playerId: string; damage: number }> }
  >()
  // Silt camps get the same treatment: swings batch per camp and resolve
  // against the phase-start snapshot (see the wave comment above).
  const neutralsAtPhaseStart = [...neutrals]
  const neutralAttackGroups = new Map<
    string,
    { neutral: SiltDwellerState; attackers: Array<{ playerId: string; damage: number }> }
  >()

  const heroSwings: HeroSwing[] = []

  const terminalAttackers: Array<{
    playerId: string
    damage: number
    miss: (reason: string) => void
    hold: () => void
  }> = []

  for (const action of attacks) {
    const cmd = action.command as { type: 'attack'; target: TargetRef }
    const attacker = players[action.playerId]
    if (!attacker || !attacker.alive) continue

    // One action per player per 4s cycle: a mis-targeted attack that resolves to
    // nothing must SAY so, otherwise the cycle is eaten in silence. Every exit
    // below reports; `rejected` is also what excludes the player from
    // succeededActions (no phantom on-attack passive for a swing that missed)
    // and from the tutorial's "you performed the taught verb" check.
    //
    // A GameLoop-synthesized re-swing is the exception: the player typed that
    // order once, ticks ago. Its failure means the standing order has outlived
    // its target, so end the order instead of repeating a warning every 4s
    // (mirrors the silent-failure rule for auto-path continuations).
    const miss = (reason: string): void => {
      if (action.synthesized) {
        playerUpdates[action.playerId] = {
          ...playerUpdates[action.playerId],
          attackTarget: null,
        }
        return
      }
      rejected.push({ playerId: action.playerId, reason })
    }

    // Remember a resolved attack so GameLoop re-issues it while it stays valid.
    // EVERY resolved attack routes through here so the exclusion below is the
    // single place the rule lives: waves never hold, because last-hitting is an
    // explicit timing decision (the contract the command parser documents), not
    // a standing order.
    const holdTarget = (): void => {
      // A taunt-forced swing is not the player's order — the order they DID
      // give (an ICE walk's held attack) must survive it.
      if (cmd.target.kind === 'wave' || action.forced) return
      playerUpdates[action.playerId] = {
        ...playerUpdates[action.playerId],
        attackTarget: cmd.target,
      }
    }

    if (cmd.target.kind === 'hero') {
      const targetId = findHeroByName(cmd.target.name)
      if (!targetId) {
        miss(`No hero named "${cmd.target.name}" in this game`)
        continue
      }
      const target = players[targetId]
      if (!target || !target.alive) {
        miss('Your target died before your attack landed')
        continue
      }

      // Team before zone: "he's your ally" explains the whole failure, while
      // "not in your zone" would send the player chasing a teammate.
      if (target.team === attacker.team) {
        miss(`${target.name} is on your team`)
        continue
      }
      if (target.zone !== attacker.zone) {
        miss('Target is not in your zone')
        continue
      }

      // THE BATCH CLOCK IS CANON: hero swings are computed against the
      // phase-start snapshot and land together after this loop (see
      // resolveHeroSwings) — arrival order decides nothing.
      heroSwings.push({ attackerId: action.playerId, targetId })
      holdTarget()
    } else if (cmd.target.kind === 'wave') {
      const resolved = waveInZoneByIndex(wavesAtPhaseStart, attacker.zone, cmd.target.index)
      if (!resolved) {
        // Count the same index space waveInZoneByIndex walks (every wave in
        // the zone, dead-but-unreaped included) so the quoted range is the one
        // the player can actually type this cycle.
        const wavesInZone = wavesAtPhaseStart.filter((c) => c.zone === attacker.zone).length
        miss(
          wavesInZone === 0
            ? 'No waves in this zone to attack'
            : wavesInZone === 1
              ? 'Only 1 wave here — use wave:0'
              : `Only ${wavesInZone} waves here — use wave:0-${wavesInZone - 1}`,
        )
        continue
      }
      const { wave } = resolved
      if (wave.integ <= 0) {
        miss('That wave is already dead')
        continue
      }
      // Without this guard an own-wave swing paid the FULL last-hit bounty,
      // teaching the exact opposite of last-hitting. Killing your own wave is
      // the `burn` command, which has its own INTEG window and reduced reward.
      if (wave.team === attacker.team) {
        miss(ownWaveRefusal(wavesAtPhaseStart, attacker, cmd.target.index, wave))
        continue
      }

      const attackerItemStats = getCachedItemStats(action.playerId, attacker.items)
      const attackDamage = getEffectiveAttack(attacker, attackerItemStats)

      // Swings batch per unit and land after this loop against the snapshot.
      // holdTarget() is deliberately absent — waves never hold (last-hitting
      // is a timing decision, see holdTarget).
      const group = waveAttackGroups.get(wave.id) ?? { wave, attackers: [] }
      group.attackers.push({ playerId: action.playerId, damage: attackDamage })
      waveAttackGroups.set(wave.id, group)
    } else if (cmd.target.kind === 'ice') {
      const targetZone = cmd.target.zone
      let iceTarget = ice.find((t) => t.zone === targetZone && t.alive)
      if (!iceTarget) {
        miss(STRUCTURE_REFUSAL.noIce(targetZone))
        continue
      }
      if (iceTarget.zone !== attacker.zone) {
        miss('Target is not in your zone')
        continue
      }
      // Nothing stopped a hero from chipping their OWN ICE while standing at it.
      if (iceTarget.team === attacker.team) {
        miss(STRUCTURE_REFUSAL.ownIce)
        continue
      }
      if (iceTarget.invulnerable) {
        events.push({
          _tag: 'ice_invulnerable',
          cycle: state.cycle,
          zone: iceTarget.zone,
          playerId: action.playerId,
          reported: !action.synthesized,
        })
        // A typed order needs its reason in the rejected channel as well. A standing
        // order stays alive across the Harden window (it is temporary), so the
        // synthesized re-swing is not reported and not dropped.
        if (!action.synthesized) {
          rejected.push({
            playerId: action.playerId,
            reason: STRUCTURE_REFUSAL.hardened,
          })
        }
        continue
      }
      if (!canAttackIce(ice, targetZone)) {
        miss(STRUCTURE_REFUSAL.protectedIce)
        continue
      }

      const attackerItemStats = getCachedItemStats(action.playerId, attacker.items)
      const attackDamage = getEffectiveAttack(attacker, attackerItemStats)
      const newInteg = Math.max(0, iceTarget.integ - attackDamage)

      ice = ice.map((t) =>
        t.zone === iceTarget.zone && t.team === iceTarget.team
          ? { ...t, integ: newInteg, alive: newInteg > 0 }
          : t,
      )

      if (newInteg <= 0) {
        iceKills.push({ zone: iceTarget.zone, team: iceTarget.team })
      }

      const tdt = damageTracker.get(action.playerId) ?? { hero: 0, ice: 0 }
      tdt.ice += attackDamage
      damageTracker.set(action.playerId, tdt)
      holdTarget()

      events.push({
        _tag: 'damage',
        cycle: state.cycle,
        sourceId: action.playerId,
        targetId: `ice_${iceTarget.zone}`,
        amount: attackDamage,
        damageType: 'kinetic',
      })
    } else if (cmd.target.kind === 'tenant') {
      const tenant = state.tenant
      if (!tenant.alive) {
        miss('Tenant is already dead')
        continue
      }
      if (attacker.zone !== 'hollow') {
        miss('Tenant can only be attacked from the pit')
        continue
      }

      const attackerItemStats = getCachedItemStats(action.playerId, attacker.items)
      const attackDamage = getEffectiveAttack(attacker, attackerItemStats)
      holdTarget()

      events.push({
        _tag: 'damage',
        cycle: state.cycle,
        sourceId: action.playerId,
        targetId: 'tenant',
        amount: attackDamage,
        damageType: 'kinetic',
      })
    } else if (cmd.target.kind === 'neutral') {
      // Zone-local index, mirroring the 'wave' branch above: neutrals are now
      // vision-filtered before broadcast (fog parity with waves), so a global
      // array index would name a different camp than the one the client saw.
      const resolved = neutralInZoneByIndex(neutralsAtPhaseStart, attacker.zone, cmd.target.index)
      if (!resolved) {
        miss('No neutral wave at that index')
        continue
      }
      const { neutral } = resolved
      if (!neutral.alive) {
        miss('That neutral is already dead')
        continue
      }

      const attackerItemStats = getCachedItemStats(action.playerId, attacker.items)
      const attackDamage = getEffectiveAttack(attacker, attackerItemStats)

      // Swings batch per camp and land after this loop against the snapshot —
      // arrival order can't decide the kill credit, and the second swing is
      // no longer told the camp is "already dead".
      const group = neutralAttackGroups.get(neutral.id) ?? { neutral, attackers: [] }
      group.attackers.push({ playerId: action.playerId, damage: attackDamage })
      neutralAttackGroups.set(neutral.id, group)
      holdTarget()
    } else if (cmd.target.kind === 'terminal') {
      const enemyTeam: TeamId = attacker.team === 'chaff' ? 'audit' : 'chaff'
      if (attacker.zone !== TERMINAL_ZONES[enemyTeam]) {
        miss('You must be in the enemy base to attack the Terminal')
        continue
      }

      const attackerItemStats = getCachedItemStats(action.playerId, attacker.items)
      const attackDamage = getEffectiveAttack(attacker, attackerItemStats)

      // Deferred: Terminal swings resolve after the loop, against the ICE as it
      // stands once every swing this cycle has landed. A T3 that falls this cycle
      // opens the Terminal this cycle, and arrival order can't decide it.
      terminalAttackers.push({
        playerId: action.playerId,
        damage: attackDamage,
        miss,
        hold: holdTarget,
      })
    } else {
      // TargetRef also carries 'zone' and 'self', which the wire schema accepts
      // for an attack but no branch above handles — without this they fall off
      // the end of the chain and eat the cycle in silence.
      miss(`You cannot attack a ${cmd.target.kind}`)
    }
  }

  // Hero swings land together, against the phase-start snapshot.
  {
    const heroUpdates = resolveHeroSwings(
      state.cycle,
      heroSwings,
      players,
      cuirassByZone,
      events,
      heroAttackers,
      damageTracker,
      getCachedItemStats,
      rng,
    )
    for (const [id, u] of Object.entries(heroUpdates)) {
      playerUpdates[id] = { ...playerUpdates[id], ...u }
    }
  }

  // Terminal swings land once ICE damage is final. Sorted by player so the
  // outcome is identical under any permutation of the cycle's actions.
  for (const swing of [...terminalAttackers].sort((a, b) =>
    compareCodePoints(a.playerId, b.playerId),
  )) {
    const result = resolveTerminalAttack(
      { ...state, players, waves, ice, terminals },
      swing.playerId,
      swing.damage,
    )
    if (result.rejected) {
      wsLog.debug('Terminal attack rejected', { playerId: swing.playerId, reason: result.rejected })
      swing.miss(result.rejected)
      continue
    }
    terminals = result.state.terminals
    events.push(...result.events)
    swing.hold()

    const adt = damageTracker.get(swing.playerId) ?? { hero: 0, ice: 0 }
    adt.ice += swing.damage
    damageTracker.set(swing.playerId, adt)
  }

  // Resolve the batched wave swings once per unit against the phase-start
  // snapshot. Who gets the strip when several land the same cycle:
  //   - inside the strip window every swing is lethal — all of them claim;
  //   - otherwise any single swing >= remaining INTEG claims (ties share);
  //   - a unit downed only by the cycle's combined damage credits every hand.
  // The payload split itself happens where waveKills is paid out. Groups and
  // attackers iterate sorted so events, kills and remainder pennies are
  // identical under any permutation of the same cycle's actions.
  for (const [waveId, group] of [...waveAttackGroups.entries()].sort(([a], [b]) =>
    compareCodePoints(a, b),
  )) {
    const wave = group.wave
    const attackers = [...group.attackers].sort((a, b) => compareCodePoints(a.playerId, b.playerId))
    // The strip: a unit already down to STRIP_HP_THRESHOLD of its spawn
    // INTEG goes down to the swing regardless of what the swing was worth.
    // Same shape as `burn` on the deny side — see STRIP_HP_THRESHOLD for why
    // this is a threshold and not a damage number.
    const spawnInteg = wave.maxInteg ?? waveUnitMaxHp(wave.type, 0)
    const windowOpen = wave.integ <= spawnInteg * STRIP_HP_THRESHOLD
    const totalDamage = attackers.reduce((sum, a) => sum + a.damage, 0)
    const lethal = windowOpen ? attackers : attackers.filter((a) => a.damage >= wave.integ)
    const goesDown = windowOpen || totalDamage >= wave.integ
    const strippers = lethal.length > 0 ? lethal : goesDown ? attackers : []
    const newInteg = goesDown ? 0 : wave.integ - totalDamage

    const liveIdx = waves.findIndex((w) => w.id === waveId)
    const live = waves[liveIdx]
    if (live) {
      waves[liveIdx] = { ...live, integ: newInteg }
    }

    for (const [i, a] of attackers.entries()) {
      events.push({
        _tag: 'damage',
        cycle: state.cycle,
        sourceId: a.playerId,
        targetId: wave.id,
        // A strip takes whatever was left, so the feed shows the real number
        // (each claimant's split of it) rather than an attack stat that had
        // nothing to do with it.
        amount: windowOpen
          ? Math.floor(wave.integ / attackers.length) + (i < wave.integ % attackers.length ? 1 : 0)
          : a.damage,
        damageType: 'kinetic',
      })
    }

    for (const s of strippers) {
      waveKills.push({ playerId: s.playerId, waveId, waveType: wave.type })
    }
  }

  // Same batch-clock resolution for Silt camps. No strip window here: a swing
  // lethal against the snapshot claims the kill (ties share); a camp downed
  // only by the cycle's combined damage credits every hand. The bounty split
  // happens where neutralKills is paid out.
  for (const [neutralId, group] of [...neutralAttackGroups.entries()].sort(([a], [b]) =>
    compareCodePoints(a, b),
  )) {
    const neutral = group.neutral
    const attackers = [...group.attackers].sort((a, b) => compareCodePoints(a.playerId, b.playerId))
    const totalDamage = attackers.reduce((sum, a) => sum + a.damage, 0)
    const lethal = attackers.filter((a) => a.damage >= neutral.integ)
    const goesDown = totalDamage >= neutral.integ
    const claimants = lethal.length > 0 ? lethal : goesDown ? attackers : []
    const newInteg = goesDown ? 0 : neutral.integ - totalDamage

    const liveIdx = neutrals.findIndex((n) => n.id === neutralId)
    const live = neutrals[liveIdx]
    if (live) {
      neutrals[liveIdx] = { ...live, integ: newInteg, alive: newInteg > 0 }
    }

    for (const a of attackers) {
      events.push({
        _tag: 'damage',
        cycle: state.cycle,
        sourceId: a.playerId,
        targetId: neutralId,
        amount: a.damage,
        damageType: 'kinetic',
      })
    }

    for (const c of claimants) {
      neutralKills.push({ playerId: c.playerId, neutralId })
    }
  }

  return {
    players: applyPlayerUpdates(players, playerUpdates),
    waves,
    ice,
    neutrals,
    terminals,
  }
}

/**
 * Phase 4: Passive effects — cooldown ticks, item regen (Clot Ring, Sobi
 * Mask, Heart of Tarrasque, Garbage Collector), Aether Lens cooldown reduction,
 * Intercept Shell re-arm, Trauma Patch buff regen.
 */
function resolvePassivesPhase(
  players: Record<string, PlayerState>,
  events: GameEngineEvent[],
  heroAttackers: Map<string, string>,
): { players: Record<string, PlayerState> } {
  const playerUpdates: PlayerUpdates = {}
  for (const [pid, player] of Object.entries(players)) {
    if (!player.alive) continue

    const cooldowns = { ...player.cooldowns }
    for (const slot of ['q', 'w', 'e', 'r'] as const) {
      if (cooldowns[slot] > 0) {
        cooldowns[slot] = cooldowns[slot] - 1
      }
    }

    let integ = player.integ
    let bw = player.bw

    const salveRegen = player.buffs.find((b) => b.id === 'trauma_patch_regen')
    if (salveRegen) {
      integ = Math.min(player.maxInteg, integ + salveRegen.stacks)
    }

    if (player.items.includes('clot_ring')) {
      integ = Math.min(
        player.maxInteg,
        integ + Math.floor(player.maxInteg * CLOT_RING_REGEN_PERCENT),
      )
    }

    if (player.items.includes('drip_mask')) {
      bw = Math.min(player.maxBw, bw + Math.floor(player.maxBw * DRIP_MASK_REGEN_PERCENT))
    }

    if (player.items.includes('bulk_lattice')) {
      const tookDamage = events.some((e) => e._tag === 'damage' && e.targetId === pid)
      const inCombat = player.buffs.some((b) => b.id === 'inCombat')
      if (!tookDamage && !inCombat) {
        integ = Math.min(
          player.maxInteg,
          integ + Math.floor(player.maxInteg * BULK_LATTICE_REGEN_PERCENT),
        )
      }
    }

    if (player.items.includes('garbage_collector')) {
      const tookDamage = events.some((e) => e._tag === 'damage' && e.targetId === pid)
      const dealtDamage = heroAttackers.has(pid)
      const inCombat = player.buffs.some((b) => b.id === 'inCombat')
      if (!tookDamage && !dealtDamage && !inCombat) {
        integ = Math.min(
          player.maxInteg,
          integ + Math.floor(player.maxInteg * BULK_LATTICE_REGEN_PERCENT),
        )
      }
    }

    if (player.items.includes('clock_lens')) {
      for (const slot of ['q', 'w', 'e', 'r'] as const) {
        if (cooldowns[slot] > 0) {
          cooldowns[slot] = Math.max(0, cooldowns[slot] - 1)
        }
      }
    }

    let buffs = player.buffs
    if (player.items.includes('intercept_shell')) {
      const linkenBuff = player.buffs.find((b) => b.id === 'spellblock')
      if (!linkenBuff) {
        buffs = [
          ...player.buffs,
          {
            id: 'spellblock',
            stacks: 1,
            cyclesRemaining: LINKENS_RECHARGE_TICKS,
            source: 'intercept_shell',
          },
        ]
      }
    }

    playerUpdates[pid] = { integ, bw, cooldowns, buffs }
  }
  return { players: applyPlayerUpdates(players, playerUpdates) }
}

/**
 * Phase 5: Buy/Sell — item shop operations. Failures surface as rejection
 * events (InsufficientGold, InventoryFull, NotSellable, etc.).
 *
 * Item ACTIVES are NOT here: they resolve in their own phase before everything
 * else (see resolveItemActivesPhase).
 */
function resolveShopPhase(
  state: GameState,
  validActions: PlayerAction[],
  players: Record<string, PlayerState>,
  waves: WaveUnitState[],
  ice: IceState[],
  events: GameEngineEvent[],
  rejected: Array<{ playerId: string; reason: string }>,
): {
  players: Record<string, PlayerState>
} {
  // Buy
  const buys = validActions.filter((a) => a.command.type === 'buy')
  for (const action of buys) {
    const cmd = action.command as { type: 'buy'; item: string }
    const tempState: GameState = { ...state, players, waves, ice }
    const result = Effect.runSync(
      buyItem(tempState, action.playerId, cmd.item).pipe(
        Effect.match({
          onFailure: (error) => {
            rejected.push({
              playerId: action.playerId,
              reason: `Cannot buy ${cmd.item}: ${error._tag.replace(/Error$/, '')}`,
            })
            return null
          },
          onSuccess: (updated): GameState | null => updated,
        }),
      ),
    )
    if (result) {
      players = { ...result.players }
      events.push({
        _tag: 'item_purchased',
        cycle: state.cycle,
        playerId: action.playerId,
        itemId: cmd.item,
        cost: ITEMS[cmd.item]?.cost ?? 0,
      })
    }
  }

  // Sell
  const sells = validActions.filter((a) => a.command.type === 'sell')
  for (const action of sells) {
    const cmd = action.command as { type: 'sell'; item: string }
    const player = players[action.playerId]
    if (!player) continue
    const slotIdx = player.items.indexOf(cmd.item)
    if (slotIdx === -1) {
      rejected.push({ playerId: action.playerId, reason: `No ${cmd.item} in inventory to sell` })
      continue
    }
    const tempState: GameState = { ...state, players, waves, ice }
    const result = Effect.runSync(
      sellItem(tempState, action.playerId, slotIdx).pipe(
        Effect.match({
          onFailure: (error) => {
            rejected.push({
              playerId: action.playerId,
              reason: `Cannot sell ${cmd.item}: ${error._tag.replace(/Error$/, '')}`,
            })
            return null
          },
          onSuccess: (updated): GameState | null => updated,
        }),
      ),
    )
    if (result) {
      players = { ...result.players }
      events.push({
        _tag: 'item_sold',
        cycle: state.cycle,
        playerId: action.playerId,
        itemId: cmd.item,
        refund: Math.floor((ITEMS[cmd.item]?.cost ?? 0) * SELL_REFUND_RATIO),
      })
    }
  }

  return { players }
}

/**
 * Phase 0: Item actives — Jump Shunt, Hardshell, Spite Plate, Burnout, Stasis Shunt, wards, TP.
 *
 * Runs BEFORE instant casts and movement, and is fed by its own per-player
 * action slot (GameLoop keys the queue by main/item), so an item and an ability
 * can land in the same 4s cycle. The ORDER is the whole point: blink → stun →
 * nuke only reads as a combo if the item resolves first. Resolving actives
 * after the ability (where they used to sit, in the shop phase) reverses every
 * such combo — you blink to where the fight WAS.
 *
 * Use failures surface through `rejected` the same as buy/sell (cooldown,
 * invalid target, max stacks).
 */
function resolveItemActivesPhase(
  state: GameState,
  validActions: PlayerAction[],
  players: Record<string, PlayerState>,
  zones: Record<string, ZoneRuntimeState>,
  waves: WaveUnitState[],
  ice: IceState[],
  terminals: { chaff: TerminalState; audit: TerminalState },
  events: GameEngineEvent[],
  rejected: Array<{ playerId: string; reason: string }>,
  heroAttackers: Map<string, string>,
  damageTracker: Map<string, { hero: number; ice: number }>,
): {
  players: Record<string, PlayerState>
  zones: Record<string, ZoneRuntimeState>
} {
  const uses = validActions.filter((a) => a.command.type === 'use')
  for (const action of uses) {
    const cmd = action.command as { type: 'use'; item: string; target?: TargetRef | string }
    const tempState: GameState = { ...state, players, zones, waves, ice, terminals }
    const result = Effect.runSync(
      useItem(tempState, action.playerId, cmd.item, cmd.target).pipe(
        Effect.match({
          onFailure: (error) => {
            rejected.push({
              playerId: action.playerId,
              reason: `Cannot use ${cmd.item}: ${error._tag.replace(/Error$/, '')}`,
            })
            return null
          },
          onSuccess: (updated): GameState | null => updated,
        }),
      ),
    )
    if (result) {
      const prePlayers = players
      players = { ...result.players }
      zones = { ...result.zones }
      events.push({
        _tag: 'ability_used',
        cycle: state.cycle,
        playerId: action.playerId,
        abilityId: ITEMS[cmd.item]?.active?.id ?? cmd.item,
      })

      // Intercept Shell / Ablative Shell / Mirror Shell block targeted item actives the
      // same as targeted ability casts — Burnout/Scythe/Ethereal/Stasis Shunt all aim at
      // a single enemy hero. Resolve that hero from the use target (dual-use
      // items like Stasis Shunt/Ethereal carry no active.targetType, so resolve the
      // explicit target rather than gating on it), and if it's an enemy, run the
      // shared block BEFORE the HP-diff synthesis below — a block reverts the
      // target to its pre-use state, so the diff then emits no damage for it.
      const useUser = prePlayers[action.playerId]
      let blockTargetId: string | undefined
      const useTarget = cmd.target
      if (typeof useTarget === 'string') {
        const id = useTarget.startsWith('hero:') ? useTarget.slice(5) : useTarget
        if (prePlayers[id]) blockTargetId = id
      } else if (useTarget?.kind === 'hero') {
        blockTargetId = findTargetPlayer({ ...state, players: prePlayers }, useTarget)?.id
      }
      if (useUser && blockTargetId && prePlayers[blockTargetId]?.team !== useUser.team) {
        players = applyTargetedSpellBlock(
          players,
          prePlayers,
          blockTargetId,
          action.playerId,
          'code',
          state.cycle,
          events,
        )
      }

      // Item actives that change INTEG (Burnout, Cryo Routine, …) mutate INTEG inside
      // useItem but, historically, emitted NO damage/heal event — so an item
      // kill gave no killer credit/bounty/assist, never reflected Spite Plate,
      // and never fired the damage-taken passives (daemon stealth-break,
      // cache/firewall/proxy). Diff pre→post INTEG and synthesise the same events
      // the cast path does (ActionResolver.resolveHeroCast), so item damage is a
      // first-class damage source. Magical is the item-nuke damage type.
      const user = players[action.playerId]
      for (const [pid, post] of Object.entries(players)) {
        const pre = prePlayers[pid]
        if (!pre) continue
        const delta = pre.integ - post.integ
        if (delta > 0) {
          events.push({
            _tag: 'damage',
            cycle: state.cycle,
            sourceId: action.playerId,
            targetId: pid,
            amount: delta,
            damageType: 'code',
          })
          if (user && post.team !== user.team) {
            heroAttackers.set(action.playerId, pid)
            const dt = damageTracker.get(action.playerId) ?? { hero: 0, ice: 0 }
            dt.hero += delta
            damageTracker.set(action.playerId, dt)

            // Spite Plate: an enemy hit by the item reflects the INTEG it lost back
            // at the user as black damage — same formula as the cast/attack path.
            if (post.buffs.some((b) => b.id === 'spite_plate')) {
              const userPost = players[action.playerId]
              if (userPost) {
                const returnDamage = computeSpitePlateReflect(delta)
                const userNewHp = Math.max(0, userPost.integ - returnDamage)
                players = {
                  ...players,
                  [action.playerId]: { ...userPost, integ: userNewHp, alive: userNewHp > 0 },
                }
                events.push({
                  _tag: 'damage',
                  cycle: state.cycle,
                  sourceId: pid,
                  targetId: action.playerId,
                  amount: returnDamage,
                  damageType: 'black',
                })
              }
            }
          }
        } else if (delta < 0) {
          events.push({
            _tag: 'heal',
            cycle: state.cycle,
            sourceId: action.playerId,
            targetId: pid,
            amount: -delta,
          })
        }
      }

      // Hex (Lockout Shunt) and Cyclone (Stasis Shunt) are pure disables with no HP
      // delta — without this diff they landed completely silently.
      emitStatusApplied(prePlayers, players, action.playerId, state.cycle, events)
    }
  }

  return { players, zones }
}

/**
 * Breach phase (OWNER DECISION: breach resolves BEFORE movement). Runs right
 * after item actives (phase 0) and before the instant casts and movement, so
 * an opening is committed at the top of the cycle:
 *
 * - CO-LOCATION is judged at CYCLE START (`state.players`) — the zone the
 *   order was validated against. A target that walks, blinks or is shoved out
 *   this same cycle is still breached; nobody "leaves before it lands".
 * - The caster must be standing when this phase opens (a phase-0 item kill
 *   drops the order); a swing that drops them LATER this cycle does not undo it.
 * - Target alive, not AIRGAPPED (Hardshell in phase 0 beats it), and the
 *   caster's BW are checked at phase start, after item actives.
 * - Everything that resolves later this cycle sees the opening (an ally's code
 *   swing lands in full; AoE control lands). Single-target control at a CLOSED
 *   target was already converted into its caster's own breach at validation, so
 *   the breacher's follow-up cast is next cycle — one order per cycle.
 * - Self-flush (`breach self`) is NOT here: it still resolves after the shop.
 *
 * Resolution is in sorted player-id order over a phase-start snapshot, so
 * submission order and player-map key order never change the outcome.
 */
function resolveBreachPhase(
  state: GameState,
  validActions: PlayerAction[],
  players: Record<string, PlayerState>,
  events: GameEngineEvent[],
  rejected: Array<{ playerId: string; reason: string }>,
): Record<string, PlayerState> {
  const committed = aliveIds(players)
  const breachActions = validActions
    .filter((a) => a.command.type === 'breach' && a.command.target.kind === 'hero')
    .sort((a, b) => compareCodePoints(a.playerId, b.playerId))
  for (const action of breachActions) {
    const caster = players[action.playerId]
    if (!caster || action.command.type !== 'breach') continue
    if (!committed.has(action.playerId)) {
      rejected.push({
        playerId: action.playerId,
        reason: 'You went down before your breach landed',
      })
      continue
    }
    const startCaster = state.players[action.playerId]
    // The order was validated at cycle start; phase 0 (item actives) can still
    // kill, airgap or drain before this phase opens. Say so instead of eating
    // the cycle in silence.
    const target = findTargetPlayer({ ...state, players }, action.command.target)
    const startTarget = target ? state.players[target.id] : undefined
    const failure = !target
      ? 'Breach target is gone'
      : !target.alive
        ? `${target.name} went down before your breach landed`
        : !startCaster || !startTarget || startTarget.zone !== startCaster.zone
          ? 'Target not in your zone'
          : hasBuff(target, 'airgap')
            ? `${target.name} is AIRGAPPED — breach fails`
            : caster.bw < BREACH_BW_COST
              ? `Need ${BREACH_BW_COST} BW to breach`
              : null
    if (!target || target.team === caster.team) continue
    if (failure) {
      rejected.push({ playerId: action.playerId, reason: failure })
      continue
    }
    if (caster.buffs.some((b) => b.id === 'item_cd_breach' && b.cyclesRemaining > 0)) continue

    let nextCaster = {
      ...caster,
      bw: Math.max(0, caster.bw - BREACH_BW_COST),
    }
    nextCaster = applyBuff(nextCaster, {
      id: 'item_cd_breach',
      stacks: 1,
      cyclesRemaining: BREACH_COOLDOWN_CYCLES,
      source: caster.id,
    })
    const nextTarget = applyBuff(target, {
      id: 'breached',
      stacks: 1,
      cyclesRemaining: BREACH_DURATION_CYCLES,
      source: caster.id,
    })
    players = {
      ...players,
      [action.playerId]: nextCaster,
      [target.id]: nextTarget,
    }
    events.push({
      _tag: 'breach_opened',
      cycle: state.cycle,
      playerId: action.playerId,
      targetId: target.id,
      durationCycles: BREACH_DURATION_CYCLES,
      ...(action.convertedFrom
        ? {
            fromAbility: action.convertedFrom.ability,
            fromAbilityName: action.convertedFrom.abilityName,
          }
        : {}),
    })
  }
  return players
}

/**
 * Post-shop phases: breach self-flush, harden, backup/cache pickup, maxInteg/maxBw recalc, scrip/XP
 * awards (wave/neutral/ice), damage tracking, ward placement. These all
 * run after the shop phase and before the final state assembly.
 */
function resolvePostShopPhases(
  state: GameState,
  validActions: PlayerAction[],
  players: Record<string, PlayerState>,
  zones: Record<string, ZoneRuntimeState>,
  waves: WaveUnitState[],
  ice: IceState[],
  neutrals: SiltDwellerState[],
  events: GameEngineEvent[],
  rejected: Array<{ playerId: string; reason: string }>,
  damageTracker: Map<string, { hero: number; ice: number }>,
  waveKills: Array<{ playerId: string; waveId: string; waveType: 'line' | 'sweep' | 'breach' }>,
  neutralKills: Array<{ playerId: string; neutralId: string }>,
  iceKills: Array<{ zone: string; team: TeamId }>,
  getCachedItemStats: (playerId: string, items: (string | null)[]) => ItemStats,
): {
  players: Record<string, PlayerState>
  zones: Record<string, ZoneRuntimeState>
  ice: IceState[]
  neutrals: SiltDwellerState[]
  teams: { chaff: TeamState; audit: TeamState }
  backup: GameState['backup']
  caches: CacheState[]
} {
  let teams = { ...state.teams }

  // Breach SELF-FLUSH — strips your own window late in the cycle (after the
  // shop), so swings and casts resolved earlier this cycle still hit it open.
  // Opening a breach on an enemy resolves at the top of the cycle instead
  // (resolveBreachPhase, before movement). A flush is committed only by a hero
  // standing when this step opens.
  const flushCommitted = aliveIds(players)
  const flushActions = validActions
    .filter((a) => a.command.type === 'breach' && a.command.target.kind === 'self')
    .sort((a, b) => compareCodePoints(a.playerId, b.playerId))
  for (const action of flushActions) {
    const caster = players[action.playerId]
    if (!caster) continue
    if (!flushCommitted.has(action.playerId)) {
      rejected.push({
        playerId: action.playerId,
        reason: 'You went down before your flush landed',
      })
      continue
    }
    if (!isBreached(caster) || caster.bw < BREACH_BW_COST) continue
    players = {
      ...players,
      [action.playerId]: {
        ...caster,
        bw: Math.max(0, caster.bw - BREACH_BW_COST),
        buffs: caster.buffs.filter((b) => b.id !== 'breached'),
      },
    }
    events.push({
      _tag: 'breach_opened',
      cycle: state.cycle,
      playerId: action.playerId,
      targetId: action.playerId,
      durationCycles: 0, // flush
    })
  }

  // Harden commands
  const glyphActions = validActions.filter((a) => a.command.type === 'harden')
  for (const action of glyphActions) {
    const player = players[action.playerId]
    if (!player) continue
    const team = player.team
    const teamState = teams[team]
    if (teamState.hardenUsedCycle !== null) {
      const ticksSinceUse = state.cycle - teamState.hardenUsedCycle
      if (ticksSinceUse < HARDEN_COOLDOWN_CYCLES) {
        events.push({
          _tag: 'harden_on_cooldown',
          cycle: state.cycle,
          playerId: action.playerId,
          remainingTicks: HARDEN_COOLDOWN_CYCLES - ticksSinceUse,
        })
        rejected.push({
          playerId: action.playerId,
          reason: `Harden is not ready — ${HARDEN_COOLDOWN_CYCLES - ticksSinceUse}c remaining`,
        })
        continue
      }
    }
    ice = ice.map((t) => (t.team === team ? { ...t, invulnerable: true } : t))
    teams = { ...teams, [team]: { ...teamState, hardenUsedCycle: state.cycle } }
    events.push({ _tag: 'harden_used', cycle: state.cycle, team })
  }

  // Backup pickup
  let backupGround = state.backup
  const backupPickups = validActions.filter((a) => a.command.type === 'backup')
  for (const action of backupPickups) {
    const tempState: GameState = {
      ...state,
      players,
      waves,
      ice,
      caches: state.caches ?? [],
      tenant: state.tenant,
      backup: backupGround,
    }
    const result = pickupBackup(tempState, action.playerId)
    if (result.event) {
      players = { ...result.state.players }
      backupGround = result.state.backup
      events.push(result.event)
    }
  }

  // Cache pickup
  let cachesGround = state.caches ?? []
  const cachePickups = validActions.filter((a) => a.command.type === 'grab')
  for (const action of cachePickups) {
    const player = players[action.playerId]
    if (!player) continue
    const tempState: GameState = {
      ...state,
      players,
      waves,
      ice,
      caches: cachesGround,
      tenant: state.tenant,
      backup: state.backup,
    }
    const result = pickupCache(tempState, action.playerId, player.zone)
    if (result.event) {
      players = { ...result.state.players }
      cachesGround = result.state.caches ?? []
      events.push(result.event)
    }
  }

  // Recalculate maxInteg/maxBw
  for (const [pid, player] of Object.entries(players)) {
    const hero = player.heroId ? HEROES[player.heroId] : null
    if (!hero) continue
    const baseMaxHp = hero.baseStats.integ + (hero.growthPerLevel.integ ?? 0) * (player.level - 1)
    const baseMaxMp = hero.baseStats.bw + (hero.growthPerLevel.bw ?? 0) * (player.level - 1)
    const itemBonuses = getCachedItemStats(pid, player.items)
    const treadsHp = player.buffs.find((b) => b.id === 'gait_rig_hp')?.stacks ?? 0
    const treadsMp = player.buffs.find((b) => b.id === 'gait_rig_mp')?.stacks ?? 0
    const newMaxHp =
      baseMaxHp + (itemBonuses.integ ?? 0) + getTalentStatBonus(player, 'integ') + treadsHp
    const newMaxMp = baseMaxMp + (itemBonuses.bw ?? 0) + getTalentStatBonus(player, 'bw') + treadsMp
    if (newMaxHp !== player.maxInteg || newMaxMp !== player.maxBw) {
      // Preserve the hp/mp PERCENTAGE across any max change (item buy/sell,
      // talent, power-treads toggle): a full hero stays full, a half-hp hero
      // stays at half. Level-ups don't reach here — levelUpHero reconciles maxInteg
      // with a flat gain, so the guard above is false for them. A live player is
      // never dropped to 0 by a max change (e.g. selling an INTEG item at low INTEG).
      const hpRatio = player.maxInteg > 0 ? player.integ / player.maxInteg : 1
      const mpRatio = player.maxBw > 0 ? player.bw / player.maxBw : 1
      const scaledHp = Math.min(newMaxHp, Math.floor(newMaxHp * hpRatio))
      const newInteg = player.integ > 0 ? Math.max(1, scaledHp) : scaledHp
      const newBw = Math.min(newMaxMp, Math.floor(newMaxMp * mpRatio))
      players = {
        ...players,
        [pid]: { ...player, maxInteg: newMaxHp, maxBw: newMaxMp, integ: newInteg, bw: newBw },
      }
    }
  }

  // Wave last-hit scrip + XP. Kills are grouped per unit: a strip that several
  // same-cycle swings were lethal for is ONE down shared by its claimants —
  // the payload and the last-hit XP split evenly (remainder pennies to the
  // sorted-first claimants), and the zone share pays once, excluding every
  // claimant. Sorted iteration keeps the outcome identical under any
  // permutation of the cycle's actions.
  const killsByWave = new Map<
    string,
    { waveType: 'line' | 'sweep' | 'breach'; playerIds: string[] }
  >()
  for (const kill of waveKills) {
    const entry = killsByWave.get(kill.waveId) ?? { waveType: kill.waveType, playerIds: [] }
    if (!entry.playerIds.includes(kill.playerId)) entry.playerIds.push(kill.playerId)
    killsByWave.set(kill.waveId, entry)
  }
  for (const [waveId, { waveType, playerIds }] of [...killsByWave.entries()].sort(([a], [b]) =>
    compareCodePoints(a, b),
  )) {
    const claimants = [...playerIds].sort()
    const payload = waveStripScrip(waveType)
    const xpShare = Math.floor(WAVE_XP / claimants.length)
    for (const [i, playerId] of claimants.entries()) {
      const scripShare =
        Math.floor(payload / claimants.length) + (i < payload % claimants.length ? 1 : 0)
      const tempState: GameState = { ...state, players, waves, ice }
      players = { ...awardLastHit(tempState, playerId, waveType, scripShare).players }
      const killer = players[playerId]
      if (!killer) continue
      players = { ...players, [playerId]: { ...killer, xp: killer.xp + xpShare } }
      // The reward line the feed shows ("last-hit +38g") — this event existed in
      // the protocol but was never emitted, so the player's own farming was the
      // one thing the combat log stayed silent about.
      events.push({
        _tag: 'wave_strip',
        cycle: state.cycle,
        playerId,
        waveId,
        waveType,
        scripAwarded: scripShare,
      })
    }
    // Lane-mates standing here share a fraction. XP used to come exclusively
    // from last-hits, so a laner who mistimed their attacks earned literally
    // nothing and fell five levels behind. Claimants keep their split of
    // WAVE_XP above, so timing is rewarded — presence just stops being worth
    // zero. The mirror of this for wave-on-wave deaths lives in WaveAI, and
    // that is the path most waves actually die on.
    // A tutorial training unit pays its stripper only (the drill's "+scrip"),
    // never lane-mates — it is not lane farm.
    const anchor = claimants.map((id) => players[id]).find((p) => p !== undefined)
    if (anchor && !isTrainingWave({ id: waveId })) {
      players = awardZoneXp(players, anchor.zone, anchor.team, WAVE_XP_SHARED, claimants)
    }
  }

  // Neutral kill scrip + XP — grouped per camp: simultaneous lethal swings
  // share the bounty evenly (remainder pennies deterministic by sorted
  // playerId), the camp is removed once, and iteration is sorted so nothing
  // depends on message arrival order.
  const killsByNeutral = new Map<string, string[]>()
  for (const kill of neutralKills) {
    const list = killsByNeutral.get(kill.neutralId) ?? []
    if (!list.includes(kill.playerId)) list.push(kill.playerId)
    killsByNeutral.set(kill.neutralId, list)
  }
  for (const [neutralId, playerIds] of [...killsByNeutral.entries()].sort(([a], [b]) =>
    compareCodePoints(a, b),
  )) {
    const neutral = neutrals.find((n) => n.id === neutralId)
    if (!neutral) continue
    const stats = SILT_DWELLERS[neutral.type as SiltDwellerType]
    if (!stats) continue
    const claimants = [...playerIds].sort()
    for (const [i, playerId] of claimants.entries()) {
      const killer = players[playerId]
      if (!killer) continue
      const scripShare =
        Math.floor(stats.scrip / claimants.length) + (i < stats.scrip % claimants.length ? 1 : 0)
      const xpShare =
        Math.floor(stats.xp / claimants.length) + (i < stats.xp % claimants.length ? 1 : 0)
      players = {
        ...players,
        [playerId]: { ...killer, scrip: killer.scrip + scripShare, xp: killer.xp + xpShare },
      }
      events.push({
        _tag: 'neutral_killed' as const,
        cycle: state.cycle,
        playerId,
        neutralId: neutral.id,
        neutralType: neutral.type,
        zone: neutral.zone,
      })
    }
    neutrals = neutrals.filter((n) => n.id !== neutralId)
  }

  // Ice kill scrip
  for (const kill of iceKills) {
    const nearbyAllies = Object.entries(players)
      .filter(([, p]) => p.zone === kill.zone && p.team !== kill.team && p.alive)
      .map(([id]) => id)
    const tempState: GameState = { ...state, players, waves, ice }
    const awarded = awardIceKill(tempState, kill.zone, nearbyAllies)
    // Read the payout back off the diff rather than recomputing the split — the
    // event can then never disagree with what the player's scrip actually did.
    for (const id of nearbyAllies) {
      const gained = (awarded.players[id]?.scrip ?? 0) - (players[id]?.scrip ?? 0)
      if (gained > 0) {
        events.push({
          _tag: 'scrip_change',
          cycle: state.cycle,
          playerId: id,
          amount: gained,
          reason: 'ice kill',
        })
      }
    }
    players = { ...awarded.players }
  }

  // Damage tracking
  for (const [pid, dmg] of damageTracker.entries()) {
    const p = players[pid]
    if (p) {
      players = {
        ...players,
        [pid]: {
          ...p,
          damageDealt: p.damageDealt + dmg.hero,
          iceDamageDealt: p.iceDamageDealt + dmg.ice,
        },
      }
    }
  }

  // Ward placement
  const wardActions = validActions.filter((a) => a.command.type === 'tap')
  for (const action of wardActions) {
    const cmd = action.command as { type: 'tap'; zone: string }
    const player = players[action.playerId]
    if (player) {
      const wardSlot = player.items.findIndex((i) => i === 'camtap' || i === 'sniffer')
      if (wardSlot === -1) continue
      const wardType = player.items[wardSlot] === 'sniffer' ? 'sniffer' : 'camtap'
      const placed = placeWard(zones, cmd.zone, player.team, state.cycle, wardType)
      if (placed) {
        const newItems = [...player.items]
        newItems[wardSlot] = null
        players = { ...players, [action.playerId]: { ...player, items: newItems } }
        events.push({
          _tag: 'ward_placed',
          cycle: state.cycle,
          playerId: action.playerId,
          zone: cmd.zone,
          team: player.team,
          wardType,
        })
      }
    }
  }

  return { players, zones, ice, neutrals, teams, backup: backupGround, caches: cachesGround }
}

// ── Resolution Pipeline ────────────────────────────────────────────

export function resolveActions(
  state: GameState,
  actions: PlayerAction[],
  /** Deterministic per-tick rng (see rng.ts) — every crit/proc roll in this
   *  resolution pass draws from it. Defaults to Math.random for back-compat
   *  with existing direct callers/tests. */
  rng: () => number = Math.random,
): Effect.Effect<{
  state: GameState
  events: GameEngineEvent[]
  heroAttackers: Map<string, string>
  /** Actions that failed inside resolution (BW, bad target, slow-cancel). */
  rejected: Array<{ playerId: string; reason: string }>
}> {
  return Effect.sync(() => {
    // Anti-cheat checks run here (NOT in GameLoop's pre-filter, which only
    // calls validateAction). validateAction is the single authoritative
    // validation path — GameLoop already filtered invalid actions out before
    // calling resolveActions, so we do NOT re-run validateAction here in
    // production. A dev/test-only assertion catches a divergence between the
    // two call sites if one is ever changed without the other.
    const cheatDetections: Array<{
      playerId: string
      command: Command
      violations: CheatDetection[]
    }> = []
    // Item actives resolve first (Phase 0) and several of them MOVE the caster —
    // blink, force staff, hurricane pike. Anti-cheat's vision check reads
    // pre-cycle zones, so it reads a hero attacking into the zone they are about
    // to blink to as an attack on an "invisible" hero and drops it: exactly the
    // item→attack combo the item slot exists to enable. The attack phase's own
    // zone check still rejects a genuinely out-of-zone swing, with a message
    // rather than in silence.
    const repositioning = new Set(
      actions.filter((a) => a.command.type === 'use').map((a) => a.playerId),
    )
    const antiCheatRefusals: Array<{ playerId: string; reason: string }> = []
    // Auto-breach conversion is idempotent: GameLoop already applied it before
    // validation; repeating it here keeps direct callers on the same rule.
    let validActions = actions
      .map((a) => convertClosedControlCast(state, a))
      .filter((a) => {
        if (!isRealProduction()) {
          const validationError = validateAction(state, a)
          if (validationError) {
            // GameLoop should have filtered this — a divergence is a bug.
            wsLog.warn('resolveActions received an action GameLoop would have rejected', {
              playerId: a.playerId,
              command: a.command.type,
              error: validationError,
            })
            return false
          }
        }

        // Anti-cheat judges what a CLIENT sent. GameLoop's standing-order
        // continuations are engine-generated from an order the player typed ticks
        // ago, and a stale one — the held hero stepped out of the zone — reads as
        // a VISION_BYPASS: it would be logged as an attempted cheat every 4s AND
        // dropped here, before the attack phase could retire the order that keeps
        // producing it.
        if (a.synthesized) return true
        if (a.command.type === 'attack' && repositioning.has(a.playerId)) return true

        // Anti-cheat checks
        const violations = runAntiCheatChecks(state, a.playerId, a.command)
        if (violations.length > 0) {
          wsLog.warn('Anti-cheat violation detected', {
            playerId: a.playerId,
            command: a.command.type,
            violations: violations.map((v) => ({ type: v.violationType, severity: v.severity })),
          })
          cheatDetections.push({ playerId: a.playerId, command: a.command, violations })
          // Reject high and critical violations; lower severities are logged only
          if (violations.some((v) => v.severity === 'critical' || v.severity === 'high')) {
            // Dropped, but never in silence: the same order is also a plain
            // mistake (`attack hero:<x>` with x elsewhere), and it gets the text
            // the attack phase would have given — which never says where.
            antiCheatRefusals.push({ playerId: a.playerId, reason: antiCheatDropReason(state, a) })
            return false
          }
        }

        return true
      })

    let players = { ...state.players }
    const events: GameEngineEvent[] = []
    const heroAttackers = new Map<string, string>()
    const rejected: Array<{ playerId: string; reason: string }> = [...antiCheatRefusals]
    let zones = { ...state.zones }
    let terminals = state.terminals
    let waves = [...state.waves]
    let neutrals = [...(state.neutrals ?? [])]
    let ice = [...state.ice]
    let teams = { ...state.teams }
    const waveKills: Array<{
      playerId: string
      waveId: string
      waveType: 'line' | 'sweep' | 'breach'
    }> = []
    const neutralKills: Array<{ playerId: string; neutralId: string }> = []
    const iceKills: Array<{ zone: string; team: TeamId }> = []
    const damageTracker = new Map<string, { hero: number; ice: number }>()

    // Build hero lookup index (once per resolveActions)
    const heroIndex = new Map<string, string>()
    // Normalised form alongside each exact key: the id stays `null_ref` (B1a),
    // the TYPED form is convenience — `null_ref`, `nullref` and `null-ref`
    // resolve alike. Exact matches win; the normalised map is only a fallback
    // so two players literally named 'A_B' and 'AB' never collide.
    const heroIndexNormalised = new Map<string, string>()
    const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
    for (const [id, p] of Object.entries(players)) {
      heroIndex.set(p.name.toLowerCase(), id)
      heroIndex.set(p.id.toLowerCase(), id)
      if (p.heroId) heroIndex.set(p.heroId.toLowerCase(), id)
      heroIndexNormalised.set(normalise(p.name), id)
      heroIndexNormalised.set(normalise(p.id), id)
      if (p.heroId) heroIndexNormalised.set(normalise(p.heroId), id)
    }
    const findHeroByNameCached = (name: string): string | null => {
      return heroIndex.get(name.toLowerCase()) ?? heroIndexNormalised.get(normalise(name)) ?? null
    }

    // Taunt forces every taunted hero to attack the taunter (Kernel/Firewall E
    // "force enemies to attack me"). validateAction already blocked their move +
    // cast; here we OVERRIDE their action with an attack on the taunter so they
    // can't act freely — overriding bots too, so no separate bot-AI handling is
    // needed. Skipped for Hardshell (airgap ignores the debuff) and for heroes
    // who couldn't attack anyway (stun/feared/ghost), and only when the taunter
    // is alive in the same zone (otherwise there's nothing to force-attack).
    const tauntForced = new Map<string, string>()
    for (const [pid, p] of Object.entries(players)) {
      if (!p.alive) continue
      if (p.buffs.some((b) => b.id === 'airgap')) continue
      if (p.buffs.some((b) => b.id === 'stun' || b.id === 'feared' || b.id === 'ghost_form')) {
        continue
      }
      const taunt = p.buffs.find((b) => b.id === 'taunt')
      if (!taunt) continue
      const taunter = players[taunt.source]
      if (taunter?.alive && taunter.zone === p.zone && taunter.team !== p.team) {
        tauntForced.set(pid, taunter.id)
      }
    }
    if (tauntForced.size > 0) {
      validActions = validActions.filter((a) => !tauntForced.has(a.playerId))
      for (const [pid, taunterId] of tauntForced) {
        validActions.push({
          playerId: pid,
          command: { type: 'attack', target: { kind: 'hero', name: taunterId } },
          forced: true,
        })
      }
    }

    // Item stat cache
    const itemStatCache = new Map<string, ItemStats>()
    const getCachedItemStats = (playerId: string, items: (string | null)[]): ItemStats => {
      const key = `${playerId}:${items.filter(Boolean).join(',')}`
      let cached = itemStatCache.get(key)
      if (!cached) {
        cached = getItemStatBonuses(items)
        itemStatCache.set(key, cached)
      }
      return cached
    }

    // Phase 0: Item actives — first, so a blink/Hardshell/Ethereal lands BEFORE the
    // ability cast in the same cycle rather than after it.
    {
      const result = resolveItemActivesPhase(
        state,
        validActions,
        players,
        zones,
        waves,
        ice,
        terminals,
        events,
        rejected,
        heroAttackers,
        damageTracker,
      )
      players = result.players
      zones = result.zones
    }

    // Phase 0.5: Breach — opens BEFORE movement (and before the instant casts),
    // judged on cycle-start co-location. See resolveBreachPhase.
    players = resolveBreachPhase(state, validActions, players, events, rejected)

    // Phase 1: Instant abilities (stuns, silences)
    {
      const result = resolveInstantCastsPhase(
        state,
        validActions,
        players,
        zones,
        waves,
        ice,
        neutrals,
        terminals,
        events,
        heroAttackers,
        rejected,
        damageTracker,
        waveKills,
        neutralKills,
        findHeroByNameCached,
        rng,
      )
      players = result.players
      zones = result.zones
      waves = result.waves
      neutrals = result.neutrals
    }

    // Locate everything phases 0–1 emitted from PRE-movement positions: a hero
    // silenced here and then walking out was silenced where they stood (the fog
    // filter's location test reads this stamp — see LOCATED_EVENT_TAGS).
    // Post-movement phases are located by GameLoop.processCycle as it collects
    // resolveActions' events (the earliest stamp wins).
    stampEventZones(events, { players, waves, neutrals })

    // Phase 2: Movement — all moves resolve simultaneously
    {
      const result = resolveMovementPhase(
        state.cycle,
        validActions,
        players,
        state.zones,
        events,
        rejected,
      )
      players = result.players
      // events + rejected are mutated in place by the phase
    }

    // Phase 3: Attacks + targeted abilities — simultaneous
    {
      const result = resolveDenyPhase(state.cycle, validActions, players, waves, events, rejected)
      players = result.players
      waves = result.waves
    }

    const attacks = validActions.filter((a) => a.command.type === 'attack')
    const targetedCasts = validActions
      .filter(
        (a) =>
          a.command.type === 'cast' &&
          !isInstantAbility(
            players[a.playerId]!,
            a.command as { type: 'cast'; ability: 'q' | 'w' | 'e' | 'r' },
          ),
      )
      .sort((a, b) => compareCodePoints(a.playerId, b.playerId))
    // Swings and targeted casts share this phase's opening snapshot: a caster
    // standing when it opens resolves the cast even if a swing (or an earlier
    // cast) drops them first — exactly as a dropped hero's own swing still lands.
    const castCommitted = aliveIds(players)

    {
      const result = resolveAttackPhase(
        state,
        attacks,
        players,
        waves,
        ice,
        neutrals,
        terminals,
        events,
        rejected,
        heroAttackers,
        damageTracker,
        waveKills,
        neutralKills,
        iceKills,
        findHeroByNameCached,
        getCachedItemStats,
        rng,
      )
      players = result.players
      waves = result.waves
      ice = result.ice
      neutrals = result.neutrals
      terminals = result.terminals
    }

    // Resolve targeted casts
    for (const action of targetedCasts) {
      const result = resolveHeroCast(
        state,
        players,
        zones,
        waves,
        ice,
        neutrals,
        terminals,
        action,
        events,
        heroAttackers,
        rejected,
        damageTracker,
        waveKills,
        neutralKills,
        findHeroByNameCached,
        rng,
        castCommitted,
      )
      players = result.players
      zones = result.zones
      waves = result.waves
      neutrals = result.neutrals
    }

    // Phase 4: Passive effects, cooldown ticks, item passives
    {
      const result = resolvePassivesPhase(players, events, heroAttackers)
      players = result.players
    }

    // Phase 5: Buy/Sell
    {
      const result = resolveShopPhase(state, validActions, players, waves, ice, events, rejected)
      players = result.players
    }

    // Handle harden commands + pickups + statRecalc + awards + wards
    let backupGround = state.backup
    let cachesGround = state.caches ?? []
    {
      const result = resolvePostShopPhases(
        state,
        validActions,
        players,
        zones,
        waves,
        ice,
        neutrals,
        events,
        rejected,
        damageTracker,
        waveKills,
        neutralKills,
        iceKills,
        getCachedItemStats,
      )
      players = result.players
      zones = result.zones
      ice = result.ice
      neutrals = result.neutrals
      teams = result.teams
      backupGround = result.backup
      cachesGround = result.caches
    }

    const updatedState: GameState = {
      ...state,
      players,
      zones,
      waves,
      neutrals,
      ice,
      teams,
      terminals,
      backup: backupGround,
      caches: cachesGround,
    }

    return {
      state: updatedState,
      events,
      heroAttackers: rankHeroAttackers(heroAttackers, events),
      rejected,
    }
  })
}

// ── Ability helpers ────────────────────────────────────────────

function isInstantAbility(
  player: PlayerState,
  cmd: { type: 'cast'; ability: 'q' | 'w' | 'e' | 'r' },
): boolean {
  if (!player.heroId) return false
  const hero = HEROES[player.heroId]
  if (!hero) return false

  const ability = hero.abilities[cmd.ability]
  if (!ability) return false

  // Instant abilities are stuns/silences that resolve before movement
  return ability.effects.some((e) => e.type === 'stun' || e.type === 'silence')
}

/**
 * Intercept Shell / Ablative Shell / Mirror Shell protection against a SINGLE-target
 * effect aimed at `targetId`. Shared by hero ability casts (resolveHeroCast) and
 * targeted item actives (the use-item loop), so Burnout / Lockout Shunt /
 * Phase Shim / Stasis Shunt are blocked exactly like a targeted ability instead of
 * slipping through unblocked.
 *
 * On an armed block charge the target is reverted to its pre-effect state
 * (undoing the damage/disable) and one charge is consumed (firewall_block is
 * removed; spellblock is spent to stacks 0 with a fresh recharge window). On
 * Mirror Shell the effect is negated on the holder and the INTEG it would have lost is
 * reflected back at the caster (gated by the caster's own immunity). Emits
 * spell_blocked and returns the (possibly updated) players map.
 */
function applyTargetedSpellBlock(
  players: Record<string, PlayerState>,
  prePlayers: Record<string, PlayerState>,
  targetId: string,
  casterId: string,
  damageType: DamageType,
  cycle: number,
  events: GameEngineEvent[],
): Record<string, PlayerState> {
  const pre = prePlayers[targetId]
  const post = players[targetId]
  if (!pre) return players

  // Only an ARMED charge (stacks >= 1) blocks — a spent Linken's is stacks 0.
  const blockId = pre.buffs.find(
    (b) => (b.id === 'spellblock' || b.id === 'firewall_block') && b.stacks >= 1,
  )?.id
  if (blockId) {
    const buffs = pre.buffs.flatMap((b) => {
      if (b.id !== blockId) return [b]
      return b.id === 'spellblock'
        ? [{ ...b, stacks: 0, cyclesRemaining: LINKENS_RECHARGE_TICKS }]
        : []
    })
    events.push({
      _tag: 'spell_blocked',
      cycle,
      casterId,
      targetId,
      source: blockId === 'spellblock' ? 'intercept_shell' : 'ablative_shell',
    })
    return { ...players, [targetId]: { ...pre, buffs } }
  }

  if (post && pre.buffs.some((b) => b.id === 'mirror_shell')) {
    const reflected = pre.integ - post.integ
    let removed = false
    const buffs = pre.buffs.filter((b) => {
      if (!removed && b.id === 'mirror_shell') {
        removed = true
        return false
      }
      return true
    })
    let next = { ...players, [targetId]: { ...pre, buffs } } // negate on holder
    const casterPost = next[casterId]
    if (reflected > 0 && casterPost && !isDamageImmune(casterPost, damageType)) {
      const newInteg = Math.max(0, casterPost.integ - reflected)
      next = { ...next, [casterId]: { ...casterPost, integ: newInteg, alive: newInteg > 0 } }
      events.push({
        _tag: 'damage',
        cycle,
        sourceId: targetId,
        targetId: casterId,
        amount: reflected,
        damageType,
      })
    }
    events.push({
      _tag: 'spell_blocked',
      cycle,
      casterId,
      targetId,
      source: 'mirror_shell',
      reflected: reflected > 0 ? reflected : 0,
    })
    return next
  }

  return players
}

/**
 * The cast bridge — runs the per-hero registry resolver (`resolveAbility`)
 * against a temp GameState assembled from the in-flight resolution buffers,
 * then synthesizes backward-compatible damage/heal events by diffing
 * pre/post INTEG. Resolver failures (BW, target, cooldown) are surfaced via
 * the `rejected` channel instead of being silently dropped.
 *
 * The bridge must NOT deduct BW or set cooldowns itself — the hero
 * resolvers own scaled per-level costs and cooldowns.
 */
function resolveHeroCast(
  state: GameState,
  players: Record<string, PlayerState>,
  zones: GameState['zones'],
  waves: WaveUnitState[],
  ice: GameState['ice'],
  neutrals: SiltDwellerState[],
  terminals: GameState['terminals'],
  action: PlayerAction,
  events: GameEngineEvent[],
  heroAttackers: Map<string, string>,
  rejected: Array<{ playerId: string; reason: string }>,
  damageTracker: Map<string, { hero: number; ice: number }>,
  waveKills: Array<{ playerId: string; waveId: string; waveType: 'line' | 'sweep' | 'breach' }>,
  neutralKills: Array<{ playerId: string; neutralId: string }>,
  findHero: (name: string) => string | null,
  rng: () => number = Math.random,
  /** Heroes standing when this cast phase opened (see aliveIds). Their cast is
   *  committed: dropping, stunning or silencing them earlier in the same phase
   *  does not cancel it. Omitted = the caster's live state decides. */
  committed?: ReadonlySet<string>,
): {
  players: Record<string, PlayerState>
  zones: GameState['zones']
  waves: WaveUnitState[]
  neutrals: SiltDwellerState[]
} {
  const cmd = action.command as { type: 'cast'; ability: AbilitySlot; target?: TargetRef }
  const caster = players[action.playerId]
  if (!caster?.heroId) return { players, zones, waves, neutrals }

  // A committed caster resolves as the order was validated at cycle start: a
  // disable that landed THIS cycle gates their next cycle, not this one (the
  // Phase 1 contract), and a caster dropped earlier in the phase still casts —
  // from where they fell, and they stay down (restored after the resolver).
  const isCommitted = committed?.has(action.playerId) ?? false
  const fellThisPhase = isCommitted && !caster.alive
  const cycleStartBuffIds = new Set((state.players[action.playerId]?.buffs ?? []).map((b) => b.id))
  const suspended = isCommitted
    ? caster.buffs.filter(
        (b) => (b.id === 'stun' || b.id === 'silence') && !cycleStartBuffIds.has(b.id),
      )
    : []
  let castCaster = caster
  if (fellThisPhase || suspended.length > 0) {
    castCaster = {
      ...caster,
      ...(fellThisPhase ? { alive: true, integ: Math.max(1, caster.integ) } : {}),
      buffs: caster.buffs.filter((b) => !suspended.includes(b)),
    }
  }

  // Tier-25 exotic — global ultimate: the talented R can hit a hero in ANY zone.
  // The per-hero resolvers enforce a same-zone check, so we satisfy it by
  // temporarily placing the caster in the target's zone for the resolver call,
  // then restore the caster's real zone on the way out (the caster never moves).
  const isGlobalUlt =
    cmd.ability === 'r' &&
    cmd.target?.kind === 'hero' &&
    hasTalentCastEffect(caster, 'global_ultimate', 'r')
  const realCasterZone = caster.zone
  let castPlayers = castCaster === caster ? players : { ...players, [action.playerId]: castCaster }
  if (isGlobalUlt && cmd.target?.kind === 'hero') {
    const targetId = findHero(cmd.target.name)
    const targetZone = targetId ? players[targetId]?.zone : undefined
    if (targetZone && targetZone !== caster.zone) {
      castPlayers = { ...players, [action.playerId]: { ...castCaster, zone: targetZone } }
    }
  }

  // `neutrals` is the LIVE in-flight buffer. It used to fall through to
  // `state.neutrals` — a pre-attack-phase snapshot — so the array this cast
  // returned silently reverted every neutral the attack phase had just damaged.
  const tempState: GameState = {
    ...state,
    players: castPlayers,
    zones,
    waves,
    ice,
    neutrals,
    terminals,
  }
  // Effect.either keeps AbilityError failures as values — an uncaught defect
  // here would abort the entire cycle (GameLoop recovers but loses actions).
  const result = Effect.runSync(
    Effect.either(resolveAbility(tempState, action.playerId, cmd.ability, cmd.target, rng)),
  )

  if (Either.isLeft(result)) {
    const err = result.left
    // Concrete, actionable rejection text (design brief, quick win #1): name the
    // ability and the exact numbers so the player knows WHY and WHEN, not just
    // "that failed".
    const abilityName =
      HEROES[caster.heroId]?.abilities[cmd.ability]?.name ?? cmd.ability.toUpperCase()
    let reason: string
    if (err._tag === 'InsufficientBwError') {
      reason = `Not enough BW for ${abilityName}: need ${err.required}, have ${Math.floor(caster.bw)}`
    } else if (err._tag === 'CooldownError') {
      const cd = caster.cooldowns[cmd.ability] ?? 0
      reason = `${abilityName} on cooldown — ${cd} cycle${cd === 1 ? '' : 's'} left (ready T${state.cycle + cd})`
    } else {
      reason = err.reason
    }
    rejected.push({ playerId: action.playerId, reason })
    return { players, zones, waves, neutrals }
  }

  const newState = result.right.state
  let newPlayers = newState.players
  // The resolvers' wire events are otherwise discarded (see ability_used
  // below), but a hard control that fizzled on a CLOSED hero is news the
  // caster must get — carried through as control_resisted engine events.
  const resistedWire = result.right.events.filter((e) => e.type === 'control_resisted')
  // Restore the caster's real zone after a global ult — the resolver only saw
  // them in the target's zone to pass the same-zone check; they never moved.
  if (isGlobalUlt && newPlayers[action.playerId]) {
    const restored: PlayerState = { ...newPlayers[action.playerId]!, zone: realCasterZone }
    newPlayers = { ...newPlayers, [action.playerId]: restored }
  }
  // Hand back what the committed cast was resolved without: the fallen caster
  // stays down where they fell (no self-heal, no dash out of the grave), and a
  // disable suspended for this cast is still on them for next cycle.
  const castPost = newPlayers[action.playerId]
  if (castPost && (fellThisPhase || suspended.length > 0)) {
    newPlayers = {
      ...newPlayers,
      [action.playerId]: {
        ...castPost,
        ...(fellThisPhase ? { alive: false, integ: caster.integ, zone: caster.zone } : {}),
        buffs: [
          ...castPost.buffs,
          ...suspended.filter((b) => !castPost.buffs.some((x) => x.id === b.id)),
        ],
      },
    }
  }
  const abilityDef = HEROES[caster.heroId]?.abilities[cmd.ability]
  const damageType = abilityDef?.damageType ?? 'code'

  // Resolve the targeted hero id (used by the block check + ability_used event).
  // Uses the pre-built hero index (findHero) instead of a per-cast linear scan.
  let targetId: string | undefined
  if (cmd.target?.kind === 'hero') {
    targetId = findHero(cmd.target.name) ?? undefined
  }

  // Where this cast's own events start. `ability_used` can only be built at the
  // END (it carries the resolver-set cooldown), but the feed sorts a tick's
  // lines by salience and falls back to emission order — so appending it after
  // its own damage prints the effect before the cause. Spliced back in here.
  const castEvtIdx = events.length

  // Intercept Shell / Ablative Shell / Mirror Shell: a single-target ability on a
  // hero holding a charge fizzles — the caster still pays BW + cooldown, but
  // the target's effect is reverted and a charge consumed (shared with the
  // targeted-item-active path so Burnout/Scythe/Ethereal/Stasis Shunt block identically).
  if (targetId && abilityDef?.targetType === 'hero') {
    newPlayers = applyTargetedSpellBlock(
      newPlayers,
      players,
      targetId,
      action.playerId,
      damageType,
      state.cycle,
      events,
    )
  }

  // Synthesize legacy-shape damage/heal events from the INTEG diff. Amounts are
  // post-mitigation AND post-shield: a fully shield-absorbed ability hit
  // emits no damage event (and grants no assist credit). Basic attacks keep
  // pre-shield amounts — see the attack phase. Don't "fix" one to match the
  // other without revisiting both.
  // Stack Overflow (Overclock): the caster's next ability deals 2x damage —
  // double the INTEG lost by each enemy hit, then spend the charge after the loop.
  const hasOverclock = !!newPlayers[action.playerId]?.buffs.some(
    (b) => b.id === 'stack_overflow_buff',
  )
  // Damage this cast deals to enemy heroes — feeds the spell-lifesteal exotic.
  let castDamageToEnemies = 0
  // A damaging cast that cost an enemy hero NOTHING says why (damage_blocked):
  // the diff below emits no damage event for 0, so a fully shield-absorbed,
  // dodged or immune target used to leave the cast with no visible effect.
  const castDealsDamage = !!abilityDef?.effects.some(
    (e) => e.type === 'damage' || e.type === 'execute',
  )
  const castAbilityId = abilityDef?.id ?? cmd.ability
  for (const [pid, post] of Object.entries(newPlayers)) {
    const pre = players[pid]
    if (!pre) continue
    let delta = pre.integ - post.integ
    if (delta === 0 && castDealsDamage && pid !== action.playerId && pre.team !== caster.team) {
      const blocked = castBlockReason(pre, post, pid === targetId, damageType)
      // A Shell already fizzled the whole cast on this target (spell_blocked).
      const shelled = events
        .slice(castEvtIdx)
        .some((e) => e._tag === 'spell_blocked' && e.targetId === pid)
      if (blocked && !shelled) {
        events.push({
          _tag: 'damage_blocked',
          cycle: state.cycle,
          sourceId: action.playerId,
          targetId: pid,
          reason: blocked.reason,
          ...(blocked.amount !== undefined ? { amount: blocked.amount } : {}),
          damageType,
          abilityId: castAbilityId,
        })
      }
    }
    if (delta > 0 && hasOverclock && post.team !== caster.team) {
      const doubledHp = Math.max(0, post.integ - delta)
      newPlayers = { ...newPlayers, [pid]: { ...post, integ: doubledHp, alive: doubledHp > 0 } }
      delta *= 2
    }
    if (delta > 0) {
      events.push({
        _tag: 'damage',
        cycle: state.cycle,
        sourceId: action.playerId,
        targetId: pid,
        amount: delta,
        damageType,
      })
      if (post.team !== caster.team) {
        heroAttackers.set(action.playerId, pid)
        const dt = damageTracker.get(action.playerId) ?? { hero: 0, ice: 0 }
        dt.hero += delta
        damageTracker.set(action.playerId, dt)
        castDamageToEnemies += delta

        // Spite Plate: an enemy hero hit by this cast reflects the INTEG it lost
        // back at the caster as black damage — the same computeSpitePlateReflect
        // formula as the basic-attack reflect, so the two paths can never
        // diverge.
        if (post.buffs.some((b) => b.id === 'spite_plate')) {
          const casterPost = newPlayers[action.playerId]
          if (casterPost) {
            const returnDamage = computeSpitePlateReflect(delta)
            const casterNewHp = Math.max(0, casterPost.integ - returnDamage)
            newPlayers = {
              ...newPlayers,
              [action.playerId]: { ...casterPost, integ: casterNewHp, alive: casterNewHp > 0 },
            }
            events.push({
              _tag: 'damage',
              cycle: state.cycle,
              sourceId: pid,
              targetId: action.playerId,
              amount: returnDamage,
              damageType: 'black',
            })
          }
        }
      }
    } else if (delta < 0) {
      events.push({
        _tag: 'heal',
        cycle: state.cycle,
        sourceId: action.playerId,
        targetId: pid,
        amount: -delta,
      })
    }
  }
  if (hasOverclock) {
    const c = newPlayers[action.playerId]
    if (c) {
      newPlayers = {
        ...newPlayers,
        [action.playerId]: { ...c, buffs: c.buffs.filter((b) => b.id !== 'stack_overflow_buff') },
      }
    }
  }

  // NPCs the cast hit (damageEnemyNpcsInZone). Credited from the INTEG diff for the
  // same reason hero damage is: the resolvers' own wire events are discarded.
  let castWaves = collectNpcCastDamage(
    state.cycle,
    action.playerId,
    damageType,
    waves,
    newState.waves,
    events,
    waveKills,
  )
  let castNeutrals = collectNeutralCastDamage(
    state.cycle,
    action.playerId,
    damageType,
    neutrals,
    newState.neutrals,
    events,
    neutralKills,
  )

  // Tier-25 exotic — double cast: a chance for the talented ability to fire a
  // second time. Re-runs the hero resolver on the post-first-cast state with the
  // just-set cooldown cleared (so the echo isn't rejected); BW is paid again,
  // so the echo only happens if the caster can afford both casts. Emits plain
  // damage/heal events from the echo's INTEG diff (no Spite Plate/Overclock recursion
  // on the echo — deliberately simple).
  if (hasTalentCastEffect(caster, 'double_cast', cmd.ability) && rng() < DOUBLE_CAST_CHANCE) {
    const echoCaster = newPlayers[action.playerId]
    if (echoCaster) {
      const echoPlayers = {
        ...newPlayers,
        [action.playerId]: {
          ...echoCaster,
          cooldowns: { ...echoCaster.cooldowns, [cmd.ability]: 0 },
        },
      }
      const echoState: GameState = {
        ...state,
        players: echoPlayers,
        zones,
        waves: castWaves,
        ice,
        neutrals: castNeutrals,
        terminals,
      }
      const echoResult = Effect.runSync(
        Effect.either(resolveAbility(echoState, action.playerId, cmd.ability, cmd.target, rng)),
      )
      if (Either.isRight(echoResult)) {
        const echoNewPlayers = echoResult.right.state.players
        resistedWire.push(...echoResult.right.events.filter((e) => e.type === 'control_resisted'))
        // Feedback: announce the proc so the player knows the ability fired twice.
        events.push({
          _tag: 'double_cast',
          cycle: state.cycle,
          playerId: action.playerId,
          abilityId: abilityDef?.id ?? cmd.ability,
        })
        for (const [pid, post] of Object.entries(echoNewPlayers)) {
          const pre = echoPlayers[pid]
          if (!pre) continue
          const delta = pre.integ - post.integ
          // The echo is a second hit: blocked the same way as the first.
          const echoBlocked =
            delta === 0 && castDealsDamage && pid !== action.playerId && pre.team !== caster.team
              ? castBlockReason(pre, post, pid === targetId, damageType)
              : null
          if (echoBlocked) {
            events.push({
              _tag: 'damage_blocked',
              cycle: state.cycle,
              sourceId: action.playerId,
              targetId: pid,
              reason: echoBlocked.reason,
              ...(echoBlocked.amount !== undefined ? { amount: echoBlocked.amount } : {}),
              damageType,
              abilityId: castAbilityId,
            })
          }
          if (delta > 0) {
            events.push({
              _tag: 'damage',
              cycle: state.cycle,
              sourceId: action.playerId,
              targetId: pid,
              amount: delta,
              damageType,
            })
            if (post.team !== caster.team) {
              const dt = damageTracker.get(action.playerId) ?? { hero: 0, ice: 0 }
              dt.hero += delta
              damageTracker.set(action.playerId, dt)
              castDamageToEnemies += delta
            }
          } else if (delta < 0) {
            events.push({
              _tag: 'heal',
              cycle: state.cycle,
              sourceId: action.playerId,
              targetId: pid,
              amount: -delta,
            })
          }
        }
        castWaves = collectNpcCastDamage(
          state.cycle,
          action.playerId,
          damageType,
          castWaves,
          echoResult.right.state.waves,
          events,
          waveKills,
        )
        castNeutrals = collectNeutralCastDamage(
          state.cycle,
          action.playerId,
          damageType,
          castNeutrals,
          echoResult.right.state.neutrals,
          events,
          neutralKills,
        )
        newPlayers = echoNewPlayers
      }
    }
  }

  // Tier-25 exotic — spell lifesteal: heal the caster for a fraction of the
  // damage this cast dealt to enemy heroes (capped at max INTEG). Applies to the
  // double-cast echo's damage too, since castDamageToEnemies spans both.
  if (hasTalentCastEffect(caster, 'spell_lifesteal') && castDamageToEnemies > 0) {
    const lc = newPlayers[action.playerId]
    if (lc && lc.alive) {
      const healAmount = Math.min(
        Math.floor(SPELL_LIFESTEAL_PERCENT * castDamageToEnemies),
        Math.max(0, lc.maxInteg - lc.integ),
      )
      if (healAmount > 0) {
        newPlayers = {
          ...newPlayers,
          [action.playerId]: { ...lc, integ: lc.integ + healAmount },
        }
        events.push({
          _tag: 'heal',
          cycle: state.cycle,
          sourceId: action.playerId,
          targetId: action.playerId,
          amount: healAmount,
        })
      }
    }
  }

  // Crowd control the resolvers applied (root riders, AoE stuns, hexes) —
  // recovered from the buff diff, since result.right.events are discarded.
  emitStatusApplied(players, newPlayers, action.playerId, state.cycle, events)

  // One control_resisted per target+status (a double-cast echo resisting the
  // same control again is not news).
  const resistedSeen = new Set<string>()
  for (const e of resistedWire) {
    const targetIdR = String(e.payload['targetId'] ?? '')
    const status = String(e.payload['status'] ?? '')
    const key = `${targetIdR}:${status}`
    if (!targetIdR || resistedSeen.has(key)) continue
    resistedSeen.add(key)
    events.push({
      _tag: 'control_resisted',
      cycle: state.cycle,
      playerId: action.playerId,
      targetId: targetIdR,
      status,
      ability: cmd.ability,
      abilityName: abilityDef?.name ?? cmd.ability.toUpperCase(),
      reason: String(e.payload['reason'] ?? ''),
    })
  }

  // result.right.events are wire-format 'ability_cast' events the client
  // doesn't understand — discard them; ability_used/cooldown_used below
  // carry the resolver-set cooldown (the authoritative value).
  const actualCd = newPlayers[action.playerId]?.cooldowns[cmd.ability] ?? 0

  events.splice(castEvtIdx, 0, {
    _tag: 'ability_used',
    cycle: state.cycle,
    playerId: action.playerId,
    abilityId: abilityDef?.id ?? cmd.ability,
    targetId,
    cooldown: actualCd,
  })
  events.push({
    _tag: 'cooldown_used',
    cycle: state.cycle,
    playerId: action.playerId,
    abilityId: cmd.ability,
    cooldownCycles: actualCd,
    readyAtTick: state.cycle + actualCd,
  })

  return { players: newPlayers, zones: newState.zones, waves: castWaves, neutrals: castNeutrals }
}

/**
 * Credit ability damage that landed on lane waves: emit the same per-target
 * `damage` events the attack phase emits, and queue any kill through the SAME
 * `waveKills` accumulator a right-click uses, so an ability last hit pays
 * exactly what a basic attack does — bounty, XP, and the lane-mate XP share in
 * resolvePostShopPhases. Returns the post buffer so the caller can carry it on.
 */
function collectNpcCastDamage(
  cycle: number,
  casterId: string,
  damageType: DamageType,
  pre: WaveUnitState[],
  post: WaveUnitState[] | undefined,
  events: GameEngineEvent[],
  waveKills: Array<{ playerId: string; waveId: string; waveType: 'line' | 'sweep' | 'breach' }>,
): WaveUnitState[] {
  // Resolvers that don't touch waves return the buffer they were handed, so
  // reference equality means "nothing to diff" for the overwhelming majority.
  if (!post || post === pre) return pre
  const preInteg = new Map(pre.map((c) => [c.id, c.integ]))
  for (const c of post) {
    const was = preInteg.get(c.id)
    if (was === undefined || was <= c.integ) continue
    events.push({
      _tag: 'damage',
      cycle,
      sourceId: casterId,
      targetId: c.id,
      amount: was - c.integ,
      damageType,
    })
    if (c.integ <= 0 && was > 0) {
      waveKills.push({ playerId: casterId, waveId: c.id, waveType: c.type })
    }
  }
  return post
}

/** The neutral half of {@link collectNpcCastDamage} — same contract, and the
 *  kill feeds the `neutralKills` path that pays the camp's scrip + XP. */
function collectNeutralCastDamage(
  cycle: number,
  casterId: string,
  damageType: DamageType,
  pre: SiltDwellerState[],
  post: SiltDwellerState[] | undefined,
  events: GameEngineEvent[],
  neutralKills: Array<{ playerId: string; neutralId: string }>,
): SiltDwellerState[] {
  if (!post || post === pre) return pre
  const preInteg = new Map(pre.map((n) => [n.id, n.integ]))
  for (const n of post) {
    const was = preInteg.get(n.id)
    if (was === undefined || was <= n.integ) continue
    events.push({
      _tag: 'damage',
      cycle,
      sourceId: casterId,
      targetId: n.id,
      amount: was - n.integ,
      damageType,
    })
    if (n.integ <= 0 && was > 0) {
      neutralKills.push({ playerId: casterId, neutralId: n.id })
    }
  }
  return post
}
