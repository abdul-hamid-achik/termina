import { Effect, Either } from 'effect'
import type {
  CreepState,
  GameState,
  PlayerState,
  TeamId,
  TeamState,
  TowerState,
  AncientState,
  ZoneRuntimeState,
  NeutralCreepState,
  RuneState,
} from '~~/shared/types/game'
import type { Command, TargetRef } from '~~/shared/types/commands'
import {
  resolveAbility,
  getAbilityLevel,
  absorbShield,
  type AbilitySlot,
} from '~~/server/game/heroes'
import {
  getEffectiveAttack,
  getEffectiveDefense,
  getEffectiveMagicResist,
  getAttackMultiplier,
  getTalentStatBonus,
  getItemStatBonuses,
} from './EffectiveStats'
import { areAdjacent } from '~~/server/game/map/topology'
import { isCommandAllowedInTutorial, tutorialLockMessage } from '~~/server/game/modes/tutorial'
import { ZONE_MAP } from '~~/shared/constants/zones'
import {
  calculatePhysicalDamage,
  calculateMagicalDamage,
  getIncomingDamageMultiplier,
  isDamageImmune,
} from './DamageCalculator'
import { computeBladeMailReflect } from './CombatResolver'
import { placeWard, canAttackTower } from '~~/server/game/map/zones'
import { HEROES } from '~~/shared/constants/heroes'
import type { GameEngineEvent } from '~~/server/game/protocol/events'
import { buyItem, sellItem, useItem } from '~~/server/game/items/shop'
import { awardLastHit, awardTowerKill } from './GoldDistributor'
import { pickupAegis } from './RoshanAI'
import { pickupRune } from './RuneAI'
import { resolveAncientAttack, ANCIENT_ZONES } from './AncientSystem'
import { ITEMS } from '~~/shared/constants/items'
import {
  CREEP_XP,
  NEUTRAL_CREEPS,
  type NeutralCreepType,
  CREEP_GOLD_MIN,
  CREEP_GOLD_MAX,
  MELEE_CREEP_HP,
  RANGED_CREEP_HP,
  SIEGE_CREEP_HP,
  GLYPH_COOLDOWN_TICKS,
  DENY_HP_THRESHOLD,
  DENY_GOLD_RATIO,
  DENY_XP_RATIO,
  NULL_POINTER_CRIT_CHANCE,
  NULL_POINTER_CRIT_MULTIPLIER,
  CRYSTALYS_CRIT_CHANCE,
  CRYSTALYS_CRIT_MULTIPLIER,
  DAEDALUS_CRIT_CHANCE,
  DAEDALUS_CRIT_MULTIPLIER,
  VANGUARD_BLOCK_CHANCE,
  VANGUARD_BLOCK_AMOUNT,
  DESOLATOR_ARMOR_REDUCTION,
  ASSAULT_CUIRASS_AURA_DEFENSE,
  MKB_BONUS_DAMAGE,
  RING_OF_HEALTH_REGEN_PERCENT,
  SOBI_MASK_REGEN_PERCENT,
  HEART_REGEN_PERCENT,
  SELL_REFUND_RATIO,
} from '~~/shared/constants/balance'
import type { ItemStats } from '~~/shared/types/items'
import { runAntiCheatChecks, type CheatDetection } from '~~/server/utils/AntiCheat'
import { wsLog } from '~~/server/utils/log'
import { isRealProduction } from '~~/server/utils/testHooks'

/** Ticks before Linken's Sphere recharges its spell-block after spending one. */
const LINKENS_RECHARGE_TICKS = 12

// ── Types ──────────────────────────────────────────────────────

