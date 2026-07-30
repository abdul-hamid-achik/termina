import { Effect, Either } from 'effect'
import type {
  WaveUnitState,
  GameState,
  PlayerState,
  TeamId,
  TeamState,
  IceState,
  AncientState,
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
} from './EffectiveStats'
import { areAdjacent, findPath } from '~~/server/game/map/topology'
import { isCommandAllowedInTutorial, tutorialLockMessage } from '~~/server/game/modes/tutorial'
import { isBot } from '~~/server/game/ai/BotManager'
import { isShopZoneFor } from '~~/shared/constants/zones'
import {
  calculateKineticDamage,
  calculateCodeDamage,
  getIncomingDamageMultiplier,
  isDamageImmune,
} from './DamageCalculator'
import { computeSpitePlateReflect } from './CombatResolver'
import { placeWard, canAttackIce } from '~~/server/game/map/zones'
import { HEROES } from '~~/shared/constants/heroes'
import type { GameEngineEvent } from '~~/server/game/protocol/events'
import { applyBuff, isBreached, hasBuff, isHardControlBuffId } from '~~/server/game/heroes/_base'
import { buyItem, sellItem, useItem } from '~~/server/game/items/shop'
import { awardLastHit, awardIceKill } from './GoldDistributor'
import { pickupBackup } from './TenantAI'
import { pickupCache } from './CacheAI'
import { resolveAncientAttack, ANCIENT_ZONES } from './AncientSystem'
import { ITEMS } from '~~/shared/constants/items'
import {
  WAVE_XP,
  SILT_DWELLERS,
  type SiltDwellerType,
  WAVE_GOLD_MIN,
  WAVE_GOLD_MAX,
  waveUnitMaxHp,
  WAVE_XP_SHARED,
  HARDEN_COOLDOWN_TICKS,
  BREACH_DURATION_TICKS,
  BREACH_COOLDOWN_TICKS,
  BREACH_BW_COST,
  BURN_HP_THRESHOLD,
  BURN_GOLD_RATIO,
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
  // root, fear, taunt. Cyclone and Hex are hard disables that pierce it (checked
  // above), matching the usual convention.
  const debuffImmune = player.buffs.some((b) => b.id === 'airgap')

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
      // order — the hero walks one zone per tick toward it (resolveMovementPhase
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
      // Check for root/stun (taunt forces attacking — no fleeing). Hardshell bypasses.
      if (!debuffImmune && (hasDebuff(player, 'root') || hasDebuff(player, 'stun'))) {
        return 'Cannot move while rooted or stunned'
      }
      if (!debuffImmune && hasDebuff(player, 'taunt')) return 'Cannot move while taunted'
      return null
    }
    case 'attack': {
      if (!debuffImmune && hasDebuff(player, 'stun')) return 'Cannot attack while stunned'
      if (!debuffImmune && hasDebuff(player, 'feared')) return 'Cannot attack while feared'
      // Ghost Scepter: phased out — immune to kinetic damage, but cannot attack.
      if (player.buffs.some((b) => b.id === 'ghost_form')) {
        return 'Cannot attack while in ghost form'
      }
      return null
    }
    case 'cast': {
      if (!debuffImmune && hasDebuff(player, 'stun')) return 'Cannot cast while stunned'
      if (!debuffImmune && hasDebuff(player, 'silence')) return 'Cannot cast while silenced'
      if (!debuffImmune && hasDebuff(player, 'feared')) return 'Cannot cast while feared'
      if (!debuffImmune && hasDebuff(player, 'taunt')) return 'Cannot cast while taunted'
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
        // Concrete rejection (design brief, quick win #1): name + ticks + ready tick.
        const cd = player.cooldowns[cmd.ability]
        return `${ability.name} on cooldown — ${cd} tick${cd === 1 ? '' : 's'} left (ready T${state.tick + cd})`
      }
      // R4-11 teaching rejection: single-target hard control on a CLOSED enemy
      // fails with a message that names the fix. AoE control cannot be
      // pre-rejected — it fizzles per-target inside applyBuff.
      // Effect types map to buff ids: fear → feared; the rest share names.
      if (cmd.target?.kind === 'hero') {
        const carriesHardControl = ability.effects.some((e) => {
          const buffId = e.type === 'fear' ? 'feared' : e.type
          return isHardControlBuffId(buffId)
        })
        if (carriesHardControl) {
          const target = findTargetPlayer(state, cmd.target)
          if (
            target &&
            target.team !== player.team &&
            target.alive &&
            !isBreached(target) &&
            !hasBuff(target, 'airgap')
          ) {
            return `${target.name} is CLOSED — breach ${target.name} first`
          }
        }
      }
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
      const cdBuff = player.buffs.find((b) => b.id === `item_cd_${cmd.item}`)
      if (cdBuff && cdBuff.ticksRemaining > 0) return 'Item on cooldown'
      return null
    }
    case 'ward': {
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
    case 'backup':
    case 'grab':
      return null
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
      return null
    case 'select_talent':
      return null
    case 'harden':
      return null
    case 'breach': {
      if (!debuffImmune && hasDebuff(player, 'stun')) return 'Cannot breach while stunned'
      if (!debuffImmune && hasDebuff(player, 'feared')) return 'Cannot breach while feared'
      if (!debuffImmune && hasDebuff(player, 'taunt')) return 'Cannot breach while taunted'
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
      const cd = player.buffs.find((b) => b.id === 'item_cd_breach' && b.ticksRemaining > 0)
      if (cd) {
        return `Breach on cooldown — ${cd.ticksRemaining} cycle${cd.ticksRemaining === 1 ? '' : 's'} left`
      }
      return null
    }
    default:
      return null
  }
}

/**
 * Exact debuff-id sets per debuff class. Action gating must match buff ids
 * EXACTLY — the old `b.id.includes(type)` substring match would silently
 * disable actions if a future buff id contained a debuff substring (e.g. a
 * hypothetical `stun_immune` or `post_stun_buff`). Add new debuff ids to the
 * appropriate set here as they are authored.
 */
