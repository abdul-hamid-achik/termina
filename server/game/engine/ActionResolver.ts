import { Effect } from 'effect'
import type { GameState, PlayerState, TeamId } from '~~/shared/types/game'
import type { Command, TargetRef } from '~~/shared/types/commands'
import { areAdjacent } from '../map/topology'
import { ZONE_MAP } from '~~/shared/constants/zones'
import { calculatePhysicalDamage, calculateMagicalDamage } from './DamageCalculator'
import { placeWard, canAttackTower } from '../map/zones'
import { HEROES } from '~~/shared/constants/heroes'
import type { GameEngineEvent } from '../protocol/events'
import { buyItem, sellItem } from '../items/shop'
import { awardLastHit, awardTowerKill } from './GoldDistributor'
import { pickupAegis } from './RoshanAI'
import { pickupRune } from './RuneAI'
import { ITEMS } from '../items/registry'
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
  // IN_COMBAT_BUFF_DURATION,
} from '~~/shared/constants/balance'
import type { ItemStats } from '~~/shared/types/items'
import { runAntiCheatChecks, type CheatDetection } from '../../utils/AntiCheat'
import { wsLog } from '../../utils/log'

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

/** Sum up all stat bonuses from a player's equipped items. */
export function getItemStatBonuses(items: (string | null)[]): ItemStats {
  const totals: Required<ItemStats> = {
    hp: 0,
    mp: 0,
    attack: 0,
    defense: 0,
    magicResist: 0,
    moveSpeed: 0,
  }
  for (const itemId of items) {
    if (!itemId) continue
    const item = ITEMS[itemId]
    if (!item) continue
    totals.hp += item.stats.hp ?? 0
    totals.mp += item.stats.mp ?? 0
    totals.attack += item.stats.attack ?? 0
    totals.defense += item.stats.defense ?? 0
    totals.magicResist += item.stats.magicResist ?? 0
    totals.moveSpeed += item.stats.moveSpeed ?? 0
  }
  return totals
}

/** Get effective attack damage for a player (base hero stat + item bonuses). */
function getEffectiveAttack(player: PlayerState, itemStats?: ItemStats): number {
  const hero = player.heroId ? HEROES[player.heroId] : null
  const baseAttack = hero
    ? hero.baseStats.attack + (hero.growthPerLevel.attack ?? 0) * (player.level - 1)
    : 50
  const itemBonus = itemStats?.attack ?? getItemStatBonuses(player.items).attack ?? 0
  return baseAttack + itemBonus
}

/** Get effective defense for a player (base stat + item bonuses). */
function getEffectiveDefense(player: PlayerState, itemStats?: ItemStats): number {
  const itemBonus = itemStats?.defense ?? getItemStatBonuses(player.items).defense ?? 0
  return player.defense + itemBonus
}

/** Get effective magic resist for a player (base stat + item bonuses). */
function getEffectiveMagicResist(player: PlayerState, itemStats?: ItemStats): number {
  const itemBonus = itemStats?.magicResist ?? getItemStatBonuses(player.items).magicResist ?? 0
  return player.magicResist + itemBonus
}

// ── Validation ─────────────────────────────────────────────────