export interface PlayerAction {
  playerId: string
  command: Command
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
 * Resolve a zone-local creep index to the creep and its global array index.
 * Clients (zone panel, autocomplete) count creeps within the player's zone —
 * the global creeps array is vision-filtered before broadcast, so global
 * indices mean different things on each side. Filtering preserves order, so
 * "Nth creep in this zone" is identical for client and server.
 */
function creepInZoneByIndex(
  creeps: CreepState[],
  zone: string,
  index: number,
): { creep: CreepState; globalIdx: number } | null {
  let seen = 0
  for (let i = 0; i < creeps.length; i++) {
    const c = creeps[i]!
    if (c.zone !== zone) continue
    if (seen === index) return { creep: c, globalIdx: i }
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
  // Eul's Cyclone lifts the target into a tornado — fully disabled (and
  // invulnerable, enforced in the damage paths) until it expires.
  if (hasDebuff(player, 'cyclone')) return 'Cannot act while cycloned'

  // Scythe of Vyse Hex is a hard disable — no move, attack, OR cast. (The
  // co-applied 'silence' only gates casting, so without this a hexed hero could
  // still basic-attack.)
  if (hasDebuff(player, 'hex')) return 'Cannot act while hexed'

  // Black King Bar (magic_immune) grants debuff immunity ("immune to ... debuffs"):
  // a BKB-active hero acts through the standard control debuffs — stun, silence,
  // root, fear, taunt. Cyclone and Hex are hard disables that pierce it (checked
  // above), matching the usual convention.
  const debuffImmune = player.buffs.some((b) => b.id === 'magic_immune')

  const cmd = action.command

  // Tutorial mode gates commands behind staggered unlocks so a new player learns
  // one verb at a time. Informational commands always pass; everything else must
  // be unlocked by the current step (the gate is a no-op in normal games).
  if (state.mode === 'tutorial' && !isCommandAllowedInTutorial(cmd.type, state.tutorialStep ?? 0)) {
    return tutorialLockMessage(state.tutorialStep ?? 0)
  }

  switch (cmd.type) {
    case 'move': {
      // Reachable = your current zone, or an adjacent zone that's actually part
      // of THIS game's map. The adjacency cache is the full graph, so subset maps
      // (one-lane) must also gate on the game's live zone set, else a player could
      // step out of the map into an uninitialized zone.
      const reachable =
        player.zone === cmd.zone || (areAdjacent(player.zone, cmd.zone) && !!state.zones[cmd.zone])
      if (!reachable) {
        return 'Cannot move to non-adjacent zone'
      }
      // Check for root/stun (taunt forces attacking — no fleeing). BKB bypasses.
      if (!debuffImmune && (hasDebuff(player, 'root') || hasDebuff(player, 'stun'))) {
        return 'Cannot move while rooted or stunned'
      }
      if (!debuffImmune && hasDebuff(player, 'taunt')) return 'Cannot move while taunted'
      return null
    }
    case 'attack': {
      if (!debuffImmune && hasDebuff(player, 'stun')) return 'Cannot attack while stunned'
      if (!debuffImmune && hasDebuff(player, 'feared')) return 'Cannot attack while feared'
      // Ghost Scepter: phased out — immune to physical damage, but cannot attack.
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
      // No mana check here — per-hero scaled costs live in the resolver files;
      // the resolver's InsufficientManaError is authoritative and surfaced
      // through resolveActions' rejected channel.
      return null
    }
    case 'buy': {
      const zone = ZONE_MAP[player.zone]
      if (!zone?.shop) return 'Not in a shop zone'
      return null
    }
    case 'sell': {
      const sellZone = ZONE_MAP[player.zone]
      if (!sellZone?.shop) return 'Not in a shop zone'
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
    case 'aegis':
    case 'rune':
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
    case 'deny':
      if (cmd.target.kind !== 'creep') {
        return 'Can only deny creeps'
      }
      return null
    case 'select_talent':
      return null
    case 'glyph':
      return null
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

// ── Resolution Pipeline ────────────────────────────────────────

/**
 * Resolve all player actions for a tick.
 *
 * Priority-ordered resolution:
 * Phase 1: Instant abilities (stuns, silences) — resolve simultaneously
 * Phase 2: Movement — all moves resolve at once
 * Phase 3: Attacks + targeted abilities — simultaneous
 * Phase 4: Passive effects, DoTs, regen, cooldown ticks
 *
 * Within each phase, all actions resolve simultaneously.
 */
// ── Phase functions (extracted from resolveActions for readability) ───

/**
 * Phase 2: Movement — all moves resolve simultaneously.
 * Slow has a % chance to cancel the move; Haste rune ignores slow.
 * Moving cancels TP channeling.
 */
function resolveMovementPhase(
  tick: number,
  validActions: PlayerAction[],
  players: Record<string, PlayerState>,
  events: GameEngineEvent[],
  rejected: Array<{ playerId: string; reason: string }>,
): { players: Record<string, PlayerState> } {
  const moves = validActions.filter((a) => a.command.type === 'move')
  let playerUpdates: PlayerUpdates = {}

  for (const action of moves) {
    const cmd = action.command as { type: 'move'; zone: string }
    const player = players[action.playerId]
    if (player && player.alive) {
      const hasted = player.buffs.some((b) => b.id === 'haste')
      const totalSlow = Math.min(
        80,
        player.buffs
          .filter((b) => b.id === 'slow' || b.id === 'broadcast_slow')
          .reduce((sum, b) => sum + b.stacks, 0),
      )
      if (!hasted && totalSlow > 0 && Math.random() * 100 < totalSlow) {
        rejected.push({ playerId: action.playerId, reason: 'Slowed — failed to move' })
        continue
      }

      const updates: Partial<PlayerState> = { zone: cmd.zone }

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
  creeps: CreepState[],
  towers: TowerState[],
  ancients: { radiant: AncientState; dire: AncientState },
  events: GameEngineEvent[],
  heroAttackers: Map<string, string>,
  rejected: Array<{ playerId: string; reason: string }>,
  damageTracker: Map<string, { hero: number; tower: number }>,
  findHero: (name: string) => string | null,
): { players: Record<string, PlayerState>; zones: Record<string, ZoneRuntimeState> } {
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
      creeps,
      towers,
      ancients,
      action,
      events,
      heroAttackers,
      rejected,
      damageTracker,
      findHero,
    )
    players = result.players
    zones = result.zones
  }
  return { players, zones }
}

/**
 * Phase 3a: Denies — allied creeps below 50% HP. The denier gets reduced gold
 * + XP for denying (preventing the enemy from last-hitting).
 */
function resolveDenyPhase(
  tick: number,
  validActions: PlayerAction[],
  players: Record<string, PlayerState>,
  creeps: CreepState[],
  events: GameEngineEvent[],
): { players: Record<string, PlayerState>; creeps: CreepState[] } {
  const denies = validActions.filter((a) => a.command.type === 'deny')
  let playerUpdates: PlayerUpdates = {}

  for (const action of denies) {
    const cmd = action.command as { type: 'deny'; target: { kind: 'creep'; index: number } }
    const denier = players[action.playerId]
    if (!denier || !denier.alive) continue

    const resolved = creepInZoneByIndex(creeps, denier.zone, cmd.target.index)
    if (!resolved) continue
    const { creep, globalIdx: creepIdx } = resolved
    if (creep.hp <= 0) continue

    if (creep.team !== denier.team) continue
    const creepMaxHp =
      creep.type === 'siege'
        ? SIEGE_CREEP_HP
        : creep.type === 'ranged'
          ? RANGED_CREEP_HP
          : MELEE_CREEP_HP
    if (creep.hp > creepMaxHp * DENY_HP_THRESHOLD) continue

    creeps[creepIdx] = { ...creep, hp: 0 }

    const denyGold = Math.floor(((CREEP_GOLD_MIN + CREEP_GOLD_MAX) / 2) * DENY_GOLD_RATIO)
    playerUpdates[action.playerId] = {
      ...playerUpdates[action.playerId],
      gold: denier.gold + denyGold,
      xp: denier.xp + Math.floor(CREEP_XP * DENY_XP_RATIO),
    }

    events.push({
      _tag: 'creep_deny',
      tick,
      playerId: action.playerId,
      creepId: creep.id,
      creepType: creep.type,
      goldAwarded: denyGold,
    })
  }
  return { players: applyPlayerUpdates(players, playerUpdates), creeps }
}

/**
 * Phase 3b: Attacks — hero/creep/tower/Roshan/neutral/Ancient, all simultaneous.
 * This is the largest phase (~440 lines): crit stacking, item on-hit effects
 * (MKB magic, Maelstrom chain, Skull Basher stun), defense mitigation (Desolator
 * shred, Assault Cuirass aura, Vanguard block), shield/phaseShift, Blade Mail
 * reflect, TP channeling cancel. Reads pending HP/buffs so simultaneous
 * focus-fire isn't last-write-wins.
 */
function resolveAttackPhase(
  state: GameState,
  attacks: PlayerAction[],
  players: Record<string, PlayerState>,
  creeps: CreepState[],
  towers: TowerState[],
  neutrals: NeutralCreepState[],
  ancients: { radiant: AncientState; dire: AncientState },
  events: GameEngineEvent[],
  rejected: Array<{ playerId: string; reason: string }>,
  heroAttackers: Map<string, string>,
  damageTracker: Map<string, { hero: number; tower: number }>,
  creepKills: Array<{ playerId: string; creepType: 'melee' | 'ranged' | 'siege' }>,
  neutralKills: Array<{ playerId: string; neutralId: string }>,
  towerKills: Array<{ zone: string; team: TeamId }>,
  findHeroByName: (name: string) => string | null,
  getCachedItemStats: (playerId: string, items: (string | null)[]) => ItemStats,
): {
  players: Record<string, PlayerState>
  creeps: CreepState[]
  towers: TowerState[]
  neutrals: NeutralCreepState[]
  ancients: { radiant: AncientState; dire: AncientState }
} {
  let playerUpdates: PlayerUpdates = {}

  // Precompute Assault Cuirass auras per zone once for the entire attack phase.
  // Previously this scanned all players on EVERY attack action — O(players × attacks).
  const cuirassByZone = new Map<string, { ally: boolean; enemy: boolean }>()
  for (const [, zonePlayer] of Object.entries(players)) {
    if (!zonePlayer.items.includes('assault_cuirass')) continue
    let entry = cuirassByZone.get(zonePlayer.zone)
    if (!entry) {
      entry = { ally: false, enemy: false }
      cuirassByZone.set(zonePlayer.zone, entry)
    }
    // Aura direction is relative to the TARGET, so we store both team flags.
    // ally = at least one cuirass holder is on the target's team (defense buff)
    // enemy = at least one holder is on the opposite team (armor shred)
    // We use radiant/dire presence flags and resolve per-target below.
    if (zonePlayer.team === 'radiant') {
      entry.ally = true // radiant has cuirass in this zone
    } else {
      entry.enemy = true // dire has cuirass in this zone
    }
  }

  for (const action of attacks) {
    const cmd = action.command as { type: 'attack'; target: TargetRef }
    const attacker = players[action.playerId]
    if (!attacker || !attacker.alive) continue

    if (cmd.target.kind === 'hero') {
      const targetId = findHeroByName(cmd.target.name)
      if (!targetId) continue
      const target = players[targetId]
      if (!target || !target.alive) continue

      if (target.zone !== attacker.zone) {
        rejected.push({ playerId: action.playerId, reason: 'Target is not in your zone' })
        continue
      }
      if (target.team === attacker.team) continue

      const targetPendingHp = (playerUpdates[targetId]?.hp as number | undefined) ?? target.hp
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
      if (attacker.items.includes('crystalys'))
        ownedCrits.push({
          chance: CRYSTALYS_CRIT_CHANCE,
          multiplier: CRYSTALYS_CRIT_MULTIPLIER,
        })
      if (attacker.items.includes('daedalus'))
        ownedCrits.push({
          chance: DAEDALUS_CRIT_CHANCE,
          multiplier: DAEDALUS_CRIT_MULTIPLIER,
        })

      let critMultiplier = 1
      if (ownedCrits.length > 0) {
        const best = ownedCrits.reduce((a, b) => (b.chance > a.chance ? b : a))
        if (Math.random() < best.chance) critMultiplier = best.multiplier
      }

      attackDamage = Math.round(attackDamage * critMultiplier)

      let bonusMagicDamage = 0
      if (attacker.items.includes('monkey_king_bar')) {
        bonusMagicDamage = MKB_BONUS_DAMAGE
      }

      if (attacker.items.includes('maelstrom') && Math.random() < 0.25) {
        const chainTargets = Object.values(players).filter(
          (p) =>
            p.zone === attacker.zone && p.team !== attacker.team && p.alive && p.id !== target.id,
        )
        if (chainTargets.length > 0) {
          const chainTarget = chainTargets[Math.floor(Math.random() * chainTargets.length)]!
          const chainDamage = isDamageImmune(chainTarget, 'magical')
            ? 0
            : Math.round(
                calculateMagicalDamage(60, chainTarget.magicResist) *
                  getIncomingDamageMultiplier(chainTarget, 'magical'),
              )
          if (chainDamage > 0) {
            const chainPendingHp =
              (playerUpdates[chainTarget.id]?.hp as number | undefined) ?? chainTarget.hp
            const chainNewHp = Math.max(0, chainPendingHp - chainDamage)
            playerUpdates[chainTarget.id] = {
              ...playerUpdates[chainTarget.id],
              hp: chainNewHp,
              alive: chainNewHp > 0,
            }
            events.push({
              _tag: 'damage',
              tick: state.tick,
              sourceId: action.playerId,
              targetId: chainTarget.id,
              amount: chainDamage,
              damageType: 'magical',
            })
          }
        }
      }

      // Silver Edge: the +bonus is an empowered NEXT-attack-from-invis (like
      // every stealth in the engine), not a permanent every-attack buff. Only
      // apply it while invis is active, and consume BOTH the bonus and the invis
      // on the attack — which also correctly breaks stealth on attacking.
      const silverEdgeInvis = attacker.buffs.some((b) => b.id === 'silver_edge_invis')
      const silverEdgeBonus = attacker.buffs.find((b) => b.id === 'silver_edge_bonus')
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
            (b) => b.id !== 'silver_edge_invis' && b.id !== 'silver_edge_bonus',
          ),
        }
      }

      if (attacker.buffs.some((b) => b.id === 'stealth')) {
        attackDamage = Math.round(attackDamage * 1.5)
      }

      let defense = getEffectiveDefense(target, targetItemStats)

      if (attacker.items.includes('desolator')) {
        defense = Math.max(0, defense - DESOLATOR_ARMOR_REDUCTION)
      }

      // Assault Cuirass aura: O(1) zone lookup instead of O(players) scan per attack.
      const cuirass = cuirassByZone.get(target.zone)
      if (cuirass) {
        // ally = target's team has a cuirass holder in zone → +armor
        // enemy = opposite team has a holder → -armor
        const allyCuirass = target.team === 'radiant' ? cuirass.ally : cuirass.enemy
        const enemyCuirass = target.team === 'radiant' ? cuirass.enemy : cuirass.ally
        if (allyCuirass) defense += ASSAULT_CUIRASS_AURA_DEFENSE
        if (enemyCuirass) defense = Math.max(0, defense - ASSAULT_CUIRASS_AURA_DEFENSE)
      }

      let blockedDamage = 0
      if (target.items.includes('vanguard') && Math.random() < VANGUARD_BLOCK_CHANCE) {
        blockedDamage = VANGUARD_BLOCK_AMOUNT
      }

      let damage = calculatePhysicalDamage(attackDamage, defense)
      damage = Math.max(0, damage - blockedDamage)

      if (isDamageImmune(target, 'physical')) {
        damage = 0
      } else {
        damage = Math.round(damage * getIncomingDamageMultiplier(target, 'physical'))
      }

      // A phaseShift dodge nullifies the whole hit — compute once and reuse so
      // no damage event, magic proc, tracking, or attacker credit is emitted for
      // a hit that deals 0 HP (mirrors the NPC path's damageDealt===0 skip).
      const dodged = targetPendingBuffs.some((b) => b.id === 'phaseShift')

      let totalDamage = damage
      if (bonusMagicDamage > 0 && !isDamageImmune(target, 'magical') && !dodged) {
        const rawMagic = calculateMagicalDamage(
          bonusMagicDamage,
          getEffectiveMagicResist(target, targetItemStats),
        )
        const magicDmg = Math.round(rawMagic * getIncomingDamageMultiplier(target, 'magical'))
        totalDamage += magicDmg
        events.push({
          _tag: 'damage',
          tick: state.tick,
          sourceId: action.playerId,
          targetId,
          amount: magicDmg,
          damageType: 'magical',
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

      const newHp = Math.max(0, targetPendingHp - hpLoss)

      if (attacker.items.includes('skull_basher') && Math.random() < 0.25) {
        // ticksRemaining 2 = one gated action: reaped same-tick by tickAllBuffs
        // (see the applyBuff note), so 1 would never reach the next validateAction.
        newBuffs.push({ id: 'stun', stacks: 1, ticksRemaining: 2, source: attacker.id })
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

      if (target.buffs.some((b) => b.id === 'blade_mail')) {
        const returnDamage = computeBladeMailReflect(hpLoss)
        const attackerPendingHp =
          (playerUpdates[action.playerId]?.hp as number | undefined) ?? attacker.hp
        const attackerNewHp = Math.max(0, attackerPendingHp - returnDamage)
        playerUpdates[action.playerId] = {
          ...playerUpdates[action.playerId],
          hp: attackerNewHp,
          alive: attackerNewHp > 0,
        }
        events.push({
          _tag: 'damage',
          tick: state.tick,
          sourceId: targetId,
          targetId: action.playerId,
          amount: returnDamage,
          damageType: 'pure',
        })
      }

      playerUpdates[targetId] = {
        ...playerUpdates[targetId],
        hp: newHp,
        alive: newHp > 0,
        buffs: newBuffs,
      }

      if (!dodged) {
        heroAttackers.set(action.playerId, targetId)

        const dt = damageTracker.get(action.playerId) ?? { hero: 0, tower: 0 }
        dt.hero += damage
        damageTracker.set(action.playerId, dt)

        events.push({
          _tag: 'damage',
          tick: state.tick,
          sourceId: action.playerId,
          targetId,
          amount: damage,
          damageType: 'physical',
        })
      }
    } else if (cmd.target.kind === 'creep') {
      const resolved = creepInZoneByIndex(creeps, attacker.zone, cmd.target.index)
      if (!resolved) continue
      const { creep, globalIdx: creepIdx } = resolved
      if (creep.hp <= 0) continue

      const attackerItemStats = getCachedItemStats(action.playerId, attacker.items)
      const attackDamage = getEffectiveAttack(attacker, attackerItemStats)
      const newHp = Math.max(0, creep.hp - attackDamage)

      creeps[creepIdx] = { ...creep, hp: newHp }

      if (newHp <= 0) {
        creepKills.push({ playerId: action.playerId, creepType: creep.type })
      }

      events.push({
        _tag: 'damage',
        tick: state.tick,
        sourceId: action.playerId,
        targetId: creep.id,
        amount: attackDamage,
        damageType: 'physical',
      })
    } else if (cmd.target.kind === 'tower') {
      const targetZone = cmd.target.zone
      const tower = towers.find((t) => t.zone === targetZone && t.alive)
      if (!tower) continue
      if (tower.zone !== attacker.zone) {
        rejected.push({ playerId: action.playerId, reason: 'Target is not in your zone' })
        continue
      }
      if (tower.invulnerable) {
        events.push({
          _tag: 'tower_invulnerable',
          tick: state.tick,
          zone: tower.zone,
        })
        continue
      }
      if (!canAttackTower(towers, targetZone)) {
        rejected.push({
          playerId: action.playerId,
          reason: 'That tower is protected — destroy the one in front of it first',
        })
        continue
      }

      const attackerItemStats = getCachedItemStats(action.playerId, attacker.items)
      const attackDamage = getEffectiveAttack(attacker, attackerItemStats)
      const newHp = Math.max(0, tower.hp - attackDamage)

      towers = towers.map((t) =>
        t.zone === tower.zone && t.team === tower.team ? { ...t, hp: newHp, alive: newHp > 0 } : t,
      )

      if (newHp <= 0) {
        towerKills.push({ zone: tower.zone, team: tower.team })
      }

      const tdt = damageTracker.get(action.playerId) ?? { hero: 0, tower: 0 }
      tdt.tower += attackDamage
      damageTracker.set(action.playerId, tdt)

      events.push({
        _tag: 'damage',
        tick: state.tick,
        sourceId: action.playerId,
        targetId: `tower_${tower.zone}`,
        amount: attackDamage,
        damageType: 'physical',
      })
    } else if (cmd.target.kind === 'roshan') {
      const roshan = state.roshan
      if (!roshan.alive) continue
      if (attacker.zone !== 'roshan-pit') {
        rejected.push({
          playerId: action.playerId,
          reason: 'Roshan can only be attacked from the pit',
        })
        continue
      }

      const attackerItemStats = getCachedItemStats(action.playerId, attacker.items)
      const attackDamage = getEffectiveAttack(attacker, attackerItemStats)

      events.push({
        _tag: 'damage',
        tick: state.tick,
        sourceId: action.playerId,
        targetId: 'roshan',
        amount: attackDamage,
        damageType: 'physical',
      })
    } else if (cmd.target.kind === 'neutral') {
      const neutralIdx = cmd.target.index
      const neutral = neutrals[neutralIdx]
      if (!neutral || !neutral.alive) continue
      if (neutral.zone !== attacker.zone) {
        rejected.push({ playerId: action.playerId, reason: 'Target is not in your zone' })
        continue
      }

      const attackerItemStats = getCachedItemStats(action.playerId, attacker.items)
      const attackDamage = getEffectiveAttack(attacker, attackerItemStats)
      const newHp = Math.max(0, neutral.hp - attackDamage)

      neutrals[neutralIdx] = { ...neutral, hp: newHp, alive: newHp > 0 }

      if (newHp <= 0) {
        neutralKills.push({ playerId: action.playerId, neutralId: neutral.id })
      }

      events.push({
        _tag: 'damage',
        tick: state.tick,
        sourceId: action.playerId,
        targetId: neutral.id,
        amount: attackDamage,
        damageType: 'physical',
      })
    } else if (cmd.target.kind === 'ancient') {
      const enemyTeam: TeamId = attacker.team === 'radiant' ? 'dire' : 'radiant'
      if (attacker.zone !== ANCIENT_ZONES[enemyTeam]) {
        rejected.push({
          playerId: action.playerId,
          reason: 'You must be in the enemy base to attack the Ancient',
        })
        continue
      }

      const attackerItemStats = getCachedItemStats(action.playerId, attacker.items)
      const attackDamage = getEffectiveAttack(attacker, attackerItemStats)

      const result = resolveAncientAttack(
        { ...state, players, creeps, towers, ancients },
        action.playerId,
        attackDamage,
      )
      if (result.rejected) {
        wsLog.debug('Ancient attack rejected', {
          playerId: action.playerId,
          reason: result.rejected,
        })
        rejected.push({ playerId: action.playerId, reason: result.rejected })
        continue
      }

      ancients = result.state.ancients
      events.push(...result.events)

      const adt = damageTracker.get(action.playerId) ?? { hero: 0, tower: 0 }
      adt.tower += attackDamage
      damageTracker.set(action.playerId, adt)
    }
  }

  return {
    players: applyPlayerUpdates(players, playerUpdates),
    creeps,
    towers,
    neutrals,
    ancients,
  }
}

/**
 * Phase 4: Passive effects — cooldown ticks, item regen (Ring of Health, Sobi
 * Mask, Heart of Tarrasque, Garbage Collector), Aether Lens cooldown reduction,
 * Linken's Sphere re-arm, Healing Salve buff regen.
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

    let hp = player.hp
    let mp = player.mp

    const salveRegen = player.buffs.find((b) => b.id === 'healing_salve_regen')
    if (salveRegen) {
      hp = Math.min(player.maxHp, hp + salveRegen.stacks)
    }

    if (player.items.includes('ring_of_health')) {
      hp = Math.min(player.maxHp, hp + Math.floor(player.maxHp * RING_OF_HEALTH_REGEN_PERCENT))
    }

    if (player.items.includes('sobi_mask')) {
      mp = Math.min(player.maxMp, mp + Math.floor(player.maxMp * SOBI_MASK_REGEN_PERCENT))
    }

    if (player.items.includes('heart_of_tarrasque')) {
      const tookDamage = events.some((e) => e._tag === 'damage' && e.targetId === pid)
      const inCombat = player.buffs.some((b) => b.id === 'inCombat')
      if (!tookDamage && !inCombat) {
        hp = Math.min(player.maxHp, hp + Math.floor(player.maxHp * HEART_REGEN_PERCENT))
      }
    }

    if (player.items.includes('garbage_collector')) {
      const tookDamage = events.some((e) => e._tag === 'damage' && e.targetId === pid)
      const dealtDamage = heroAttackers.has(pid)
      const inCombat = player.buffs.some((b) => b.id === 'inCombat')
      if (!tookDamage && !dealtDamage && !inCombat) {
        hp = Math.min(player.maxHp, hp + Math.floor(player.maxHp * HEART_REGEN_PERCENT))
      }
    }

    if (player.items.includes('aether_lens')) {
      for (const slot of ['q', 'w', 'e', 'r'] as const) {
        if (cooldowns[slot] > 0) {
          cooldowns[slot] = Math.max(0, cooldowns[slot] - 1)
        }
      }
    }

    let buffs = player.buffs
    if (player.items.includes('linkens_sphere')) {
      const linkenBuff = player.buffs.find((b) => b.id === 'spellblock')
      if (!linkenBuff) {
        buffs = [
          ...player.buffs,
          {
            id: 'spellblock',
            stacks: 1,
            ticksRemaining: LINKENS_RECHARGE_TICKS,
            source: 'linkens_sphere',
          },
        ]
      }
    }

    playerUpdates[pid] = { hp, mp, cooldowns, buffs }
  }
  return { players: applyPlayerUpdates(players, playerUpdates) }
}

/**
 * Phase 5: Buy/Sell/Use — item shop operations + item active abilities.
 * Buy/sell failures surface as rejection events (InsufficientGold,
 * InventoryFull, NotSellable, etc.). Use failures surface similarly
 * (cooldown, invalid target, max stacks).
 */
function resolveShopPhase(
  state: GameState,
  validActions: PlayerAction[],
  players: Record<string, PlayerState>,
  zones: Record<string, ZoneRuntimeState>,
  creeps: CreepState[],
  towers: TowerState[],
  ancients: { radiant: AncientState; dire: AncientState },
  events: GameEngineEvent[],
  rejected: Array<{ playerId: string; reason: string }>,
  heroAttackers: Map<string, string>,
  damageTracker: Map<string, { hero: number; tower: number }>,
): {
  players: Record<string, PlayerState>
  zones: Record<string, ZoneRuntimeState>
} {
  // Buy
  const buys = validActions.filter((a) => a.command.type === 'buy')
  for (const action of buys) {
    const cmd = action.command as { type: 'buy'; item: string }
    const tempState: GameState = { ...state, players, creeps, towers }
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
    const tempState: GameState = { ...state, players, creeps, towers }
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

  // Use item actives
  const uses = validActions.filter((a) => a.command.type === 'use')
  for (const action of uses) {
    const cmd = action.command as { type: 'use'; item: string; target?: TargetRef | string }
    const tempState: GameState = { ...state, players, zones, creeps, towers, ancients }
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

      // Item actives that change HP (Dagon, Shiva's Guard, …) mutate HP inside
      // useItem but, historically, emitted NO damage/heal event — so an item
      // kill gave no killer credit/bounty/assist, never reflected Blade Mail,
      // and never fired the damage-taken passives (daemon stealth-break,
      // cache/firewall/proxy). Diff pre→post HP and synthesise the same events
      // the cast path does (ActionResolver.resolveHeroCast), so item damage is a
      // first-class damage source. Magical is the item-nuke damage type.
      const user = players[action.playerId]
      for (const [pid, post] of Object.entries(players)) {
        const pre = prePlayers[pid]
        if (!pre) continue
        const delta = pre.hp - post.hp
        if (delta > 0) {
          events.push({
            _tag: 'damage',
            tick: state.tick,
            sourceId: action.playerId,
            targetId: pid,
            amount: delta,
            damageType: 'magical',
          })
          if (user && post.team !== user.team) {
            heroAttackers.set(action.playerId, pid)
            const dt = damageTracker.get(action.playerId) ?? { hero: 0, tower: 0 }
            dt.hero += delta
            damageTracker.set(action.playerId, dt)

            // Blade Mail: an enemy hit by the item reflects the HP it lost back
            // at the user as pure damage — same formula as the cast/attack path.
            if (post.buffs.some((b) => b.id === 'blade_mail')) {
              const userPost = players[action.playerId]
              if (userPost) {
                const returnDamage = computeBladeMailReflect(delta)
                const userNewHp = Math.max(0, userPost.hp - returnDamage)
                players = {
                  ...players,
                  [action.playerId]: { ...userPost, hp: userNewHp, alive: userNewHp > 0 },
                }
                events.push({
                  _tag: 'damage',
                  tick: state.tick,
                  sourceId: pid,
                  targetId: action.playerId,
                  amount: returnDamage,
                  damageType: 'pure',
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
    }
  }

  return { players, zones }
}

/**
 * Post-shop phases: glyph, aegis/rune pickup, maxHp/maxMp recalc, gold/XP
 * awards (creep/neutral/tower), damage tracking, ward placement. These all
 * run after the shop phase and before the final state assembly.
 */
function resolvePostShopPhases(
  state: GameState,
  validActions: PlayerAction[],
  players: Record<string, PlayerState>,
  zones: Record<string, ZoneRuntimeState>,
  creeps: CreepState[],
  towers: TowerState[],
  neutrals: NeutralCreepState[],
  events: GameEngineEvent[],
  _rejected: Array<{ playerId: string; reason: string }>,
  damageTracker: Map<string, { hero: number; tower: number }>,
  creepKills: Array<{ playerId: string; creepType: 'melee' | 'ranged' | 'siege' }>,
  neutralKills: Array<{ playerId: string; neutralId: string }>,
  towerKills: Array<{ zone: string; team: TeamId }>,
  getCachedItemStats: (playerId: string, items: (string | null)[]) => ItemStats,
): {
  players: Record<string, PlayerState>
  zones: Record<string, ZoneRuntimeState>
  towers: TowerState[]
  neutrals: NeutralCreepState[]
  teams: { radiant: TeamState; dire: TeamState }
  aegis: GameState['aegis']
  runes: RuneState[]
} {
  let teams = { ...state.teams }

  // Glyph commands
  const glyphActions = validActions.filter((a) => a.command.type === 'glyph')
  for (const action of glyphActions) {
    const player = players[action.playerId]
    if (!player) continue
    const team = player.team
    const teamState = teams[team]
    if (teamState.glyphUsedTick !== null) {
      const ticksSinceUse = state.tick - teamState.glyphUsedTick
      if (ticksSinceUse < GLYPH_COOLDOWN_TICKS) {
        events.push({
          _tag: 'glyph_on_cooldown',
          tick: state.tick,
          playerId: action.playerId,
          remainingTicks: GLYPH_COOLDOWN_TICKS - ticksSinceUse,
        })
        continue
      }
    }
    towers = towers.map((t) => (t.team === team ? { ...t, invulnerable: true } : t))
    teams = { ...teams, [team]: { ...teamState, glyphUsedTick: state.tick } }
    events.push({ _tag: 'glyph_used', tick: state.tick, team })
  }

  // Aegis pickup
  let aegisGround = state.aegis
  const aegisPickups = validActions.filter((a) => a.command.type === 'aegis')
  for (const action of aegisPickups) {
    const tempState: GameState = {
      ...state,
      players,
      creeps,
      towers,
      runes: state.runes ?? [],
      roshan: state.roshan,
      aegis: aegisGround,
    }
    const result = pickupAegis(tempState, action.playerId)
    if (result.event) {
      players = { ...result.state.players }
      aegisGround = result.state.aegis
      events.push(result.event)
    }
  }

  // Rune pickup
  let runesGround = state.runes ?? []
  const runePickups = validActions.filter((a) => a.command.type === 'rune')
  for (const action of runePickups) {
    const player = players[action.playerId]
    if (!player) continue
    const tempState: GameState = {
      ...state,
      players,
      creeps,
      towers,
      runes: runesGround,
      roshan: state.roshan,
      aegis: state.aegis,
    }
    const result = pickupRune(tempState, action.playerId, player.zone)
    if (result.event) {
      players = { ...result.state.players }
      runesGround = result.state.runes ?? []
      events.push(result.event)
    }
  }

  // Recalculate maxHp/maxMp
  for (const [pid, player] of Object.entries(players)) {
    const hero = player.heroId ? HEROES[player.heroId] : null
    if (!hero) continue
    const baseMaxHp = hero.baseStats.hp + (hero.growthPerLevel.hp ?? 0) * (player.level - 1)
    const baseMaxMp = hero.baseStats.mp + (hero.growthPerLevel.mp ?? 0) * (player.level - 1)
    const itemBonuses = getCachedItemStats(pid, player.items)
    const treadsHp = player.buffs.find((b) => b.id === 'power_treads_hp')?.stacks ?? 0
    const treadsMp = player.buffs.find((b) => b.id === 'power_treads_mp')?.stacks ?? 0
    const newMaxHp = baseMaxHp + (itemBonuses.hp ?? 0) + getTalentStatBonus(player, 'hp') + treadsHp
    const newMaxMp = baseMaxMp + (itemBonuses.mp ?? 0) + getTalentStatBonus(player, 'mp') + treadsMp
    if (newMaxHp !== player.maxHp || newMaxMp !== player.maxMp) {
      // Preserve the hp/mp PERCENTAGE across any max change (item buy/sell,
      // talent, power-treads toggle): a full hero stays full, a half-hp hero
      // stays at half. Level-ups don't reach here — levelUpHero reconciles maxHp
      // with a flat gain, so the guard above is false for them. A live player is
      // never dropped to 0 by a max change (e.g. selling an HP item at low HP).
      const hpRatio = player.maxHp > 0 ? player.hp / player.maxHp : 1
      const mpRatio = player.maxMp > 0 ? player.mp / player.maxMp : 1
      const scaledHp = Math.min(newMaxHp, Math.floor(newMaxHp * hpRatio))
      const newHp = player.hp > 0 ? Math.max(1, scaledHp) : scaledHp
      const newMp = Math.min(newMaxMp, Math.floor(newMaxMp * mpRatio))
      players = {
        ...players,
        [pid]: { ...player, maxHp: newMaxHp, maxMp: newMaxMp, hp: newHp, mp: newMp },
      }
    }
  }

  // Creep last-hit gold + XP
  for (const kill of creepKills) {
    const tempState: GameState = { ...state, players, creeps, towers }
    const awarded = awardLastHit(tempState, kill.playerId, kill.creepType)
    players = { ...awarded.players }
    const killer = players[kill.playerId]
    if (killer) {
      players = { ...players, [kill.playerId]: { ...killer, xp: killer.xp + CREEP_XP } }
    }
  }

  // Neutral kill gold + XP
  for (const kill of neutralKills) {
    const neutral = neutrals.find((n) => n.id === kill.neutralId)
    if (!neutral) continue
    const stats = NEUTRAL_CREEPS[neutral.type as NeutralCreepType]
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

  // Tower kill gold
  for (const kill of towerKills) {
    const nearbyAllies = Object.entries(players)
      .filter(([, p]) => p.zone === kill.zone && p.team !== kill.team && p.alive)
      .map(([id]) => id)
    const tempState: GameState = { ...state, players, creeps, towers }
    const awarded = awardTowerKill(tempState, kill.zone, nearbyAllies)
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
          towerDamageDealt: p.towerDamageDealt + dmg.tower,
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
      const wardSlot = player.items.findIndex((i) => i === 'observer_ward' || i === 'sentry_ward')
      if (wardSlot === -1) continue
      const wardType = player.items[wardSlot] === 'sentry_ward' ? 'sentry' : 'observer'
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

  return { players, zones, towers, neutrals, teams, aegis: aegisGround, runes: runesGround }
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
    const validActions = actions.filter((a) => {
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
    let creeps = [...state.creeps]
    let neutrals = [...(state.neutrals ?? [])]
    let towers = [...state.towers]
    let teams = { ...state.teams }
    const creepKills: Array<{ playerId: string; creepType: 'melee' | 'ranged' | 'siege' }> = []
    const neutralKills: Array<{ playerId: string; neutralId: string }> = []
    const towerKills: Array<{ zone: string; team: TeamId }> = []
    const damageTracker = new Map<string, { hero: number; tower: number }>()

    // Build hero lookup index (once per resolveActions)
    const heroIndex = new Map<string, string>()
    for (const [id, p] of Object.entries(players)) {
      heroIndex.set(p.name.toLowerCase(), id)
      heroIndex.set(p.id.toLowerCase(), id)
      if (p.heroId) heroIndex.set(p.heroId.toLowerCase(), id)
    }
    const findHeroByNameCached = (name: string): string | null => {
      return heroIndex.get(name.toLowerCase()) ?? null
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

    // Phase 1: Instant abilities (stuns, silences)
    {
      const result = resolveInstantCastsPhase(
        state,
        validActions,
        players,
        zones,
        creeps,
        towers,
        ancients,
        events,
        heroAttackers,
        rejected,
        damageTracker,
        findHeroByNameCached,
      )
      players = result.players
      zones = result.zones
    }

    // Phase 2: Movement — all moves resolve simultaneously
    {
      const result = resolveMovementPhase(state.tick, validActions, players, events, rejected)
      players = result.players
      // events + rejected are mutated in place by the phase
    }

    // Phase 3: Attacks + targeted abilities — simultaneous
    {
      const result = resolveDenyPhase(state.tick, validActions, players, creeps, events)
      players = result.players
      creeps = result.creeps
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
        creeps,
        towers,
        neutrals,
        ancients,
        events,
        rejected,
        heroAttackers,
        damageTracker,
        creepKills,
        neutralKills,
        towerKills,
        findHeroByNameCached,
        getCachedItemStats,
      )
      players = result.players
      creeps = result.creeps
      towers = result.towers
      neutrals = result.neutrals
      ancients = result.ancients
    }

    // Resolve targeted casts
    for (const action of targetedCasts) {
      const result = resolveHeroCast(
        state,
        players,
        zones,
        creeps,
        towers,
        ancients,
        action,
        events,
        heroAttackers,
        rejected,
        damageTracker,
        findHeroByNameCached,
      )
      players = result.players
      zones = result.zones
    }

    // Phase 4: Passive effects, cooldown ticks, item passives
    {
      const result = resolvePassivesPhase(players, events, heroAttackers)
      players = result.players
    }

    // Phase 5: Buy/Sell/Use
    {
      const result = resolveShopPhase(
        state,
        validActions,
        players,
        zones,
        creeps,
        towers,
        ancients,
        events,
        rejected,
        heroAttackers,
        damageTracker,
      )
      players = result.players
      zones = result.zones
    }

    // Handle glyph commands + pickups + statRecalc + awards + wards
    let aegisGround = state.aegis
    let runesGround = state.runes ?? []
    {
      const result = resolvePostShopPhases(
        state,
        validActions,
        players,
        zones,
        creeps,
        towers,
        neutrals,
        events,
        rejected,
        damageTracker,
        creepKills,
        neutralKills,
        towerKills,
        getCachedItemStats,
      )
      players = result.players
      zones = result.zones
      towers = result.towers
      neutrals = result.neutrals
      teams = result.teams
      aegisGround = result.aegis
      runesGround = result.runes
    }

    const updatedState: GameState = {
      ...state,
      players,
      zones,
      creeps,
      neutrals,
      towers,
      teams,
      ancients,
      aegis: aegisGround,
      runes: runesGround,
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
 * The cast bridge — runs the per-hero registry resolver (`resolveAbility`)
 * against a temp GameState assembled from the in-flight resolution buffers,
 * then synthesizes backward-compatible damage/heal events by diffing
 * pre/post HP. Resolver failures (mana, target, cooldown) are surfaced via
 * the `rejected` channel instead of being silently dropped.
 *
 * The bridge must NOT deduct mana or set cooldowns itself — the hero
 * resolvers own scaled per-level costs and cooldowns.
 */
function resolveHeroCast(
  state: GameState,
  players: Record<string, PlayerState>,
  zones: GameState['zones'],
  creeps: CreepState[],
  towers: GameState['towers'],
  ancients: GameState['ancients'],
  action: PlayerAction,
  events: GameEngineEvent[],
  heroAttackers: Map<string, string>,
  rejected: Array<{ playerId: string; reason: string }>,
  damageTracker: Map<string, { hero: number; tower: number }>,
  findHero: (name: string) => string | null,
): { players: Record<string, PlayerState>; zones: GameState['zones'] } {
  const cmd = action.command as { type: 'cast'; ability: AbilitySlot; target?: TargetRef }
  const caster = players[action.playerId]
  if (!caster?.heroId) return { players, zones }

  const tempState: GameState = { ...state, players, zones, creeps, towers, ancients }
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
    if (err._tag === 'InsufficientManaError') {
      reason = `Not enough mana for ${abilityName}: need ${err.required}, have ${Math.floor(caster.mp)}`
    } else if (err._tag === 'CooldownError') {
      const cd = caster.cooldowns[cmd.ability] ?? 0
      reason = `${abilityName} on cooldown — ${cd} tick${cd === 1 ? '' : 's'} left (ready T${state.tick + cd})`
    } else {
      reason = err.reason
    }
    rejected.push({ playerId: action.playerId, reason })
    return { players, zones }
  }

  const newState = result.right.state
  let newPlayers = newState.players
  const abilityDef = HEROES[caster.heroId]?.abilities[cmd.ability]
  const damageType = abilityDef?.damageType ?? 'magical'

  // Resolve the targeted hero id (used by the block check + ability_used event).
  // Uses the pre-built hero index (findHero) instead of a per-cast linear scan.
  let targetId: string | undefined
  if (cmd.target?.kind === 'hero') {
    targetId = findHero(cmd.target.name) ?? undefined
  }

  // Linken's Sphere / Firewall item: a single-target ability on a hero holding a
  // block charge fizzles — the caster still pays mana + cooldown (already
  // deducted by the resolver), but the target's effect is reverted to its
  // pre-cast state and one block charge is consumed.
  if (targetId && abilityDef?.targetType === 'hero') {
    const pre = players[targetId]
    const post = newPlayers[targetId]
    // Only an ARMED charge (stacks >= 1) blocks — a spent Linken's is stacks 0.
    const blockId = pre?.buffs.find(
      (b) => (b.id === 'spellblock' || b.id === 'firewall_block') && b.stacks >= 1,
    )?.id
    if (pre && blockId) {
      const buffs = pre.buffs.flatMap((b) => {
        if (b.id !== blockId) return [b]
        // firewall_block is a one-shot from an item active → remove it.
        // spellblock auto-recharges (every tick it's absent), so instead spend
        // it to stacks 0 with a fresh 12-tick window to gate the next block.
        return b.id === 'spellblock'
          ? [{ ...b, stacks: 0, ticksRemaining: LINKENS_RECHARGE_TICKS }]
          : []
      })
      newPlayers = { ...newPlayers, [targetId]: { ...pre, buffs } }
      events.push({
        _tag: 'spell_blocked',
        tick: state.tick,
        casterId: action.playerId,
        targetId,
        source: blockId === 'spellblock' ? 'linkens_sphere' : 'firewall_item',
      })
    } else if (pre && post && pre.buffs.some((b) => b.id === 'lotus_orb')) {
      // Lotus Orb: negate the spell on the holder and bounce the damage it would
      // have taken back to the caster (gated by the caster's own immunity).
      const reflected = pre.hp - post.hp
      let removed = false
      const buffs = pre.buffs.filter((b) => {
        if (!removed && b.id === 'lotus_orb') {
          removed = true
          return false
        }
        return true
      })
      newPlayers = { ...newPlayers, [targetId]: { ...pre, buffs } } // negate on holder
      const casterPost = newPlayers[action.playerId]
      if (reflected > 0 && casterPost && !isDamageImmune(casterPost, damageType)) {
        const newHp = Math.max(0, casterPost.hp - reflected)
        newPlayers = {
          ...newPlayers,
          [action.playerId]: { ...casterPost, hp: newHp, alive: newHp > 0 },
        }
        events.push({
          _tag: 'damage',
          tick: state.tick,
          sourceId: targetId,
          targetId: action.playerId,
          amount: reflected,
          damageType,
        })
      }
      events.push({
        _tag: 'spell_blocked',
        tick: state.tick,
        casterId: action.playerId,
        targetId,
        source: 'lotus_orb',
        reflected: reflected > 0 ? reflected : 0,
      })
    }
  }

  // Synthesize legacy-shape damage/heal events from the HP diff. Amounts are
  // post-mitigation AND post-shield: a fully shield-absorbed ability hit
  // emits no damage event (and grants no assist credit). Basic attacks keep
  // pre-shield amounts — see the attack phase. Don't "fix" one to match the
  // other without revisiting both.
  // Stack Overflow (Overclock): the caster's next ability deals 2x damage —
  // double the HP lost by each enemy hit, then spend the charge after the loop.
  const hasOverclock = !!newPlayers[action.playerId]?.buffs.some(
    (b) => b.id === 'stack_overflow_buff',
  )
  for (const [pid, post] of Object.entries(newPlayers)) {
    const pre = players[pid]
    if (!pre) continue
    let delta = pre.hp - post.hp
    if (delta > 0 && hasOverclock && post.team !== caster.team) {
      const doubledHp = Math.max(0, post.hp - delta)
      newPlayers = { ...newPlayers, [pid]: { ...post, hp: doubledHp, alive: doubledHp > 0 } }
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
        const dt = damageTracker.get(action.playerId) ?? { hero: 0, tower: 0 }
        dt.hero += delta
        damageTracker.set(action.playerId, dt)

        // Blade Mail: an enemy hero hit by this cast reflects the HP it lost
        // back at the caster as pure damage — the same computeBladeMailReflect
        // formula as the basic-attack reflect, so the two paths can never
        // diverge.
        if (post.buffs.some((b) => b.id === 'blade_mail')) {
          const casterPost = newPlayers[action.playerId]
          if (casterPost) {
            const returnDamage = computeBladeMailReflect(delta)
            const casterNewHp = Math.max(0, casterPost.hp - returnDamage)
            newPlayers = {
              ...newPlayers,
              [action.playerId]: { ...casterPost, hp: casterNewHp, alive: casterNewHp > 0 },
            }
            events.push({
              _tag: 'damage',
              tick: state.tick,
              sourceId: pid,
              targetId: action.playerId,
              amount: returnDamage,
              damageType: 'pure',
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

  // result.right.events are wire-format 'ability_cast' events the client
  // doesn't understand — discard them; ability_used/cooldown_used below
  // carry the resolver-set cooldown (the authoritative value).
  const actualCd = newPlayers[action.playerId]?.cooldowns[cmd.ability] ?? 0

  events.push({
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

  return { players: newPlayers, zones: newState.zones }
}