const DEBUFF_ID_SETS = {
  stun: new Set(['stun']),
  root: new Set(['root']),
  silence: new Set(['silence']),
  feared: new Set(['feared']),
  taunt: new Set(['taunt']),
  cyclone: new Set(['cyclone']),
  hex: new Set(['hex']),
} as const

type DebuffType = keyof typeof DEBUFF_ID_SETS

function hasDebuff(player: PlayerState, type: DebuffType): boolean {
  // `type` is keyof typeof DEBUFF_ID_SETS, so the lookup is always defined.
  return player.buffs.some((b) => DEBUFF_ID_SETS[type].has(b.id))
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
  tick: number,
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
        tick,
        sourceId,
        targetId: pid,
        status: buff.id,
        ticksRemaining: buff.ticksRemaining,
      })
    }
  }
}

// ── Resolution Pipeline ────────────────────────────────────────

/**
 * Resolve all player actions for a tick.
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
  tick: number,
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
      // Auto-path: the order names the DESTINATION; each tick moves one hop
      // along the BFS path (recomputed per tick, so it self-heals). A hop
      // beyond this one stores the destination as moveTarget — GameLoop
      // re-issues the move next tick until arrival or a new deliberate action.
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
      // Deterministic slow: instead of a per-tick coin flip (Math.random < slow),
      // block movement on a fixed, evenly-spaced pattern that yields the SAME
      // average skip rate (totalSlow% of ticks) but is fully predictable — a
      // slowed escape no longer fails "because of dice". `(tick * slow) % 100 < slow`
      // skips exactly slow/100 of ticks, distributed evenly across the slow.
      const slowBlocks = !hasted && totalSlow > 0 && (tick * totalSlow) % 100 < totalSlow
      if (slowBlocks) {
        // Synthesized continuations fail silently — the player already got
        // their feedback when they issued the order.
        if (!action.synthesized) {
          rejected.push({ playerId: action.playerId, reason: 'Slowed — failed to move' })
        }
        // The slow costs a tick of progress, not the order — keep walking.
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
          tick,
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
 * These apply before movement, but they do NOT gate the victim's SAME-tick
 * action (which was already validated at tick start) — a cast-applied disable
 * gates the victim's NEXT tick, which is why those disables use ticksRemaining 2
 * (see the applyBuff note in heroes/_base): a 1-tick disable is reaped this same
 * tick before any future validateAction sees it.
 */
function resolveInstantCastsPhase(
  state: GameState,
  validActions: PlayerAction[],
  players: Record<string, PlayerState>,
  zones: Record<string, ZoneRuntimeState>,
  waves: WaveUnitState[],
  ice: IceState[],
  neutrals: SiltDwellerState[],
  ancients: { chaff: AncientState; audit: AncientState },
  events: GameEngineEvent[],
  heroAttackers: Map<string, string>,
  rejected: Array<{ playerId: string; reason: string }>,
  damageTracker: Map<string, { hero: number; ice: number }>,
  waveKills: Array<{ playerId: string; waveId: string; waveType: 'line' | 'sweep' | 'breach' }>,
  neutralKills: Array<{ playerId: string; neutralId: string }>,
  findHero: (name: string) => string | null,
): {
  players: Record<string, PlayerState>
  zones: Record<string, ZoneRuntimeState>
  waves: WaveUnitState[]
  neutrals: SiltDwellerState[]
} {
  const instantCasts = validActions.filter(
    (a) =>
      a.command.type === 'cast' &&
      isInstantAbility(
        players[a.playerId]!,
        a.command as { type: 'cast'; ability: 'q' | 'w' | 'e' | 'r' },
      ),
  )
  for (const action of instantCasts) {
    const result = resolveHeroCast(
      state,
      players,
      zones,
      waves,
      ice,
      neutrals,
      ancients,
      action,
      events,
      heroAttackers,
      rejected,
      damageTracker,
      waveKills,
      neutralKills,
      findHero,
    )
    players = result.players
    zones = result.zones
    waves = result.waves
    neutrals = result.neutrals
  }
  return { players, zones, waves, neutrals }
}

/**
 * Phase 3a: Burns — allied waves below 50% INTEG. The burner gets reduced gold
 * + XP for denying (preventing the enemy from last-hitting).
 */
function resolveDenyPhase(
  tick: number,
  validActions: PlayerAction[],
  players: Record<string, PlayerState>,
  waves: WaveUnitState[],
  events: GameEngineEvent[],
): { players: Record<string, PlayerState>; waves: WaveUnitState[] } {
  const burns = validActions.filter((a) => a.command.type === 'burn')
  let playerUpdates: PlayerUpdates = {}

  for (const action of burns) {
    const cmd = action.command as { type: 'burn'; target: { kind: 'wave'; index: number } }
    const denier = players[action.playerId]
    if (!denier || !denier.alive) continue

    const resolved = waveInZoneByIndex(waves, denier.zone, cmd.target.index)
    if (!resolved) continue
    const { wave, globalIdx: waveIdx } = resolved
    if (wave.integ <= 0) continue

    if (wave.team !== denier.team) continue
    // Read the max the wave SPAWNED with. Waves escalate with match time, so
    // neither the level-1 constant (the window shrinks every minute until
    // denying is impossible) nor the current tick's tier (the window widens past
    // the threshold for any wave that outlived an escalation boundary) is
    // right. Fall back to the tick-0 base for fixtures that omit maxInteg.
    if (wave.integ > (wave.maxInteg ?? waveUnitMaxHp(wave.type, 0)) * BURN_HP_THRESHOLD) continue

    waves[waveIdx] = { ...wave, integ: 0 }

    const burnGold = Math.floor(((WAVE_GOLD_MIN + WAVE_GOLD_MAX) / 2) * BURN_GOLD_RATIO)
    playerUpdates[action.playerId] = {
      ...playerUpdates[action.playerId],
      gold: denier.gold + burnGold,
      xp: denier.xp + Math.floor(WAVE_XP * BURN_XP_RATIO),
    }

    events.push({
      _tag: 'wave_burn',
      tick,
      playerId: action.playerId,
      waveId: wave.id,
      waveType: wave.type,
      goldAwarded: burnGold,
    })
  }
  return { players: applyPlayerUpdates(players, playerUpdates), waves }
}

