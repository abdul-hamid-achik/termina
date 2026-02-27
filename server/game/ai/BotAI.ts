import type { GameState, PlayerState, TeamId, CreepState, TowerState } from '~~/shared/types/game'
import type { Command, TargetRef } from '~~/shared/types/commands'
import type { AbilityDef, TargetType } from '~~/shared/types/hero'
import { HEROES } from '~~/shared/constants/heroes'
import { findPath } from '../map/topology'

// ── Lane routes (same as CreepAI) ──────────────────────────────────

const LANE_ROUTES: Record<string, Record<TeamId, string[]>> = {
  top: {
    radiant: [
      'radiant-fountain',
      'radiant-base',
      'top-t3-rad',
      'top-t2-rad',
      'top-t1-rad',
      'top-river',
      'top-t1-dire',
      'top-t2-dire',
      'top-t3-dire',
      'dire-base',
    ],
    dire: [
      'dire-fountain',
      'dire-base',
      'top-t3-dire',
      'top-t2-dire',
      'top-t1-dire',
      'top-river',
      'top-t1-rad',
      'top-t2-rad',
      'top-t3-rad',
      'radiant-base',
    ],
  },
  mid: {
    radiant: [
      'radiant-fountain',
      'radiant-base',
      'mid-t3-rad',
      'mid-t2-rad',
      'mid-t1-rad',
      'mid-river',
      'mid-t1-dire',
      'mid-t2-dire',
      'mid-t3-dire',
      'dire-base',
    ],
    dire: [
      'dire-fountain',
      'dire-base',
      'mid-t3-dire',
      'mid-t2-dire',
      'mid-t1-dire',
      'mid-river',
      'mid-t1-rad',
      'mid-t2-rad',
      'mid-t3-rad',
      'radiant-base',
    ],
  },
  bot: {
    radiant: [
      'radiant-fountain',
      'radiant-base',
      'bot-t3-rad',
      'bot-t2-rad',
      'bot-t1-rad',
      'bot-river',
      'bot-t1-dire',
      'bot-t2-dire',
      'bot-t3-dire',
      'dire-base',
    ],
    dire: [
      'dire-fountain',
      'dire-base',
      'bot-t3-dire',
      'bot-t2-dire',
      'bot-t1-dire',
      'bot-river',
      'bot-t1-rad',
      'bot-t2-rad',
      'bot-t3-rad',
      'radiant-base',
    ],
  },
}

// ── Item build order ───────────────────────────────────────────────

const BOT_BUILD_ORDER = [
  'boots_of_speed', // 500g
  'null_pointer', // 1400g
  'garbage_collector', // 1800g
  'blink_module', // 2150g
  'stack_overflow', // 3200g
  'segfault_blade', // 5500g
]

// ── Helpers ────────────────────────────────────────────────────────

function getEnemyHeroesInZone(state: GameState, bot: PlayerState): PlayerState[] {
  return Object.values(state.players).filter(
    (p) => p.zone === bot.zone && p.team !== bot.team && p.alive,
  )
}

function getEnemyCreepsInZone(state: GameState, bot: PlayerState): CreepState[] {
  return state.creeps.filter((c) => c.zone === bot.zone && c.team !== bot.team && c.hp > 0)
}

function getAlliedCreepsInZone(state: GameState, bot: PlayerState): CreepState[] {
  return state.creeps.filter((c) => c.zone === bot.zone && c.team === bot.team && c.hp > 0)
}

function getEnemyTowerInZone(state: GameState, bot: PlayerState): TowerState | undefined {
  return state.towers.find((t) => t.zone === bot.zone && t.team !== bot.team && t.alive)
}

function getFountainZone(team: TeamId): string {
  return team === 'radiant' ? 'radiant-fountain' : 'dire-fountain'
}

function isInFountain(bot: PlayerState): boolean {
  return bot.zone === getFountainZone(bot.team)
}

function getHpPercent(bot: PlayerState): number {
  return bot.maxHp > 0 ? (bot.hp / bot.maxHp) * 100 : 0
}

function getItemCount(bot: PlayerState): number {
  return bot.items.filter((i) => i !== null).length
}

function getNextLaneZone(bot: PlayerState, lane: string): string | null {
  const route = LANE_ROUTES[lane]?.[bot.team]
  if (!route) return null

  const currentIdx = route.indexOf(bot.zone)
  if (currentIdx === -1) {
    // Not on lane route — pathfind to the first lane zone
    const laneStart = route[2] // skip fountain & base
    if (!laneStart) return null
    const path = findPath(bot.zone, laneStart)
    return path.length > 1 ? path[1]! : null
  }

  // Move forward along the route
  if (currentIdx < route.length - 1) {
    return route[currentIdx + 1]!
  }
  return null
}

// ── Ability logic ──────────────────────────────────────────────────

type AbilitySlot = 'q' | 'w' | 'e' | 'r'

function canCastAbility(bot: PlayerState, ability: AbilityDef, slot: AbilitySlot): boolean {
  return bot.cooldowns[slot] === 0 && bot.mp >= ability.manaCost
}

