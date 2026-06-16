import { Effect, Either } from 'effect'
import type { CreepState, GameState, PlayerState, TeamId } from '~~/shared/types/game'
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
import { ZONE_MAP } from '~~/shared/constants/zones'
import {
  calculatePhysicalDamage,
  calculateMagicalDamage,
  getIncomingDamageMultiplier,
  isDamageImmune,
} from './DamageCalculator'
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
  MKB_BONUS_DAMAGE,
  RING_OF_HEALTH_REGEN_PERCENT,
  SOBI_MASK_REGEN_PERCENT,
  HEART_REGEN_PERCENT,
  SELL_REFUND_RATIO,
  // IN_COMBAT_BUFF_DURATION,
} from '~~/shared/constants/balance'
import type { ItemStats } from '~~/shared/types/items'
import { runAntiCheatChecks, type CheatDetection } from '~~/server/utils/AntiCheat'
import { wsLog } from '~~/server/utils/log'

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

// ── Item Stat Bonuses ─────────────────────────────────────────

// Implementation moved to EffectiveStats (single authority for combat stats);
// re-exported here for backward compatibility.
export { getItemStatBonuses } from './EffectiveStats'

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

  const cmd = action.command

  switch (cmd.type) {
    case 'move': {
      if (!areAdjacent(player.zone, cmd.zone) && player.zone !== cmd.zone) {
        return 'Cannot move to non-adjacent zone'
      }
      // Check for root/stun (taunt forces attacking — no fleeing)
      if (hasDebuff(player, 'root') || hasDebuff(player, 'stun')) {
        return 'Cannot move while rooted or stunned'
      }
      if (hasDebuff(player, 'taunt')) return 'Cannot move while taunted'
      return null
    }
    case 'attack': {
      if (hasDebuff(player, 'stun')) return 'Cannot attack while stunned'
      if (hasDebuff(player, 'feared')) return 'Cannot attack while feared'
      return null
    }
    case 'cast': {
      if (hasDebuff(player, 'stun')) return 'Cannot cast while stunned'
      if (hasDebuff(player, 'silence')) return 'Cannot cast while silenced'
      if (hasDebuff(player, 'feared')) return 'Cannot cast while feared'
      if (hasDebuff(player, 'taunt')) return 'Cannot cast while taunted'
      if (!player.heroId) return 'No hero selected'

      const hero = HEROES[player.heroId]
      if (!hero) return 'Unknown hero'

      const ability = hero.abilities[cmd.ability]
      if (!ability) return 'Unknown ability'
      // Auto-leveling gate: Q/W/E unlock at level 1, R at level 6 (_base.getAbilityLevel)
      if (getAbilityLevel(player.level, cmd.ability) < 1) {
        return cmd.ability === 'r' ? 'Ultimate unlocks at level 6' : 'Ability not yet learned'
      }
      if (player.cooldowns[cmd.ability] > 0) return 'Ability on cooldown'
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

function hasDebuff(player: PlayerState, type: string): boolean {
  return player.buffs.some((b) => b.id.includes(type))
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
    // Run anti-cheat validation on all actions
    const cheatDetections: Array<{
      playerId: string
      command: Command
      violations: CheatDetection[]
    }> = []
    const validActions = actions.filter((a) => {
      const validationError = validateAction(state, a)
      if (validationError) {
        wsLog.debug('Action validation failed', {
          playerId: a.playerId,
          command: a.command.type,
          error: validationError,
        })
        return false
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
    const creeps = [...state.creeps]
    let neutrals = [...(state.neutrals ?? [])]
    let towers = [...state.towers]
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

    // Batch update accumulator
    let playerUpdates: PlayerUpdates = {}

    // Phase 1: Instant abilities (stuns, silences)
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
      )
      players = result.players
      zones = result.zones
    }

    // Phase 2: Movement — all moves resolve simultaneously
    const moves = validActions.filter((a) => a.command.type === 'move')
    playerUpdates = {}

    for (const action of moves) {
      const cmd = action.command as { type: 'move'; zone: string }
      const player = players[action.playerId]
      if (player && player.alive) {
        // Slow semantics: total slow stacks = % chance the move fails this
        // tick (capped at 80%). Root/stun/taunt are hard-blocked upstream in
        // validateAction. The Haste rune ('haste' buff) makes movement
        // unstoppable — it ignores slow entirely.
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
            tick: state.tick,
            playerId: action.playerId,
            reason: 'movement',
          })
        }

        playerUpdates[action.playerId] = playerUpdates[action.playerId]
          ? { ...playerUpdates[action.playerId], ...updates }
          : updates
      }
    }
    players = applyPlayerUpdates(players, playerUpdates)

    // Phase 3: Attacks + targeted abilities — simultaneous
    const attacks = validActions.filter((a) => a.command.type === 'attack')
    const denies = validActions.filter((a) => a.command.type === 'deny')
    const targetedCasts = validActions.filter(
      (a) =>
        a.command.type === 'cast' &&
        !isInstantAbility(
          players[a.playerId]!,
          a.command as { type: 'cast'; ability: 'q' | 'w' | 'e' | 'r' },
        ),
    )

    // Process denies — allied creeps below 50% HP
    playerUpdates = {}
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
        tick: state.tick,
        playerId: action.playerId,
        creepId: creep.id,
        creepType: creep.type,
        goldAwarded: denyGold,
      })
    }
    players = applyPlayerUpdates(players, playerUpdates)

    for (const action of attacks) {
      const cmd = action.command as { type: 'attack'; target: TargetRef }
      const attacker = players[action.playerId]
      if (!attacker || !attacker.alive) continue

      if (cmd.target.kind === 'hero') {
        const targetId = findHeroByNameCached(cmd.target.name)
        if (!targetId) continue
        const target = players[targetId]
        if (!target || !target.alive) continue

        if (target.zone !== attacker.zone) continue
        if (target.team === attacker.team) continue

        // Damage from earlier attackers this phase must stack — read pending
        // hp/buffs so simultaneous focus-fire isn't last-write-wins.
        const targetPendingHp = (playerUpdates[targetId]?.hp as number | undefined) ?? target.hp
        const targetPendingBuffs =
          (playerUpdates[targetId]?.buffs as typeof target.buffs | undefined) ?? target.buffs

        const attackerItemStats = getCachedItemStats(action.playerId, attacker.items)
        const targetItemStats = getCachedItemStats(targetId, target.items)

        // Multiplicative stack buffs (resonance/hopCount/fullTrace) apply to
        // basic attacks on heroes only — never to ability damage.
        let attackDamage = Math.round(
          getEffectiveAttack(attacker, attackerItemStats) * getAttackMultiplier(attacker),
        )

        let critMultiplier = 1

        if (attacker.items.includes('null_pointer') && Math.random() < NULL_POINTER_CRIT_CHANCE) {
          critMultiplier = NULL_POINTER_CRIT_MULTIPLIER
        } else if (attacker.items.includes('crystalys') && Math.random() < CRYSTALYS_CRIT_CHANCE) {
          critMultiplier = CRYSTALYS_CRIT_MULTIPLIER
        } else if (attacker.items.includes('daedalus') && Math.random() < DAEDALUS_CRIT_CHANCE) {
          critMultiplier = DAEDALUS_CRIT_MULTIPLIER
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
            // Maelstrom's chain is magical: blocked by magic immunity, amped by
            // the chain target's magic-vuln / Yield.
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

        const silverEdgeBonus = attacker.buffs.find((b) => b.id === 'silver_edge_bonus')
        if (silverEdgeBonus) {
          attackDamage += silverEdgeBonus.stacks
        }

        let defense = getEffectiveDefense(target, targetItemStats)

        if (attacker.items.includes('desolator')) {
          defense = Math.max(0, defense - DESOLATOR_ARMOR_REDUCTION)
        }

        for (const [, zonePlayer] of Object.entries(players)) {
          if (
            zonePlayer.zone === target.zone &&
            zonePlayer.team !== target.team &&
            zonePlayer.items.includes('assault_cuirass')
          ) {
            defense = Math.max(0, defense - DESOLATOR_ARMOR_REDUCTION)
            break
          }
        }

        let blockedDamage = 0
        if (target.items.includes('vanguard') && Math.random() < VANGUARD_BLOCK_CHANCE) {
          blockedDamage = VANGUARD_BLOCK_AMOUNT
        }

        let damage = calculatePhysicalDamage(attackDamage, defense)
        damage = Math.max(0, damage - blockedDamage)

        // Physical immunity (Ghost/Ethereal/invulnerable) zeroes the attack;
        // otherwise target-side amps (thread Yield) raise it.
        if (isDamageImmune(target, 'physical')) {
          damage = 0
        } else {
          damage = Math.round(damage * getIncomingDamageMultiplier(target, 'physical'))
        }

        let totalDamage = damage
        // On-hit magic (MKB etc.) is blocked by magic immunity (BKB/invulnerable)
        // and amplified by magic-vuln / Yield.
        if (bonusMagicDamage > 0 && !isDamageImmune(target, 'magical')) {
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

        // Kernel passive 'hardened' — same 10% reduction constant as
        // _base.dealDamage, applied before shield absorption.
        if (targetPendingBuffs.some((b) => b.id === 'hardened')) {
          totalDamage = Math.round(totalDamage * 0.9)
        }

        // Phase shift (Echo W) dodges the hit entirely; otherwise 'shield'
        // buff stacks absorb HP loss. The emitted damage event below keeps
        // the pre-shield mitigated amount on purpose — absorbed hits still
        // grant assist credit (ability damage events are post-shield; see
        // resolveHeroCast).
        let newBuffs = [...targetPendingBuffs]
        let hpLoss = totalDamage
        if (targetPendingBuffs.some((b) => b.id === 'phaseShift')) {
          hpLoss = 0
          newBuffs = newBuffs.filter((b) => b.id !== 'phaseShift')
        } else {
          const absorbed = absorbShield(newBuffs, totalDamage)
          newBuffs = [...absorbed.buffs]
          hpLoss = absorbed.remaining
        }

        const newHp = Math.max(0, targetPendingHp - hpLoss)

        if (attacker.items.includes('skull_basher') && Math.random() < 0.25) {
          newBuffs.push({ id: 'stun', stacks: 1, ticksRemaining: 1, source: attacker.id })
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
          const returnDamage = Math.round(damage)
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
        if (tower.zone !== attacker.zone) continue
        if (tower.invulnerable) {
          events.push({
            _tag: 'tower_invulnerable',
            tick: state.tick,
            zone: tower.zone,
          })
          continue
        }
        if (!canAttackTower(towers, targetZone)) continue

        const attackerItemStats = getCachedItemStats(action.playerId, attacker.items)
        const attackDamage = getEffectiveAttack(attacker, attackerItemStats)
        const newHp = Math.max(0, tower.hp - attackDamage)

        towers = towers.map((t) =>
          t.zone === tower.zone && t.team === tower.team
            ? { ...t, hp: newHp, alive: newHp > 0 }
            : t,
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
        if (attacker.zone !== 'roshan-pit') continue

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
        if (neutral.zone !== attacker.zone) continue

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
        // Heroes must stand in the enemy base to hit the Ancient
        if (attacker.zone !== ANCIENT_ZONES[enemyTeam]) continue

        const attackerItemStats = getCachedItemStats(action.playerId, attacker.items)
        const attackDamage = getEffectiveAttack(attacker, attackerItemStats)

        // Vulnerability (T3 down) and alive checks live in AncientSystem
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
          continue
        }

        ancients = result.state.ancients
        events.push(...result.events)

        const adt = damageTracker.get(action.playerId) ?? { hero: 0, tower: 0 }
        adt.tower += attackDamage
        damageTracker.set(action.playerId, adt)
      }
    }

    // Apply all attack phase updates at once
    players = applyPlayerUpdates(players, playerUpdates)

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
      )
      players = result.players
      zones = result.zones
    }

    // Phase 4: Passive effects, cooldown ticks, item passives
    playerUpdates = {}
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

      // Healing Salve regen (buff applied by useItem; ticked down in GameLoop)
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
        // Re-arm only when no spellblock buff remains. A SPENT charge lingers as
        // stacks 0 for LINKENS_RECHARGE_TICKS (set on block), gating re-arm.
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
    players = applyPlayerUpdates(players, playerUpdates)

    // Phase 5: Buy/Sell
    const buys = validActions.filter((a) => a.command.type === 'buy')
    for (const action of buys) {
      const cmd = action.command as { type: 'buy'; item: string }
      const tempState: GameState = { ...state, players, creeps, towers }
      const result = Effect.runSync(
        buyItem(tempState, action.playerId, cmd.item).pipe(Effect.orElseSucceed(() => null)),
      )
      if (result) {
        players = { ...result.players }
        // Confirm the purchase in the combat log (the item_purchased path is
        // fully wired client-side; the buyer always sees their own purchase).
        events.push({
          _tag: 'item_purchased',
          tick: state.tick,
          playerId: action.playerId,
          itemId: cmd.item,
          cost: ITEMS[cmd.item]?.cost ?? 0,
        })
      }
    }

    const sells = validActions.filter((a) => a.command.type === 'sell')
    for (const action of sells) {
      const cmd = action.command as { type: 'sell'; item: string }
      const player = players[action.playerId]
      if (!player) continue
      const slotIdx = player.items.indexOf(cmd.item)
      if (slotIdx === -1) continue
      const tempState: GameState = { ...state, players, creeps, towers }
      const result = Effect.runSync(
        sellItem(tempState, action.playerId, slotIdx).pipe(Effect.orElseSucceed(() => null)),
      )
      if (result) {
        players = { ...result.players }
        // Confirm the sale in the combat log, mirroring the buy path. Refund
        // matches sellItem's (cost * SELL_REFUND_RATIO, floored).
        events.push({
          _tag: 'item_sold',
          tick: state.tick,
          playerId: action.playerId,
          itemId: cmd.item,
          refund: Math.floor((ITEMS[cmd.item]?.cost ?? 0) * SELL_REFUND_RATIO),
        })
      }
    }

    // Phase 5b: Use item actives (blink, BKB, salves, TP scrolls, ...)
    const uses = validActions.filter((a) => a.command.type === 'use')
    for (const action of uses) {
      const cmd = action.command as { type: 'use'; item: string; target?: TargetRef | string }
      const tempState: GameState = { ...state, players, zones, creeps, towers, ancients }
      const result = Effect.runSync(
        useItem(tempState, action.playerId, cmd.item, cmd.target).pipe(
          Effect.match({
            // Rejection feedback mirrors the validation-failure logging above;
            // validateAction already surfaced ownership/cooldown errors to the
            // player via GameLoop's rejectedActions.
            onFailure: (error) => {
              wsLog.debug('Item use rejected', {
                playerId: action.playerId,
                item: cmd.item,
                reason: error._tag,
              })
              return null
            },
            onSuccess: (updated): GameState | null => updated,
          }),
        ),
      )
      if (result) {
        players = { ...result.players }
        zones = { ...result.zones }
        events.push({
          _tag: 'ability_used',
          tick: state.tick,
          playerId: action.playerId,
          abilityId: ITEMS[cmd.item]?.active?.id ?? cmd.item,
        })
      }
    }

    // Handle glyph commands
    let teams = { ...state.teams }
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

      teams = {
        ...teams,
        [team]: { ...teamState, glyphUsedTick: state.tick },
      }

      events.push({
        _tag: 'glyph_used',
        tick: state.tick,
        team,
      })
    }

    // Handle aegis pickup
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
      players = { ...result.players }
      // On a successful pickup pickupAegis nulls the ground aegis — thread that
      // through (so it can't be picked up twice) and surface the event.
      if (result.aegis !== tempState.aegis) {
        aegisGround = result.aegis
        events.push({ _tag: 'aegis_picked', tick: state.tick, playerId: action.playerId })
      }
    }

    // Handle rune pickup. Mirror the aegis path: thread the rune removal back
    // (so a picked rune leaves the ground and can't be re-claimed for repeat
    // buffs) AND surface the rune_picked event for the combat log.
    let runesGround = state.runes ?? []
    const runePickups = validActions.filter((a) => a.command.type === 'rune')
    for (const action of runePickups) {
      const player = players[action.playerId]
      if (!player) continue
      const runeHere = runesGround.find((r) => r.zone === player.zone)
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
      players = { ...result.players }
      if (result.runes.length !== runesGround.length) {
        runesGround = result.runes
        if (runeHere) {
          events.push({
            _tag: 'rune_picked',
            tick: state.tick,
            playerId: action.playerId,
            zone: player.zone,
            runeType: runeHere.type,
          })
        }
      }
    }

    // Recalculate maxHp/maxMp based on items + talents
    for (const [pid, player] of Object.entries(players)) {
      const hero = player.heroId ? HEROES[player.heroId] : null
      if (!hero) continue
      const baseMaxHp = hero.baseStats.hp + (hero.growthPerLevel.hp ?? 0) * (player.level - 1)
      const baseMaxMp = hero.baseStats.mp + (hero.growthPerLevel.mp ?? 0) * (player.level - 1)
      const itemBonuses = getCachedItemStats(pid, player.items)
      // Power Treads toggle: the active mode rides as a buff (power_treads_hp/mp);
      // fold it into maxHp/maxMp so the toggle actually does something.
      const treadsHp = player.buffs.find((b) => b.id === 'power_treads_hp')?.stacks ?? 0
      const treadsMp = player.buffs.find((b) => b.id === 'power_treads_mp')?.stacks ?? 0
      const newMaxHp =
        baseMaxHp + (itemBonuses.hp ?? 0) + getTalentStatBonus(player, 'hp') + treadsHp
      const newMaxMp =
        baseMaxMp + (itemBonuses.mp ?? 0) + getTalentStatBonus(player, 'mp') + treadsMp
      if (newMaxHp !== player.maxHp || newMaxMp !== player.maxMp) {
        // Preserve HP/MP percentage when max changes to avoid losing HP on item sell
        const hpPercent = player.maxHp > 0 ? player.hp / player.maxHp : 1
        const mpPercent = player.maxMp > 0 ? player.mp / player.maxMp : 1
        const newHp = Math.floor(newMaxHp * hpPercent)
        const newMp = Math.floor(newMaxMp * mpPercent)

        players = {
          ...players,
          [pid]: {
            ...player,
            maxHp: newMaxHp,
            maxMp: newMaxMp,
            hp: newHp,
            mp: newMp,
          },
        }
      }
    }

    // Award gold and XP for creep last-hits
    for (const kill of creepKills) {
      const tempState: GameState = { ...state, players, creeps, towers }
      const awarded = awardLastHit(tempState, kill.playerId, kill.creepType)
      players = { ...awarded.players }
      // Award XP for creep kill
      const killer = players[kill.playerId]
      if (killer) {
        players = { ...players, [kill.playerId]: { ...killer, xp: killer.xp + CREEP_XP } }
      }
    }

    // Award gold and XP for neutral creep kills
    for (const kill of neutralKills) {
      const neutral = neutrals.find((n) => n.id === kill.neutralId)
      if (!neutral) continue
      const stats = NEUTRAL_CREEPS[neutral.type as NeutralCreepType]
      if (!stats) continue

      const killer = players[kill.playerId]
      if (killer) {
        // Award gold and XP
        const updatedKiller: PlayerState = {
          ...killer,
          gold: killer.gold + stats.gold,
          xp: killer.xp + stats.xp,
        }
        players = { ...players, [kill.playerId]: updatedKiller }

        events.push({
          _tag: 'neutral_killed' as const,
          tick: state.tick,
          playerId: kill.playerId,
          neutralId: neutral.id,
          neutralType: neutral.type,
          zone: neutral.zone,
        })
      }

      // Remove the dead neutral
      neutrals = neutrals.filter((n) => n.id !== kill.neutralId)
    }

    // Award gold for tower kills
    for (const kill of towerKills) {
      const nearbyAllies = Object.entries(players)
        .filter(([, p]) => p.zone === kill.zone && p.team !== kill.team && p.alive)
        .map(([id]) => id)
      const tempState: GameState = { ...state, players, creeps, towers }
      const awarded = awardTowerKill(tempState, kill.zone, nearbyAllies)
      players = { ...awarded.players }
    }

    // Apply damage tracking to player states
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

    // Handle ward placements
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
    const reason =
      err._tag === 'InsufficientManaError'
        ? `Not enough mana (need ${err.required})`
        : err._tag === 'CooldownError'
          ? 'Ability on cooldown'
          : err.reason
    rejected.push({ playerId: action.playerId, reason })
    return { players, zones }
  }

  const newState = result.right.state
  let newPlayers = newState.players
  const abilityDef = HEROES[caster.heroId]?.abilities[cmd.ability]
  const damageType = abilityDef?.damageType ?? 'magical'

  // Resolve the targeted hero id (used by the block check + ability_used event).
  let targetId: string | undefined
  if (cmd.target?.kind === 'hero') {
    const needle = cmd.target.name.toLowerCase()
    for (const [id, p] of Object.entries(newPlayers)) {
      if (
        p.id.toLowerCase() === needle ||
        p.name.toLowerCase() === needle ||
        p.heroId?.toLowerCase() === needle
      ) {
        targetId = id
        break
      }
    }
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