/**
 * Phase 3b: Attacks — hero/wave/ice/Tenant/neutral/Ancient, all simultaneous.
 * This is the largest phase (~440 lines): crit stacking, item on-hit effects
 * (MKB magic, Maelstrom chain, Skull Basher stun), plate mitigation (Desolator
 * shred, Assault Cuirass aura, Vanguard block), shield/phaseShift, Spite Plate
 * reflect, TP channeling cancel. Reads pending INTEG/buffs so simultaneous
 * focus-fire isn't last-write-wins.
 */
function resolveAttackPhase(
  state: GameState,
  attacks: PlayerAction[],
  players: Record<string, PlayerState>,
  waves: WaveUnitState[],
  ice: IceState[],
  neutrals: SiltDwellerState[],
  ancients: { chaff: AncientState; audit: AncientState },
  events: GameEngineEvent[],
  rejected: Array<{ playerId: string; reason: string }>,
  heroAttackers: Map<string, string>,
  damageTracker: Map<string, { hero: number; ice: number }>,
  waveKills: Array<{ playerId: string; waveId: string; waveType: 'line' | 'sweep' | 'breach' }>,
  neutralKills: Array<{ playerId: string; neutralId: string }>,
  iceKills: Array<{ zone: string; team: TeamId }>,
  findHeroByName: (name: string) => string | null,
  getCachedItemStats: (playerId: string, items: (string | null)[]) => ItemStats,
): {
  players: Record<string, PlayerState>
  waves: WaveUnitState[]
  ice: IceState[]
  neutrals: SiltDwellerState[]
  ancients: { chaff: AncientState; audit: AncientState }
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

  for (const action of attacks) {
    const cmd = action.command as { type: 'attack'; target: TargetRef }
    const attacker = players[action.playerId]
    if (!attacker || !attacker.alive) continue

    // One action per player per 4s tick: a mis-targeted attack that resolves to
    // nothing must SAY so, otherwise the tick is eaten in silence. Every exit
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
      if (cmd.target.kind === 'wave') return
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

      const targetPendingHp = (playerUpdates[targetId]?.integ as number | undefined) ?? target.integ
      const targetPendingBuffs =
        (playerUpdates[targetId]?.buffs as typeof target.buffs | undefined) ?? target.buffs

      const attackerItemStats = getCachedItemStats(action.playerId, attacker.items)
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
        if (Math.random() < best.chance) critMultiplier = best.multiplier
      }

      attackDamage = Math.round(attackDamage * critMultiplier)

      let bonusMagicDamage = 0
      if (attacker.items.includes('truestrike_rig')) {
        bonusMagicDamage = TRUESTRIKE_RIG_BONUS_DAMAGE
      }

      if (attacker.items.includes('arc_coil') && Math.random() < 0.25) {
        const chainTargets = Object.values(players).filter(
          (p) =>
            p.zone === attacker.zone && p.team !== attacker.team && p.alive && p.id !== target.id,
        )
        if (chainTargets.length > 0) {
          const chainTarget = chainTargets[Math.floor(Math.random() * chainTargets.length)]!
          const chainDamage = isDamageImmune(chainTarget, 'code')
            ? 0
            : Math.round(
                calculateCodeDamage(60, chainTarget.ice) *
                  getIncomingDamageMultiplier(chainTarget, 'code'),
              )
          if (chainDamage > 0) {
            const chainPendingHp =
              (playerUpdates[chainTarget.id]?.integ as number | undefined) ?? chainTarget.integ
            const chainNewHp = Math.max(0, chainPendingHp - chainDamage)
            playerUpdates[chainTarget.id] = {
              ...playerUpdates[chainTarget.id],
              integ: chainNewHp,
              alive: chainNewHp > 0,
            }
            events.push({
              _tag: 'damage',
              tick: state.tick,
              sourceId: action.playerId,
              targetId: chainTarget.id,
              amount: chainDamage,
              damageType: 'code',
            })
          }
        }
      }

      // Silver Edge: the +bonus is an empowered NEXT-attack-from-invis (like
      // every stealth in the engine), not a permanent every-attack buff. Only
      // apply it while invis is active, and consume BOTH the bonus and the invis
      // on the attack — which also correctly breaks stealth on attacking.
      const silverEdgeInvis = attacker.buffs.some((b) => b.id === 'ghostwire_edge_invis')
      const silverEdgeBonus = attacker.buffs.find((b) => b.id === 'ghostwire_edge_bonus')
      if (silverEdgeBonus && silverEdgeInvis) {
        attackDamage += silverEdgeBonus.stacks
      }
      if (silverEdgeInvis) {
        const attackerPendingBuffs =
          (playerUpdates[action.playerId]?.buffs as typeof attacker.buffs | undefined) ??
          attacker.buffs
        playerUpdates[action.playerId] = {
          ...playerUpdates[action.playerId],
          buffs: attackerPendingBuffs.filter(
            (b) => b.id !== 'ghostwire_edge_invis' && b.id !== 'ghostwire_edge_bonus',
          ),
        }
      }

      if (attacker.buffs.some((b) => b.id === 'stealth')) {
        attackDamage = Math.round(attackDamage * 1.5)
      }

      // R4-08: basic-attack damage type is per-hero (attackType). Kinetic is
      // mitigated by plate; code by ice. NPCs stay kinetic via CombatResolver.
      const attackType: DamageType =
        (attacker.heroId ? HEROES[attacker.heroId]?.attackType : undefined) ?? 'kinetic'

      let plate = getEffectivePlate(target, targetItemStats)
      let ice = getEffectiveIce(target, targetItemStats)

      if (attacker.items.includes('rust_driver')) {
        plate = Math.max(0, plate - RUST_DRIVER_PLATE_REDUCTION)
      }

      // Assault Cuirass aura: O(1) zone lookup instead of O(players) scan per attack.
      const cuirass = cuirassByZone.get(target.zone)
      if (cuirass) {
        // ally = target's team has a cuirass holder in zone → +armor
        // enemy = opposite team has a holder → -armor
        const allyCuirass = target.team === 'chaff' ? cuirass.ally : cuirass.enemy
        const enemyCuirass = target.team === 'chaff' ? cuirass.enemy : cuirass.ally
        if (allyCuirass) plate += SIEGE_LATTICE_AURA_PLATE
        if (enemyCuirass) plate = Math.max(0, plate - SIEGE_LATTICE_AURA_PLATE)
      }

      let blockedDamage = 0
      if (target.items.includes('bulwark_plate') && Math.random() < BULWARK_PLATE_BLOCK_CHANCE) {
        blockedDamage = BULWARK_PLATE_BLOCK_AMOUNT
      }

      let damage =
        attackType === 'code'
          ? calculateCodeDamage(attackDamage, ice)
          : calculateKineticDamage(attackDamage, plate)
      damage = Math.max(0, damage - blockedDamage)

      if (isDamageImmune(target, attackType)) {
        damage = 0
      } else {
        damage = Math.round(damage * getIncomingDamageMultiplier(target, attackType))
      }

      // A phaseShift dodge nullifies the whole hit — compute once and reuse so
      // no damage event, magic proc, tracking, or attacker credit is emitted for
      // a hit that deals 0 INTEG (mirrors the NPC path's damageDealt===0 skip).
      const dodged = targetPendingBuffs.some((b) => b.id === 'phaseShift')

      let totalDamage = damage
      if (bonusMagicDamage > 0 && !isDamageImmune(target, 'code') && !dodged) {
        const rawMagic = calculateCodeDamage(
          bonusMagicDamage,
          getEffectiveIce(target, targetItemStats),
        )
        const magicDmg = Math.round(rawMagic * getIncomingDamageMultiplier(target, 'code'))
        totalDamage += magicDmg
        events.push({
          _tag: 'damage',
          tick: state.tick,
          sourceId: action.playerId,
          targetId,
          amount: magicDmg,
          damageType: 'code',
        })
      }

      if (targetPendingBuffs.some((b) => b.id === 'hardened')) {
        totalDamage = Math.round(totalDamage * 0.9)
      }

      let newBuffs = [...targetPendingBuffs]
      let hpLoss = totalDamage
      if (dodged) {
        hpLoss = 0
        newBuffs = newBuffs.filter((b) => b.id !== 'phaseShift')
      } else {
        const absorbed = absorbShield(newBuffs, totalDamage)
        newBuffs = [...absorbed.buffs]
        hpLoss = absorbed.remaining
      }

      const newInteg = Math.max(0, targetPendingHp - hpLoss)

      if (attacker.items.includes('concussion_hammer') && Math.random() < 0.25) {
        // ticksRemaining 2 = one gated action: reaped same-tick by tickAllBuffs
        // (see the applyBuff note), so 1 would never reach the next validateAction.
        newBuffs.push({ id: 'stun', stacks: 1, ticksRemaining: 2, source: attacker.id })
        // Emitted here rather than by a buff diff: the attack phase stages its
        // changes in playerUpdates/pendingBuffs, so there is no post state to
        // diff against until the whole phase has been folded in.
        events.push({
          _tag: 'status_applied',
          tick: state.tick,
          sourceId: action.playerId,
          targetId,
          status: 'stun',
          ticksRemaining: 2,
        })
      }

      if (newBuffs.some((b) => b.id === 'tp_channeling')) {
        newBuffs = newBuffs.filter((b) => b.id !== 'tp_channeling' && b.id !== 'tp_destination')
        events.push({
          _tag: 'teleport_cancelled',
          tick: state.tick,
          playerId: targetId,
          reason: 'damage',
        })
      }

      if (target.buffs.some((b) => b.id === 'spite_plate')) {
        const returnDamage = computeSpitePlateReflect(hpLoss)
        const attackerPendingHp =
          (playerUpdates[action.playerId]?.integ as number | undefined) ?? attacker.integ
        const attackerNewHp = Math.max(0, attackerPendingHp - returnDamage)
        playerUpdates[action.playerId] = {
          ...playerUpdates[action.playerId],
          integ: attackerNewHp,
          alive: attackerNewHp > 0,
        }
        events.push({
          _tag: 'damage',
          tick: state.tick,
          sourceId: targetId,
          targetId: action.playerId,
          amount: returnDamage,
          damageType: 'black',
        })
      }

      playerUpdates[targetId] = {
        ...playerUpdates[targetId],
        integ: newInteg,
        alive: newInteg > 0,
        buffs: newBuffs,
      }
      holdTarget()

      if (!dodged) {
        heroAttackers.set(action.playerId, targetId)

        const dt = damageTracker.get(action.playerId) ?? { hero: 0, ice: 0 }
        dt.hero += damage
        damageTracker.set(action.playerId, dt)

        events.push({
          _tag: 'damage',
          tick: state.tick,
          sourceId: action.playerId,
          targetId,
          amount: damage,
          damageType: attackType,
        })
      }
    } else if (cmd.target.kind === 'wave') {
      const resolved = waveInZoneByIndex(waves, attacker.zone, cmd.target.index)
      if (!resolved) {
        // Count the same index space waveInZoneByIndex walks (every wave in
        // the zone, dead-but-unreaped included) so the quoted range is the one
        // the player can actually type this tick.
        const wavesInZone = waves.filter((c) => c.zone === attacker.zone).length
        miss(
          wavesInZone === 0
            ? 'No waves in this zone to attack'
            : wavesInZone === 1
              ? 'Only 1 wave here — use wave:0'
              : `Only ${wavesInZone} waves here — use wave:0-${wavesInZone - 1}`,
        )
        continue
      }
      const { wave, globalIdx: waveIdx } = resolved
      if (wave.integ <= 0) {
        miss('That wave is already dead')
        continue
      }
      // Without this guard an own-wave swing paid the FULL last-hit bounty,
      // teaching the exact opposite of last-hitting. Killing your own wave is
      // the `burn` command, which has its own INTEG window and reduced reward.
      if (wave.team === attacker.team) {
        miss('That is your own wave — use `burn` instead')
        continue
      }

      const attackerItemStats = getCachedItemStats(action.playerId, attacker.items)
      const attackDamage = getEffectiveAttack(attacker, attackerItemStats)
      const newInteg = Math.max(0, wave.integ - attackDamage)

      waves[waveIdx] = { ...wave, integ: newInteg }
      holdTarget()

      if (newInteg <= 0) {
        waveKills.push({ playerId: action.playerId, waveId: wave.id, waveType: wave.type })
      }

      events.push({
        _tag: 'damage',
        tick: state.tick,
        sourceId: action.playerId,
        targetId: wave.id,
        amount: attackDamage,
        damageType: 'kinetic',
      })
    } else if (cmd.target.kind === 'ice') {
      const targetZone = cmd.target.zone
      let iceTarget = ice.find((t) => t.zone === targetZone && t.alive)
      if (!iceTarget) {
        miss(`No standing ice in ${targetZone}`)
        continue
      }
      if (iceTarget.zone !== attacker.zone) {
        miss('Target is not in your zone')
        continue
      }
      if (iceTarget.invulnerable) {
        events.push({
          _tag: 'ice_invulnerable',
          tick: state.tick,
          zone: iceTarget.zone,
        })
        continue
      }
      if (!canAttackIce(ice, targetZone)) {
        miss('That ice is protected — destroy the one in front of it first')
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
        tick: state.tick,
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
        tick: state.tick,
        sourceId: action.playerId,
        targetId: 'tenant',
        amount: attackDamage,
        damageType: 'kinetic',
      })
    } else if (cmd.target.kind === 'neutral') {
      const neutralIdx = cmd.target.index
      const neutral = neutrals[neutralIdx]
      if (!neutral) {
        miss('No neutral wave at that index')
        continue
      }
      if (!neutral.alive) {
        miss('That neutral is already dead')
        continue
      }
      if (neutral.zone !== attacker.zone) {
        miss('Target is not in your zone')
        continue
      }

      const attackerItemStats = getCachedItemStats(action.playerId, attacker.items)
      const attackDamage = getEffectiveAttack(attacker, attackerItemStats)
      const newInteg = Math.max(0, neutral.integ - attackDamage)

      neutrals[neutralIdx] = { ...neutral, integ: newInteg, alive: newInteg > 0 }
      holdTarget()

      if (newInteg <= 0) {
        neutralKills.push({ playerId: action.playerId, neutralId: neutral.id })
      }

      events.push({
        _tag: 'damage',
        tick: state.tick,
        sourceId: action.playerId,
        targetId: neutral.id,
        amount: attackDamage,
        damageType: 'kinetic',
      })
    } else if (cmd.target.kind === 'ancient') {
      const enemyTeam: TeamId = attacker.team === 'chaff' ? 'audit' : 'chaff'
      if (attacker.zone !== ANCIENT_ZONES[enemyTeam]) {
        miss('You must be in the enemy base to attack the Ancient')
        continue
      }

      const attackerItemStats = getCachedItemStats(action.playerId, attacker.items)
      const attackDamage = getEffectiveAttack(attacker, attackerItemStats)

      const result = resolveAncientAttack(
        { ...state, players, waves, ice, ancients },
        action.playerId,
        attackDamage,
      )
      if (result.rejected) {
        wsLog.debug('Ancient attack rejected', {
          playerId: action.playerId,
          reason: result.rejected,
        })
        miss(result.rejected)
        continue
      }

      ancients = result.state.ancients
      events.push(...result.events)
      holdTarget()

      const adt = damageTracker.get(action.playerId) ?? { hero: 0, ice: 0 }
      adt.ice += attackDamage
      damageTracker.set(action.playerId, adt)
    } else {
      // TargetRef also carries 'zone' and 'self', which the wire schema accepts
      // for an attack but no branch above handles — without this they fall off
      // the end of the chain and eat the tick in silence.
      miss(`You cannot attack a ${cmd.target.kind}`)
    }
  }

  return {
    players: applyPlayerUpdates(players, playerUpdates),
    waves,
    ice,
    neutrals,
    ancients,
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
            ticksRemaining: LINKENS_RECHARGE_TICKS,
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
        tick: state.tick,
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
        tick: state.tick,
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
 * can land in the same 4s tick. The ORDER is the whole point: blink → stun →
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
  ancients: { chaff: AncientState; audit: AncientState },
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
    const tempState: GameState = { ...state, players, zones, waves, ice, ancients }
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
        tick: state.tick,
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
          state.tick,
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
            tick: state.tick,
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
                  tick: state.tick,
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
            tick: state.tick,
            sourceId: action.playerId,
            targetId: pid,
            amount: -delta,
          })
        }
      }

      // Hex (Lockout Shunt) and Cyclone (Stasis Shunt) are pure disables with no HP
      // delta — without this diff they landed completely silently.
      emitStatusApplied(prePlayers, players, action.playerId, state.tick, events)
    }
  }

  return { players, zones }
}