/** Validate an action against the current game state. */
export function validateAction(state: GameState, action: PlayerAction): string | null {
  const player = state.players[action.playerId]
  if (!player) return 'Player not found'
  if (!player.alive) return 'Player is dead'

  const cmd = action.command

  switch (cmd.type) {
    case 'move': {
      if (!areAdjacent(player.zone, cmd.zone) && player.zone !== cmd.zone) {
        return 'Cannot move to non-adjacent zone'
      }
      // Check for root/stun
      if (hasDebuff(player, 'root') || hasDebuff(player, 'stun')) {
        return 'Cannot move while rooted or stunned'
      }
      return null
    }
    case 'attack': {
      if (hasDebuff(player, 'stun')) return 'Cannot attack while stunned'
      return null
    }
    case 'cast': {
      if (hasDebuff(player, 'stun')) return 'Cannot cast while stunned'
      if (hasDebuff(player, 'silence')) return 'Cannot cast while silenced'
      if (!player.heroId) return 'No hero selected'

      const hero = HEROES[player.heroId]
      if (!hero) return 'Unknown hero'

      const ability = hero.abilities[cmd.ability]
      if (!ability) return 'Unknown ability'
      if (player.cooldowns[cmd.ability] > 0) return 'Ability on cooldown'
      if (player.mp < ability.manaCost) return 'Not enough mana'
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
        // Only reject critical violations
        if (violations.some((v) => v.severity === 'critical')) {
          return false
        }
      }

      return true
    })

    let players = { ...state.players }
    const events: GameEngineEvent[] = []
    const heroAttackers = new Map<string, string>()
    const zones = { ...state.zones }
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
      const result = resolveInstantAbility(state, players, action, events, heroAttackers)
      players = result.players
    }

    // Phase 2: Movement — all moves resolve simultaneously
    const moves = validActions.filter((a) => a.command.type === 'move')
    playerUpdates = {}

    for (const action of moves) {
      const cmd = action.command as { type: 'move'; zone: string }
      const player = players[action.playerId]
      if (player && player.alive) {
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

      const creepIdx = cmd.target.index
      const creep = creeps[creepIdx]
      if (!creep || creep.hp <= 0) continue
      if (creep.zone !== denier.zone) continue

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

        const attackerItemStats = getCachedItemStats(action.playerId, attacker.items)
        const targetItemStats = getCachedItemStats(targetId, target.items)

        let attackDamage = getEffectiveAttack(attacker, attackerItemStats)

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
            const chainDamage = calculateMagicalDamage(60, chainTarget.magicResist)
            const chainNewHp = Math.max(0, chainTarget.hp - chainDamage)
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

        if (target.buffs.some((b) => b.id === 'ghost_form')) {
          damage = 0
        }

        let totalDamage = damage
        if (bonusMagicDamage > 0) {
          const magicDmg = calculateMagicalDamage(bonusMagicDamage, target.magicResist)
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

        const newHp = Math.max(0, target.hp - totalDamage)
        let newBuffs = [...target.buffs]

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
          const attackerNewHp = Math.max(0, attacker.hp - returnDamage)
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
        const creepIdx = cmd.target.index
        const creep = creeps[creepIdx]
        if (!creep || creep.hp <= 0) continue
        if (creep.zone !== attacker.zone) continue

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
          targetId: `creep_${creepIdx}`,
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
      }
    }

    // Apply all attack phase updates at once
    players = applyPlayerUpdates(players, playerUpdates)

    // Resolve targeted casts
    for (const action of targetedCasts) {
      const result = resolveTargetedAbility(state, players, action, events, heroAttackers)
      players = result.players
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
            { id: 'spellblock', stacks: 1, ticksRemaining: 12, source: 'linkens_sphere' },
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
    const aegisPickups = validActions.filter((a) => a.command.type === 'aegis')
    for (const action of aegisPickups) {
      const tempState: GameState = {
        ...state,
        players,
        creeps,
        towers,
        runes: state.runes ?? [],
        roshan: state.roshan,
        aegis: state.aegis,
      }
      const result = pickupAegis(tempState, action.playerId)
      players = { ...result.players }
    }

    // Handle rune pickup
    const runePickups = validActions.filter((a) => a.command.type === 'rune')
    for (const action of runePickups) {
      const player = players[action.playerId]
      if (!player) continue
      const tempState: GameState = {
        ...state,
        players,
        creeps,
        towers,
        runes: state.runes ?? [],
        roshan: state.roshan,
        aegis: state.aegis,
      }
      const result = pickupRune(tempState, action.playerId, player.zone)
      players = { ...result.players }
    }

    // Recalculate maxHp/maxMp based on items
    for (const [pid, player] of Object.entries(players)) {
      const hero = player.heroId ? HEROES[player.heroId] : null
      if (!hero) continue
      const baseMaxHp = hero.baseStats.hp + (hero.growthPerLevel.hp ?? 0) * (player.level - 1)
      const baseMaxMp = hero.baseStats.mp + (hero.growthPerLevel.mp ?? 0) * (player.level - 1)
      const itemBonuses = getItemStatBonuses(player.items)
      const newMaxHp = baseMaxHp + (itemBonuses.hp ?? 0)
      const newMaxMp = baseMaxMp + (itemBonuses.mp ?? 0)
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
    }

    return { state: updatedState, events, heroAttackers }
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

function resolveInstantAbility(
  state: GameState,
  players: Record<string, PlayerState>,
  action: PlayerAction,
  events: GameEngineEvent[],
  heroAttackers: Map<string, string>,
): { players: Record<string, PlayerState> } {
  const cmd = action.command as { type: 'cast'; ability: 'q' | 'w' | 'e' | 'r'; target?: TargetRef }
  const caster = players[action.playerId]
  if (!caster?.heroId) return { players }

  const hero = HEROES[caster.heroId]
  if (!hero) return { players }

  const ability = hero.abilities[cmd.ability]
  if (!ability) return { players }

  // Deduct mana, set cooldown
  let updatedPlayers = {
    ...players,
    [action.playerId]: {
      ...caster,
      mp: caster.mp - ability.manaCost,
      cooldowns: { ...caster.cooldowns, [cmd.ability]: ability.cooldownTicks },
    },
  }

  const cooldownTicks = ability.cooldownTicks
  events.push({
    _tag: 'ability_used',
    tick: state.tick,
    playerId: action.playerId,
    abilityId: ability.id,
    cooldown: cooldownTicks,
  })

  // Also emit detailed cooldown event for UI tracking
  events.push({
    _tag: 'cooldown_used',
    tick: state.tick,
    playerId: action.playerId,
    abilityId: cmd.ability,
    cooldownTicks,
    readyAtTick: state.tick + cooldownTicks,
  })

  // Apply effects
  for (const effect of ability.effects) {
    if (effect.type === 'stun' || effect.type === 'silence' || effect.type === 'root') {
      // Apply to target or all enemies in zone
      if (cmd.target?.kind === 'hero') {
        const targetId = findHeroByName(updatedPlayers, cmd.target.name)
        if (targetId) {
          const ccTarget = updatedPlayers[targetId]
          if (ccTarget && ccTarget.zone === caster.zone) {
            updatedPlayers = applyBuffToPlayer(
              updatedPlayers,
              targetId,
              effect.type,
              effect.duration ?? 1,
              caster.id,
            )
          }
        }
      } else {
        // AoE: apply to all enemies in zone
        for (const [pid, p] of Object.entries(updatedPlayers)) {
          if (p.zone === caster.zone && p.team !== caster.team && p.alive) {
            updatedPlayers = applyBuffToPlayer(
              updatedPlayers,
              pid,
              effect.type,
              effect.duration ?? 1,
              caster.id,
            )
          }
        }
      }
    }
    if (effect.type === 'damage') {
      const dmgType = effect.damageType ?? 'magical'
      if (cmd.target?.kind === 'hero') {
        const targetId = findHeroByName(updatedPlayers, cmd.target.name)
        if (targetId && updatedPlayers[targetId]) {
          const target = updatedPlayers[targetId]!
          if (target.zone === caster.zone && target.alive) {
            const dmg =
              dmgType === 'physical'
                ? calculatePhysicalDamage(effect.value, getEffectiveDefense(target))
                : calculateMagicalDamage(effect.value, getEffectiveMagicResist(target))
            const newHp = Math.max(0, target.hp - dmg)
            updatedPlayers = {
              ...updatedPlayers,
              [targetId]: { ...target, hp: newHp, alive: newHp > 0 },
            }
            heroAttackers.set(action.playerId, targetId)
            events.push({
              _tag: 'damage',
              tick: state.tick,
              sourceId: action.playerId,
              targetId,
              amount: dmg,
              damageType: dmgType,
            })
          }
        }
      }
    }
  }

  return { players: updatedPlayers }
}

function resolveTargetedAbility(
  state: GameState,
  players: Record<string, PlayerState>,
  action: PlayerAction,
  events: GameEngineEvent[],
  heroAttackers: Map<string, string>,
): { players: Record<string, PlayerState> } {
  const cmd = action.command as { type: 'cast'; ability: 'q' | 'w' | 'e' | 'r'; target?: TargetRef }
  const caster = players[action.playerId]
  if (!caster?.heroId) return { players }

  const hero = HEROES[caster.heroId]
  if (!hero) return { players }

  const ability = hero.abilities[cmd.ability]
  if (!ability) return { players }

  // Deduct mana, set cooldown
  let updatedPlayers = {
    ...players,
    [action.playerId]: {
      ...caster,
      mp: caster.mp - ability.manaCost,
      cooldowns: { ...caster.cooldowns, [cmd.ability]: ability.cooldownTicks },
    },
  }

  const cooldownTicks = ability.cooldownTicks
  events.push({
    _tag: 'ability_used',
    tick: state.tick,
    playerId: action.playerId,
    abilityId: ability.id,
    cooldown: cooldownTicks,
  })

  // Also emit detailed cooldown event for UI tracking
  events.push({
    _tag: 'cooldown_used',
    tick: state.tick,
    playerId: action.playerId,
    abilityId: cmd.ability,
    cooldownTicks,
    readyAtTick: state.tick + cooldownTicks,
  })

  // Apply damage effects
  for (const effect of ability.effects) {
    if (effect.type === 'damage') {
      const dmgType = effect.damageType ?? 'magical'
      if (cmd.target?.kind === 'hero') {
        const targetId = findHeroByName(updatedPlayers, cmd.target.name)
        if (targetId && updatedPlayers[targetId]) {
          const target = updatedPlayers[targetId]!
          if (target.zone === caster.zone && target.alive) {
            const dmg =
              dmgType === 'physical'
                ? calculatePhysicalDamage(effect.value, getEffectiveDefense(target))
                : calculateMagicalDamage(effect.value, getEffectiveMagicResist(target))
            const newHp = Math.max(0, target.hp - dmg)
            updatedPlayers = {
              ...updatedPlayers,
              [targetId]: { ...target, hp: newHp, alive: newHp > 0 },
            }
            heroAttackers.set(action.playerId, targetId)
            events.push({
              _tag: 'damage',
              tick: state.tick,
              sourceId: action.playerId,
              targetId,
              amount: dmg,
              damageType: dmgType,
            })
          }
        }
      } else if (ability.targetType === 'none') {
        // AoE damage to all enemies in zone
        for (const [pid, p] of Object.entries(updatedPlayers)) {
          if (
            p.zone === caster.zone &&
            p.team !== caster.team &&
            p.alive &&
            pid !== action.playerId
          ) {
            const dmg =
              dmgType === 'physical'
                ? calculatePhysicalDamage(effect.value, getEffectiveDefense(p))
                : calculateMagicalDamage(effect.value, getEffectiveMagicResist(p))
            const newHp = Math.max(0, p.hp - dmg)
            updatedPlayers = {
              ...updatedPlayers,
              [pid]: { ...p, hp: newHp, alive: newHp > 0 },
            }
            heroAttackers.set(action.playerId, pid)
            events.push({
              _tag: 'damage',
              tick: state.tick,
              sourceId: action.playerId,
              targetId: pid,
              amount: dmg,
              damageType: dmgType,
            })
          }
        }
      }
    }
    if (effect.type === 'heal' && cmd.target?.kind === 'hero') {
      const targetId = findHeroByName(updatedPlayers, cmd.target.name)
      if (targetId && updatedPlayers[targetId]) {
        const target = updatedPlayers[targetId]!
        if (target.team !== caster.team) continue
        const newHp = Math.min(target.maxHp, target.hp + effect.value)
        updatedPlayers = {
          ...updatedPlayers,
          [targetId]: { ...target, hp: newHp },
        }
        events.push({
          _tag: 'heal',
          tick: state.tick,
          sourceId: action.playerId,
          targetId,
          amount: effect.value,
        })
      }
    }
    if (effect.type === 'shield' || effect.type === 'buff') {
      if (cmd.target?.kind === 'hero') {
        const targetId = findHeroByName(updatedPlayers, cmd.target.name)
        if (targetId) {
          updatedPlayers = applyBuffToPlayer(
            updatedPlayers,
            targetId,
            effect.type,
            effect.duration ?? 1,
            caster.id,
          )
        }
      } else if (cmd.target?.kind === 'self' || ability.targetType === 'self') {
        updatedPlayers = applyBuffToPlayer(
          updatedPlayers,
          action.playerId,
          effect.type,
          effect.duration ?? 1,
          caster.id,
        )
      }
    }
  }

  return { players: updatedPlayers }
}

// ── Helpers ────────────────────────────────────────────────────

function findHeroByName(players: Record<string, PlayerState>, name: string): string | null {
  for (const [id, p] of Object.entries(players)) {
    if (p.name === name || p.id === name || p.heroId === name) return id
  }
  return null
}

function applyBuffToPlayer(
  players: Record<string, PlayerState>,
  playerId: string,
  type: string,
  duration: number,
  sourceId: string,
): Record<string, PlayerState> {
  const player = players[playerId]
  if (!player) return players

  return {
    ...players,
    [playerId]: {
      ...player,
      buffs: [...player.buffs, { id: type, stacks: 1, ticksRemaining: duration, source: sourceId }],
    },
  }
}