function tryGetAbilityCommand(
  state: GameState,
  bot: PlayerState,
  enemiesInZone: PlayerState[],
): Command | null {
  const hero = bot.heroId ? HEROES[bot.heroId] : null
  if (!hero) return null

  // Try abilities in priority order: r → q → w → e
  const slots: AbilitySlot[] = ['r', 'q', 'w', 'e']
  for (const slot of slots) {
    const ability = hero.abilities[slot]
    if (!canCastAbility(bot, ability, slot)) continue

    const target = getAbilityTarget(ability.targetType, bot, enemiesInZone)
    if (target === undefined) continue // No valid target

    if (target === null) {
      // No target needed (AoE or self)
      return { type: 'cast', ability: slot }
    }

    return { type: 'cast', ability: slot, target }
  }

  return null
}

/**
 * Returns:
 * - TargetRef if a target is needed and found
 * - null if no target is needed (self/none cast)
 * - undefined if a target is needed but not found
 */
function getAbilityTarget(
  targetType: TargetType,
  bot: PlayerState,
  enemiesInZone: PlayerState[],
): TargetRef | null | undefined {
  switch (targetType) {
    case 'none':
      // AoE — only cast if enemies present
      return enemiesInZone.length > 0 ? null : undefined
    case 'self':
      // Self-cast — cast in combat or low HP
      return enemiesInZone.length > 0 || getHpPercent(bot) < 50 ? null : undefined
    case 'hero':
    case 'unit': {
      // Need an enemy target
      if (enemiesInZone.length === 0) return undefined
      // Target lowest HP enemy
      const target = enemiesInZone.reduce((a, b) => (a.hp < b.hp ? a : b))
      return { kind: 'hero', name: target.id }
    }
    case 'zone':
      // Zone-targeted abilities — skip for simplicity
      return undefined
    default:
      return undefined
  }
}

// ── Main decision function ─────────────────────────────────────────

/**
 * Decide what action a bot should take this tick.
 * Returns null if no action (dead, etc.).
 */
export function decideBotAction(
  state: GameState,
  bot: PlayerState,
  assignedLane: string,
): Command | null {
  // 1. Dead — no action
  if (!bot.alive) return null

  // 2. At fountain with enough gold — buy next item
  if (isInFountain(bot)) {
    const buyCmd = tryBuyItem(bot)
    if (buyCmd) return buyCmd

    // If HP is full and we have nothing to buy, move to lane
    if (getHpPercent(bot) >= 90) {
      const nextZone = getNextLaneZone(bot, assignedLane)
      if (nextZone) return { type: 'move', zone: nextZone }
    }
    // Stay at fountain to heal
    return null
  }

  // 3. Low HP (<25%) — retreat to fountain
  if (getHpPercent(bot) < 25) {
    const fountain = getFountainZone(bot.team)
    const path = findPath(bot.zone, fountain)
    if (path.length > 1) {
      return { type: 'move', zone: path[1]! }
    }
    return null
  }

  const enemyHeroes = getEnemyHeroesInZone(state, bot)
  const enemyCreeps = getEnemyCreepsInZone(state, bot)

  // 4. Has castable ability + enemy in zone — cast
  if (enemyHeroes.length > 0) {
    const abilityCmd = tryGetAbilityCommand(state, bot, enemyHeroes)
    if (abilityCmd) return abilityCmd
  }

  // 5. Enemy hero in zone — attack (target lowest HP)
  if (enemyHeroes.length > 0) {
    const target = enemyHeroes.reduce((a, b) => (a.hp < b.hp ? a : b))
    return { type: 'attack', target: { kind: 'hero', name: target.id } }
  }

  // 6. Enemy creeps in zone — attack (last-hit: target lowest HP)
  if (enemyCreeps.length > 0) {
    const lowestCreep = enemyCreeps.reduce((a, b) => (a.hp < b.hp ? a : b))
    const creepIdx = state.creeps.indexOf(lowestCreep)
    return { type: 'attack', target: { kind: 'creep', index: creepIdx } }
  }

  // 7. Enemy tower in zone + allied creeps present — attack tower
  const enemyTower = getEnemyTowerInZone(state, bot)
  if (enemyTower && getAlliedCreepsInZone(state, bot).length > 0) {
    return { type: 'attack', target: { kind: 'tower', zone: enemyTower.zone } }
  }

  // 8. Default — move along assigned lane toward enemy base
  const nextZone = getNextLaneZone(bot, assignedLane)
  if (nextZone) {
    return { type: 'move', zone: nextZone }
  }

  return null
}

// ── Shopping logic ─────────────────────────────────────────────────

// Import item costs inline to avoid dependency issues
const ITEM_COSTS: Record<string, number> = {
  boots_of_speed: 500,
  null_pointer: 1400,
  garbage_collector: 1800,
  blink_module: 2150,
  stack_overflow: 3200,
  segfault_blade: 5500,
}

function tryBuyItem(bot: PlayerState): Command | null {
  if (getItemCount(bot) >= 6) return null

  for (const itemId of BOT_BUILD_ORDER) {
    // Skip if already owned
    if (bot.items.includes(itemId)) continue

    const cost = ITEM_COSTS[itemId]
    if (cost !== undefined && bot.gold >= cost) {
      return { type: 'buy', item: itemId }
    }
    // Can't afford next item — stop looking
    break
  }

  return null
}
