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
import { CREEP_XP, NEUTRAL_CREEPS, type NeutralCreepType } from '~~/shared/constants/balance'
import type { ItemStats } from '~~/shared/types/items'

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

// ── Item Stat Bonuses ─────────────────────────────────────────

/** Sum up all stat bonuses from a player's equipped items. */
export function getItemStatBonuses(items: (string | null)[]): ItemStats {
  const totals: Required<ItemStats> = { hp: 0, mp: 0, attack: 0, defense: 0, magicResist: 0, moveSpeed: 0 }
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
function getEffectiveAttack(player: PlayerState): number {
  const hero = player.heroId ? HEROES[player.heroId] : null
  const baseAttack = hero ? hero.baseStats.attack + (hero.growthPerLevel.attack ?? 0) * (player.level - 1) : 50
  const itemBonus = getItemStatBonuses(player.items).attack ?? 0
  return baseAttack + itemBonus
}

/** Get effective defense for a player (base stat + item bonuses). */
function getEffectiveDefense(player: PlayerState): number {
  const itemBonus = getItemStatBonuses(player.items).defense ?? 0
  return player.defense + itemBonus
}

/** Get effective magic resist for a player (base stat + item bonuses). */
function getEffectiveMagicResist(player: PlayerState): number {
  const itemBonus = getItemStatBonuses(player.items).magicResist ?? 0
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
    // Filter to valid actions only
    const validActions = actions.filter((a) => validateAction(state, a) === null)

    let players = { ...state.players }
    const events: GameEngineEvent[] = []
    const heroAttackers = new Map<string, string>()
    const zones = { ...state.zones }
    const creeps = [...state.creeps]
    let neutrals = [...state.neutrals]
    let towers = [...state.towers]
    const creepKills: Array<{ playerId: string; creepType: 'melee' | 'ranged' | 'siege' }> = []
    const neutralKills: Array<{ playerId: string; neutralId: string }> = []
    const towerKills: Array<{ zone: string; team: TeamId }> = []
    // Track damage dealt per player for post-game stats
    const damageTracker = new Map<string, { hero: number; tower: number }>()

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

    for (const action of moves) {
      const cmd = action.command as { type: 'move'; zone: string }
      const player = players[action.playerId]
      if (player && player.alive) {
        players = {
          ...players,
          [action.playerId]: { ...player, zone: cmd.zone },
        }
      }
    }

    // Phase 3: Attacks + targeted abilities — simultaneous
    const attacks = validActions.filter((a) => a.command.type === 'attack')
    const targetedCasts = validActions.filter(
      (a) =>
        a.command.type === 'cast' &&
        !isInstantAbility(
          players[a.playerId]!,
          a.command as { type: 'cast'; ability: 'q' | 'w' | 'e' | 'r' },
        ),
    )

    for (const action of attacks) {
      const cmd = action.command as { type: 'attack'; target: TargetRef }
      const attacker = players[action.playerId]
      if (!attacker || !attacker.alive) continue

      if (cmd.target.kind === 'hero') {
        const targetId = findHeroByName(players, cmd.target.name)
        if (!targetId) continue
        const targetPlayer = players[targetId]
        if (!targetPlayer || !targetPlayer.alive) continue
        let target = targetPlayer

        // Check if target is in the same zone (post-movement)
        if (target.zone !== attacker.zone) continue

        // Prevent friendly fire
        if (target.team === attacker.team) continue

        // Attack hit — use effective stats (base + level scaling + items)
        let attackDamage = getEffectiveAttack(attacker)

        // ── Item passive: Critical strikes ──
        let critMultiplier = 1

        // Null Pointer: 15% chance, 2x damage
        if (attacker.items.includes('null_pointer') && Math.random() < 0.15) {
          critMultiplier = 2
        }
        // Crystalys: 20% chance, 1.75x damage (cheaper, weaker)
        else if (attacker.items.includes('crystalys') && Math.random() < 0.20) {
          critMultiplier = 1.75
        }
        // Daedalus: 30% chance, 2.4x damage (upgrades Crystalys)
        else if (attacker.items.includes('daedalus') && Math.random() < 0.30) {
          critMultiplier = 2.4
        }

        attackDamage = Math.round(attackDamage * critMultiplier)

        // ── Item passive: Monkey King Bar (true strike + bonus magical) ──
        let bonusMagicDamage = 0
        if (attacker.items.includes('monkey_king_bar')) {
          bonusMagicDamage = 50 // Added as separate magical damage
        }

        // ── Item passive: Skull Basher (25% bash) ──
        if (attacker.items.includes('skull_basher') && Math.random() < 0.25) {
          // Apply stun buff to target (will be processed later)
        }

        // ── Item passive: Maelstrom chain lightning (25% chance) ──
        if (attacker.items.includes('maelstrom') && Math.random() < 0.25) {
          // Find another enemy in zone to chain to
          const chainTargets = Object.values(players).filter(
            (p) => p.zone === attacker.zone && p.team !== attacker.team && p.alive && p.id !== target.id,
          )
          if (chainTargets.length > 0) {
            const chainTarget = chainTargets[Math.floor(Math.random() * chainTargets.length)]!
            const chainDamage = calculateMagicalDamage(60, chainTarget.magicResist)
            const chainNewHp = Math.max(0, chainTarget.hp - chainDamage)
            players = {
              ...players,
              [chainTarget.id]: { ...chainTarget, hp: chainNewHp, alive: chainNewHp > 0 },
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

        // ── Item passive: Silver Edge bonus damage from invis ──
        const silverEdgeBonus = attacker.buffs.find((b) => b.id === 'silver_edge_bonus')
        if (silverEdgeBonus) {
          attackDamage += silverEdgeBonus.stacks
        }

        let defense = getEffectiveDefense(target)

        // ── Item passive: Desolator (armor reduction on hit) ──
        if (attacker.items.includes('desolator')) {
          defense = Math.max(0, defense - 5) // -5 defense for this attack
          // Apply debuff for future attacks
          const corruptionDebuff = { id: 'corruption', stacks: 5, ticksRemaining: 3, source: attacker.id }
          target = { ...target, buffs: [...target.buffs, corruptionDebuff] }
        }

        // ── Item passive: Assault Cuirass enemy armor reduction ──
        // Check if any enemy in zone has assault_cuirass (aura affects us)
        for (const [, zonePlayer] of Object.entries(players)) {
          if (zonePlayer.zone === target.zone && zonePlayer.team !== target.team && zonePlayer.items.includes('assault_cuirass')) {
            defense = Math.max(0, defense - 5)
            break
          }
        }

        // ── Item passive: Vanguard damage block (on target) ──
        let blockedDamage = 0
        if (target.items.includes('vanguard') && Math.random() < 0.60) {
          blockedDamage = 50
        }

        // Calculate final damage
        let damage = calculatePhysicalDamage(attackDamage, defense)
        damage = Math.max(0, damage - blockedDamage)

        // ── Item passive: Ghost form (immune to physical) ──
        if (target.buffs.some((b) => b.id === 'ghost_form')) {
          damage = 0 // Physical damage is nullified
        }

        // Apply bonus magical damage from MKB
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
        let updatedTarget: PlayerState = { ...target, hp: newHp, alive: newHp > 0 }

        // ── Item passive: Skull Basher stun application ──
        if (attacker.items.includes('skull_basher') && Math.random() < 0.25) {
          updatedTarget = {
            ...updatedTarget,
            buffs: [...updatedTarget.buffs, { id: 'stun', stacks: 1, ticksRemaining: 1, source: attacker.id }],
          }
        }

        // ── Item passive: Blade Mail damage return ──
        if (target.buffs.some((b) => b.id === 'blade_mail')) {
          const returnDamage = Math.round(damage) // 100% return
          const attackerNewHp = Math.max(0, attacker.hp - returnDamage)
          players = {
            ...players,
            [action.playerId]: { ...attacker, hp: attackerNewHp, alive: attackerNewHp > 0 },
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

        players = {
          ...players,
          [targetId]: updatedTarget,
        }

        heroAttackers.set(action.playerId, targetId)

        // Track hero damage dealt
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

        const attackDamage = getEffectiveAttack(attacker)
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
        if (!canAttackTower(towers, targetZone)) continue

        const attackDamage = getEffectiveAttack(attacker)
        const newHp = Math.max(0, tower.hp - attackDamage)

        towers = towers.map((t) =>
          t.zone === tower.zone && t.team === tower.team
            ? { ...t, hp: newHp, alive: newHp > 0 }
            : t,
        )

        if (newHp <= 0) {
          towerKills.push({ zone: tower.zone, team: tower.team })
        }

        // Track tower damage dealt
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
        // Attack Roshan
        const roshan = state.roshan
        if (!roshan.alive) continue
        if (attacker.zone !== 'roshan-pit') continue

        const attackDamage = getEffectiveAttack(attacker)
        const _newHp = Math.max(0, roshan.hp - attackDamage)

        // We'll apply this at the end via state update

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

        const attackDamage = getEffectiveAttack(attacker)
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

    // Resolve targeted casts
    for (const action of targetedCasts) {
      const result = resolveTargetedAbility(state, players, action, events, heroAttackers)
      players = result.players
    }

    // Phase 4: Passive effects, cooldown ticks, item passives
    for (const [pid, player] of Object.entries(players)) {
      if (!player.alive) continue

      // Tick down cooldowns
      const cooldowns = { ...player.cooldowns }
      for (const slot of ['q', 'w', 'e', 'r'] as const) {
        if (cooldowns[slot] > 0) {
          cooldowns[slot] = cooldowns[slot] - 1
        }
      }

      let hp = player.hp
      let mp = player.mp

      // ── Item passive: Ring of Health (2% HP regen per tick) ──
      if (player.items.includes('ring_of_health')) {
        hp = Math.min(player.maxHp, hp + Math.floor(player.maxHp * 0.02))
      }

      // ── Item passive: Sobi Mask (2% MP regen per tick) ──
      if (player.items.includes('sobi_mask')) {
        mp = Math.min(player.maxMp, mp + Math.floor(player.maxMp * 0.02))
      }

      // ── Item passive: Heart of Tarrasque (5% HP regen when out of combat) ──
      if (player.items.includes('heart_of_tarrasque')) {
        const tookDamage = events.some((e) => e._tag === 'damage' && e.targetId === pid)
        const inCombat = player.buffs.some((b) => b.id === 'inCombat')
        if (!tookDamage && !inCombat) {
          hp = Math.min(player.maxHp, hp + Math.floor(player.maxHp * 0.05))
        }
      }

      // ── Item passive: Garbage Collector (5% HP regen when out of combat) ──
      if (player.items.includes('garbage_collector')) {
        const tookDamage = events.some(
          (e) => e._tag === 'damage' && e.targetId === pid,
        )
        const dealtDamage = heroAttackers.has(pid)
        const inCombat = player.buffs.some((b) => b.id === 'inCombat')
        if (!tookDamage && !dealtDamage && !inCombat) {
          hp = Math.min(player.maxHp, hp + Math.floor(player.maxHp * 0.05))
        }
      }

      // ── Item passive: Aether Lens (reduce cooldowns by 1) ──
      if (player.items.includes('aether_lens')) {
        for (const slot of ['q', 'w', 'e', 'r'] as const) {
          if (cooldowns[slot] > 0) {
            cooldowns[slot] = Math.max(0, cooldowns[slot] - 1)
          }
        }
      }

      // ── Item passive: Linken's Sphere (spellblock refresh) ──
      if (player.items.includes('linkens_sphere')) {
        const linkenBuff = player.buffs.find((b) => b.id === 'spellblock')
        if (!linkenBuff) {
          // Refresh spellblock if not present
          player.buffs.push({ id: 'spellblock', stacks: 1, ticksRemaining: 12, source: 'linkens_sphere' })
        }
      }

      players = {
        ...players,
        [pid]: { ...player, hp, mp, cooldowns },
      }
    }

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

    // Handle aegis pickup
    const aegisPickups = validActions.filter((a) => a.command.type === 'aegis')
    for (const action of aegisPickups) {
      const tempState: GameState = { ...state, players, creeps, towers, runes: state.runes, roshan: state.roshan, aegis: state.aegis }
      const result = pickupAegis(tempState, action.playerId)
      players = { ...result.players }
    }

    // Handle rune pickup
    const runePickups = validActions.filter((a) => a.command.type === 'rune')
    for (const action of runePickups) {
      const player = players[action.playerId]
      if (!player) continue
      const tempState: GameState = { ...state, players, creeps, towers, runes: state.runes, roshan: state.roshan, aegis: state.aegis }
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
        players = {
          ...players,
          [pid]: {
            ...player,
            maxHp: newMaxHp,
            maxMp: newMaxMp,
            hp: Math.min(player.hp, newMaxHp),
            mp: Math.min(player.mp, newMaxMp),
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
        const updatedKiller: PlayerState = { ...killer, gold: killer.gold + stats.gold, xp: killer.xp + stats.xp }
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
        const wardSlot = player.items.indexOf('observer_ward')
        if (wardSlot === -1) continue

        const placed = placeWard(zones, cmd.zone, player.team, state.tick)
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

  events.push({
    _tag: 'ability_used',
    tick: state.tick,
    playerId: action.playerId,
    abilityId: ability.id,
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

  events.push({
    _tag: 'ability_used',
    tick: state.tick,
    playerId: action.playerId,
    abilityId: ability.id,
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