/**
 * Post-shop phases: harden, backup/cache pickup, maxInteg/maxBw recalc, gold/XP
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
  _rejected: Array<{ playerId: string; reason: string }>,
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

  // Breach commands — open (or self-flush) the access window.
  const breachActions = validActions.filter((a) => a.command.type === 'breach')
  for (const action of breachActions) {
    const caster = players[action.playerId]
    if (!caster || action.command.type !== 'breach') continue
    const cmd = action.command

    if (cmd.target.kind === 'self') {
      if (!isBreached(caster) || caster.bw < BREACH_BW_COST) continue
      let updated = {
        ...caster,
        bw: Math.max(0, caster.bw - BREACH_BW_COST),
        buffs: caster.buffs.filter((b) => b.id !== 'breached'),
      }
      players = { ...players, [action.playerId]: updated }
      events.push({
        _tag: 'breach_opened',
        tick: state.tick,
        playerId: action.playerId,
        targetId: action.playerId,
        durationTicks: 0, // flush
      })
      continue
    }

    if (cmd.target.kind !== 'hero') continue
    const target = findTargetPlayer({ ...state, players }, cmd.target)
    if (!target || target.team === caster.team || !target.alive || target.zone !== caster.zone)
      continue
    if (hasBuff(target, 'airgap') || caster.bw < BREACH_BW_COST) continue
    if (caster.buffs.some((b) => b.id === 'item_cd_breach' && b.ticksRemaining > 0)) continue

    let nextCaster = {
      ...caster,
      bw: Math.max(0, caster.bw - BREACH_BW_COST),
    }
    nextCaster = applyBuff(nextCaster, {
      id: 'item_cd_breach',
      stacks: 1,
      ticksRemaining: BREACH_COOLDOWN_TICKS,
      source: caster.id,
    })
    let nextTarget = applyBuff(target, {
      id: 'breached',
      stacks: 1,
      ticksRemaining: BREACH_DURATION_TICKS,
      source: caster.id,
    })
    players = {
      ...players,
      [action.playerId]: nextCaster,
      [target.id]: nextTarget,
    }
    events.push({
      _tag: 'breach_opened',
      tick: state.tick,
      playerId: action.playerId,
      targetId: target.id,
      durationTicks: BREACH_DURATION_TICKS,
    })
  }

  // Harden commands
  const glyphActions = validActions.filter((a) => a.command.type === 'harden')
  for (const action of glyphActions) {
    const player = players[action.playerId]
    if (!player) continue
    const team = player.team
    const teamState = teams[team]
    if (teamState.hardenUsedTick !== null) {
      const ticksSinceUse = state.tick - teamState.hardenUsedTick
      if (ticksSinceUse < HARDEN_COOLDOWN_TICKS) {
        events.push({
          _tag: 'harden_on_cooldown',
          tick: state.tick,
          playerId: action.playerId,
          remainingTicks: HARDEN_COOLDOWN_TICKS - ticksSinceUse,
        })
        continue
      }
    }
    ice = ice.map((t) => (t.team === team ? { ...t, invulnerable: true } : t))
    teams = { ...teams, [team]: { ...teamState, hardenUsedTick: state.tick } }
    events.push({ _tag: 'harden_used', tick: state.tick, team })
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

  // Wave last-hit gold + XP
  for (const kill of waveKills) {
    const tempState: GameState = { ...state, players, waves, ice }
    const goldBefore = players[kill.playerId]?.gold ?? 0
    const awarded = awardLastHit(tempState, kill.playerId, kill.waveType)
    players = { ...awarded.players }
    const killer = players[kill.playerId]
    if (killer) {
      players = { ...players, [kill.playerId]: { ...killer, xp: killer.xp + WAVE_XP } }
      // The reward line the feed shows ("last-hit +38g") — this event existed in
      // the protocol but was never emitted, so the player's own farming was the
      // one thing the combat log stayed silent about.
      events.push({
        _tag: 'wave_strip',
        tick: state.tick,
        playerId: kill.playerId,
        waveId: kill.waveId,
        waveType: kill.waveType,
        goldAwarded: killer.gold - goldBefore,
      })
      // Lane-mates standing here share a fraction. XP used to come exclusively
      // from last-hits, so a laner who mistimed their attacks earned literally
      // nothing and fell five levels behind. The last-hitter still keeps the
      // full WAVE_XP above, so timing is rewarded — presence just stops being
      // worth zero. The mirror of this for wave-on-wave deaths lives in
      // WaveAI, and that is the path most waves actually die on.
      players = awardZoneXp(players, killer.zone, killer.team, WAVE_XP_SHARED, kill.playerId)
    }
  }

  // Neutral kill gold + XP
  for (const kill of neutralKills) {
    const neutral = neutrals.find((n) => n.id === kill.neutralId)
    if (!neutral) continue
    const stats = SILT_DWELLERS[neutral.type as SiltDwellerType]
    if (!stats) continue
    const killer = players[kill.playerId]
    if (killer) {
      players = {
        ...players,
        [kill.playerId]: { ...killer, gold: killer.gold + stats.gold, xp: killer.xp + stats.xp },
      }
      events.push({
        _tag: 'neutral_killed' as const,
        tick: state.tick,
        playerId: kill.playerId,
        neutralId: neutral.id,
        neutralType: neutral.type,
        zone: neutral.zone,
      })
    }
    neutrals = neutrals.filter((n) => n.id !== kill.neutralId)
  }

  // Ice kill gold
  for (const kill of iceKills) {
    const nearbyAllies = Object.entries(players)
      .filter(([, p]) => p.zone === kill.zone && p.team !== kill.team && p.alive)
      .map(([id]) => id)
    const tempState: GameState = { ...state, players, waves, ice }
    const awarded = awardIceKill(tempState, kill.zone, nearbyAllies)
    // Read the payout back off the diff rather than recomputing the split — the
    // event can then never disagree with what the player's gold actually did.
    for (const id of nearbyAllies) {
      const gained = (awarded.players[id]?.gold ?? 0) - (players[id]?.gold ?? 0)
      if (gained > 0) {
        events.push({
          _tag: 'gold_change',
          tick: state.tick,
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
  const wardActions = validActions.filter((a) => a.command.type === 'ward')
  for (const action of wardActions) {
    const cmd = action.command as { type: 'ward'; zone: string }
    const player = players[action.playerId]
    if (player) {
      const wardSlot = player.items.findIndex((i) => i === 'camtap' || i === 'sniffer')
      if (wardSlot === -1) continue
      const wardType = player.items[wardSlot] === 'sniffer' ? 'sniffer' : 'camtap'
      const placed = placeWard(zones, cmd.zone, player.team, state.tick, wardType)
      if (placed) {
        const newItems = [...player.items]
        newItems[wardSlot] = null
        players = { ...players, [action.playerId]: { ...player, items: newItems } }
        events.push({
          _tag: 'ward_placed',
          tick: state.tick,
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
): Effect.Effect<{
  state: GameState
  events: GameEngineEvent[]
  heroAttackers: Map<string, string>
  /** Actions that failed inside resolution (mana, bad target, slow-cancel). */
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
    // pre-tick zones, so it reads a hero attacking into the zone they are about
    // to blink to as an attack on an "invisible" hero and drops it: exactly the
    // item→attack combo the item slot exists to enable. The attack phase's own
    // zone check still rejects a genuinely out-of-zone swing, with a message
    // rather than in silence.
    const repositioning = new Set(
      actions.filter((a) => a.command.type === 'use').map((a) => a.playerId),
    )
    let validActions = actions.filter((a) => {
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
          return false
        }
      }

      return true
    })

    let players = { ...state.players }
    const events: GameEngineEvent[] = []
    const heroAttackers = new Map<string, string>()
    const rejected: Array<{ playerId: string; reason: string }> = []
    let zones = { ...state.zones }
    let ancients = state.ancients
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
    // ability cast in the same tick rather than after it.
    {
      const result = resolveItemActivesPhase(
        state,
        validActions,
        players,
        zones,
        waves,
        ice,
        ancients,
        events,
        rejected,
        heroAttackers,
        damageTracker,
      )
      players = result.players
      zones = result.zones
    }

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
        ancients,
        events,
        heroAttackers,
        rejected,
        damageTracker,
        waveKills,
        neutralKills,
        findHeroByNameCached,
      )
      players = result.players
      zones = result.zones
      waves = result.waves
      neutrals = result.neutrals
    }

    // Phase 2: Movement — all moves resolve simultaneously
    {
      const result = resolveMovementPhase(
        state.tick,
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
      const result = resolveDenyPhase(state.tick, validActions, players, waves, events)
      players = result.players
      waves = result.waves
    }

    const attacks = validActions.filter((a) => a.command.type === 'attack')
    const targetedCasts = validActions.filter(
      (a) =>
        a.command.type === 'cast' &&
        !isInstantAbility(
          players[a.playerId]!,
          a.command as { type: 'cast'; ability: 'q' | 'w' | 'e' | 'r' },
        ),
    )

    {
      const result = resolveAttackPhase(
        state,
        attacks,
        players,
        waves,
        ice,
        neutrals,
        ancients,
        events,
        rejected,
        heroAttackers,
        damageTracker,
        waveKills,
        neutralKills,
        iceKills,
        findHeroByNameCached,
        getCachedItemStats,
      )
      players = result.players
      waves = result.waves
      ice = result.ice
      neutrals = result.neutrals
      ancients = result.ancients
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
        ancients,
        action,
        events,
        heroAttackers,
        rejected,
        damageTracker,
        waveKills,
        neutralKills,
        findHeroByNameCached,
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
      ancients,
      backup: backupGround,
      caches: cachesGround,
    }

    return { state: updatedState, events, heroAttackers, rejected }
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
  tick: number,
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
        ? [{ ...b, stacks: 0, ticksRemaining: LINKENS_RECHARGE_TICKS }]
        : []
    })
    events.push({
      _tag: 'spell_blocked',
      tick,
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
        tick,
        sourceId: targetId,
        targetId: casterId,
        amount: reflected,
        damageType,
      })
    }
    events.push({
      _tag: 'spell_blocked',
      tick,
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
 * pre/post INTEG. Resolver failures (mana, target, cooldown) are surfaced via
 * the `rejected` channel instead of being silently dropped.
 *
 * The bridge must NOT deduct mana or set cooldowns itself — the hero
 * resolvers own scaled per-level costs and cooldowns.
 */
function resolveHeroCast(
  state: GameState,
  players: Record<string, PlayerState>,
  zones: GameState['zones'],
  waves: WaveUnitState[],
  ice: GameState['ice'],
  neutrals: SiltDwellerState[],
  ancients: GameState['ancients'],
  action: PlayerAction,
  events: GameEngineEvent[],
  heroAttackers: Map<string, string>,
  rejected: Array<{ playerId: string; reason: string }>,
  damageTracker: Map<string, { hero: number; ice: number }>,
  waveKills: Array<{ playerId: string; waveId: string; waveType: 'line' | 'sweep' | 'breach' }>,
  neutralKills: Array<{ playerId: string; neutralId: string }>,
  findHero: (name: string) => string | null,
): {
  players: Record<string, PlayerState>
  zones: GameState['zones']
  waves: WaveUnitState[]
  neutrals: SiltDwellerState[]
} {
  const cmd = action.command as { type: 'cast'; ability: AbilitySlot; target?: TargetRef }
  const caster = players[action.playerId]
  if (!caster?.heroId) return { players, zones, waves, neutrals }

  // Tier-25 exotic — global ultimate: the talented R can hit a hero in ANY zone.
  // The per-hero resolvers enforce a same-zone check, so we satisfy it by
  // temporarily placing the caster in the target's zone for the resolver call,
  // then restore the caster's real zone on the way out (the caster never moves).
  const isGlobalUlt =
    cmd.ability === 'r' &&
    cmd.target?.kind === 'hero' &&
    hasTalentCastEffect(caster, 'global_ultimate', 'r')
  const realCasterZone = caster.zone
  let castPlayers = players
  if (isGlobalUlt && cmd.target?.kind === 'hero') {
    const targetId = findHero(cmd.target.name)
    const targetZone = targetId ? players[targetId]?.zone : undefined
    if (targetZone && targetZone !== caster.zone) {
      castPlayers = { ...players, [action.playerId]: { ...caster, zone: targetZone } }
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
    ancients,
  }
  // Effect.either keeps AbilityError failures as values — an uncaught defect
  // here would abort the entire tick (GameLoop recovers but loses actions).
  const result = Effect.runSync(
    Effect.either(resolveAbility(tempState, action.playerId, cmd.ability, cmd.target)),
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
      reason = `${abilityName} on cooldown — ${cd} tick${cd === 1 ? '' : 's'} left (ready T${state.tick + cd})`
    } else {
      reason = err.reason
    }
    rejected.push({ playerId: action.playerId, reason })
    return { players, zones, waves, neutrals }
  }

  const newState = result.right.state
  let newPlayers = newState.players
  // Restore the caster's real zone after a global ult — the resolver only saw
  // them in the target's zone to pass the same-zone check; they never moved.
  if (isGlobalUlt && newPlayers[action.playerId]) {
    const restored: PlayerState = { ...newPlayers[action.playerId]!, zone: realCasterZone }
    newPlayers = { ...newPlayers, [action.playerId]: restored }
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
  // hero holding a charge fizzles — the caster still pays mana + cooldown, but
  // the target's effect is reverted and a charge consumed (shared with the
  // targeted-item-active path so Burnout/Scythe/Ethereal/Stasis Shunt block identically).
  if (targetId && abilityDef?.targetType === 'hero') {
    newPlayers = applyTargetedSpellBlock(
      newPlayers,
      players,
      targetId,
      action.playerId,
      damageType,
      state.tick,
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
  for (const [pid, post] of Object.entries(newPlayers)) {
    const pre = players[pid]
    if (!pre) continue
    let delta = pre.integ - post.integ
    if (delta > 0 && hasOverclock && post.team !== caster.team) {
      const doubledHp = Math.max(0, post.integ - delta)
      newPlayers = { ...newPlayers, [pid]: { ...post, integ: doubledHp, alive: doubledHp > 0 } }
      delta *= 2
    }
    if (delta > 0) {
      events.push({
        _tag: 'damage',
        tick: state.tick,
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
              tick: state.tick,
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
        tick: state.tick,
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
    state.tick,
    action.playerId,
    damageType,
    waves,
    newState.waves,
    events,
    waveKills,
  )
  let castNeutrals = collectNeutralCastDamage(
    state.tick,
    action.playerId,
    damageType,
    neutrals,
    newState.neutrals,
    events,
    neutralKills,
  )

  // Tier-25 exotic — double cast: a chance for the talented ability to fire a
  // second time. Re-runs the hero resolver on the post-first-cast state with the
  // just-set cooldown cleared (so the echo isn't rejected); mana is paid again,
  // so the echo only happens if the caster can afford both casts. Emits plain
  // damage/heal events from the echo's INTEG diff (no Spite Plate/Overclock recursion
  // on the echo — deliberately simple).
  if (
    hasTalentCastEffect(caster, 'double_cast', cmd.ability) &&
    Math.random() < DOUBLE_CAST_CHANCE
  ) {
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
        ancients,
      }
      const echoResult = Effect.runSync(
        Effect.either(resolveAbility(echoState, action.playerId, cmd.ability, cmd.target)),
      )
      if (Either.isRight(echoResult)) {
        const echoNewPlayers = echoResult.right.state.players
        // Feedback: announce the proc so the player knows the ability fired twice.
        events.push({
          _tag: 'double_cast',
          tick: state.tick,
          playerId: action.playerId,
          abilityId: abilityDef?.id ?? cmd.ability,
        })
        for (const [pid, post] of Object.entries(echoNewPlayers)) {
          const pre = echoPlayers[pid]
          if (!pre) continue
          const delta = pre.integ - post.integ
          if (delta > 0) {
            events.push({
              _tag: 'damage',
              tick: state.tick,
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
              tick: state.tick,
              sourceId: action.playerId,
              targetId: pid,
              amount: -delta,
            })
          }
        }
        castWaves = collectNpcCastDamage(
          state.tick,
          action.playerId,
          damageType,
          castWaves,
          echoResult.right.state.waves,
          events,
          waveKills,
        )
        castNeutrals = collectNeutralCastDamage(
          state.tick,
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
          tick: state.tick,
          sourceId: action.playerId,
          targetId: action.playerId,
          amount: healAmount,
        })
      }
    }
  }

  // Crowd control the resolvers applied (root riders, AoE stuns, hexes) —
  // recovered from the buff diff, since result.right.events are discarded.
  emitStatusApplied(players, newPlayers, action.playerId, state.tick, events)

  // result.right.events are wire-format 'ability_cast' events the client
  // doesn't understand — discard them; ability_used/cooldown_used below
  // carry the resolver-set cooldown (the authoritative value).
  const actualCd = newPlayers[action.playerId]?.cooldowns[cmd.ability] ?? 0

  events.splice(castEvtIdx, 0, {
    _tag: 'ability_used',
    tick: state.tick,
    playerId: action.playerId,
    abilityId: abilityDef?.id ?? cmd.ability,
    targetId,
    cooldown: actualCd,
  })
  events.push({
    _tag: 'cooldown_used',
    tick: state.tick,
    playerId: action.playerId,
    abilityId: cmd.ability,
    cooldownTicks: actualCd,
    readyAtTick: state.tick + actualCd,
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
  tick: number,
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
      tick,
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
 *  kill feeds the `neutralKills` path that pays the camp's gold + XP. */
function collectNeutralCastDamage(
  tick: number,
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
      tick,
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
