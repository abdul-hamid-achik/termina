import { Effect } from 'effect'
import type { GameState, PlayerState, TeamId } from '~~/shared/types/game'
import type { Command, TargetRef } from '~~/shared/types/commands'
import { areAdjacent, getAdjacentZones } from '../map/topology'
import { ZONE_MAP } from '~~/shared/constants/zones'
import { calculatePhysicalDamage, calculateMagicalDamage } from './DamageCalculator'
import { placeWard } from '../map/zones'
import { HEROES } from '~~/shared/constants/heroes'
import type { GameEngineEvent } from '../protocol/events'
import { buyItem, sellItem } from '../items/shop'
import { awardLastHit, awardTowerKill } from './GoldDistributor'

// ── Types ──────────────────────────────────────────────────────

export interface PlayerAction {
  playerId: string
  command: Command
}

interface ResolvedChanges {
  players: Record<string, PlayerState>
  events: GameEngineEvent[]
  heroAttackers: Map<string, string> // attackerId -> victimId
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
    let zones = { ...state.zones }
    let creeps = [...state.creeps]
    let towers = [...state.towers]
    const creepKills: Array<{ playerId: string; creepType: 'melee' | 'ranged' | 'siege' }> = []
    const towerKills: Array<{ zone: string; team: TeamId }> = []

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
      const result = resolveInstantAbility(state, players, action, events)
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
        const target = players[targetId]
        if (!target || !target.alive) continue

        // Check if target is in the same zone (post-movement)
        if (target.zone !== attacker.zone) continue

        // Attack hit
        const hero = attacker.heroId ? HEROES[attacker.heroId] : null
        const attackDamage = hero ? hero.baseStats.attack : 50
        const defense = 0 // Base defense from hero stats handled in full system
        const damage = calculatePhysicalDamage(attackDamage, defense)

        const newHp = Math.max(0, target.hp - damage)
        players = {
          ...players,
          [targetId]: { ...target, hp: newHp, alive: newHp > 0 },
        }

        heroAttackers.set(action.playerId, targetId)

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

        const hero = attacker.heroId ? HEROES[attacker.heroId] : null
        const attackDamage = hero ? hero.baseStats.attack : 50
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

        const hero = attacker.heroId ? HEROES[attacker.heroId] : null
        const attackDamage = hero ? hero.baseStats.attack : 50
        const newHp = Math.max(0, tower.hp - attackDamage)

        towers = towers.map((t) =>
          t.zone === tower.zone && t.team === tower.team
            ? { ...t, hp: newHp, alive: newHp > 0 }
            : t,
        )

        if (newHp <= 0) {
          towerKills.push({ zone: tower.zone, team: tower.team })
        }

        events.push({
          _tag: 'damage',
          tick: state.tick,
          sourceId: action.playerId,
          targetId: `tower_${tower.zone}`,
          amount: attackDamage,
          damageType: 'physical',
        })
      }
    }

    // Resolve targeted casts
    for (const action of targetedCasts) {
      const result = resolveTargetedAbility(state, players, action, events)
      players = result.players
    }

    // Phase 4: Passive effects, cooldown ticks
    for (const [pid, player] of Object.entries(players)) {
      if (!player.alive) continue

      // Tick down cooldowns
      const cooldowns = { ...player.cooldowns }
      for (const slot of ['q', 'w', 'e', 'r'] as const) {
        if (cooldowns[slot] > 0) {
          cooldowns[slot] = cooldowns[slot] - 1
        }
      }

      // Tick down buff durations
      const buffs = player.buffs
        .map((b) => ({ ...b, ticksRemaining: b.ticksRemaining - 1 }))
        .filter((b) => b.ticksRemaining > 0)

      players = {
        ...players,
        [pid]: { ...player, cooldowns, buffs },
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

    // Award gold for creep last-hits
    for (const kill of creepKills) {
      const tempState: GameState = { ...state, players, creeps, towers }
      const awarded = awardLastHit(tempState, kill.playerId, kill.creepType)
      players = { ...awarded.players }
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

    // Handle ward placements
    const wardActions = validActions.filter((a) => a.command.type === 'ward')
    for (const action of wardActions) {
      const cmd = action.command as { type: 'ward'; zone: string }
      const player = players[action.playerId]
      if (player) {
        const placed = placeWard(zones, cmd.zone, player.team, state.tick)
        if (placed) {
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
          updatedPlayers = applyBuffToPlayer(
            updatedPlayers,
            targetId,
            effect.type,
            effect.duration ?? 1,
            caster.id,
          )
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
          const dmg =
            dmgType === 'physical' ? calculatePhysicalDamage(effect.value, 0) : effect.value
          const newHp = Math.max(0, target.hp - dmg)
          updatedPlayers = {
            ...updatedPlayers,
            [targetId]: { ...target, hp: newHp, alive: newHp > 0 },
          }
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

  return { players: updatedPlayers }
}

function resolveTargetedAbility(
  state: GameState,
  players: Record<string, PlayerState>,
  action: PlayerAction,
  events: GameEngineEvent[],
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
              dmgType === 'physical' ? calculatePhysicalDamage(effect.value, 0) : effect.value
            const newHp = Math.max(0, target.hp - dmg)
            updatedPlayers = {
              ...updatedPlayers,
              [targetId]: { ...target, hp: newHp, alive: newHp > 0 },
            }
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
              dmgType === 'physical' ? calculatePhysicalDamage(effect.value, 0) : effect.value
            const newHp = Math.max(0, p.hp - dmg)
            updatedPlayers = {
              ...updatedPlayers,
              [pid]: { ...p, hp: newHp, alive: newHp > 0 },
            }
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
