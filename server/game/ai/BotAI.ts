import type {
  GameState,
  PlayerState,
  TeamId,
  CreepState,
  TowerState,
  NeutralCreepState,
  RuneState,
} from '~~/shared/types/game'
import type { Command, TargetRef } from '~~/shared/types/commands'
import type { AbilityDef, TargetType } from '~~/shared/types/hero'
import { HEROES } from '~~/shared/constants/heroes'
import { findPath, getDistance } from '../map/topology'
import { getBotDifficultyConfig, type BotDifficultyConfig } from './BotManager'

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
  jungle: {
    radiant: ['radiant-fountain', 'radiant-base', 'jungle-rad-top', 'jungle-rad-bot'],
    dire: ['dire-fountain', 'dire-base', 'jungle-dire-top', 'jungle-dire-bot'],
  },
}

const BOT_BUILD_ORDER = [
  'boots_of_speed',
  'null_pointer',
  'garbage_collector',
  'blink_module',
  'stack_overflow',
  'segfault_blade',
]

const ITEM_COSTS: Record<string, number> = {
  boots_of_speed: 500,
  null_pointer: 1400,
  garbage_collector: 1800,
  blink_module: 2150,
  stack_overflow: 3200,
  segfault_blade: 5500,
}

const RUNE_ZONES = ['rune-top', 'rune-bot']
const JUNGLE_ZONES = ['jungle-rad-top', 'jungle-rad-bot', 'jungle-dire-top', 'jungle-dire-bot']

interface ComboState {
  currentCombo: string[] | null
  comboIndex: number
  lastComboTick: number
}

const comboStates = new Map<string, ComboState>()

interface HeroCombo {
  name: string
  sequence: Array<{ ability: 'q' | 'w' | 'e' | 'r'; delay?: number }>
  conditions: ('enemy_present' | 'low_hp_enemy' | 'stunned_enemy')[]
}

const HERO_COMBOS: Record<string, HeroCombo[]> = {
  echo: [
    {
      name: 'burst',
      sequence: [{ ability: 'e' }, { ability: 'q' }],
      conditions: ['enemy_present'],
    },
  ],
  daemon: [
    {
      name: 'execute',
      sequence: [{ ability: 'q' }, { ability: 'e' }],
      conditions: ['low_hp_enemy'],
    },
  ],
  kernel: [
    {
      name: 'lockdown',
      sequence: [{ ability: 'q' }, { ability: 'e' }, { ability: 'w' }],
      conditions: ['enemy_present'],
    },
  ],
  regex: [
    {
      name: 'catch',
      sequence: [{ ability: 'w' }, { ability: 'q' }],
      conditions: ['enemy_present'],
    },
  ],
}

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

function getNeutralsInZone(state: GameState, zone: string): NeutralCreepState[] {
  return state.neutrals.filter((n) => n.zone === zone && n.alive && n.hp > 0)
}

function getRunesInZone(state: GameState, zone: string): RuneState[] {
  return state.runes.filter((r) => r.zone === zone)
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

function getMpPercent(bot: PlayerState): number {
  return bot.maxMp > 0 ? (bot.mp / bot.maxMp) * 100 : 0
}

function getItemCount(bot: PlayerState): number {
  return bot.items.filter((i) => i !== null).length
}

function getNextLaneZone(bot: PlayerState, lane: string): string | null {
  const route = LANE_ROUTES[lane]?.[bot.team]
  if (!route) return null
  const currentIdx = route.indexOf(bot.zone)
  if (currentIdx === -1) {
    const laneStart = route[2]
    if (!laneStart) return null
    const path = findPath(bot.zone, laneStart)
    return path.length > 1 ? path[1]! : null
  }
  if (currentIdx < route.length - 1) {
    return route[currentIdx + 1]!
  }
  return null
}

function getClosestRuneZone(bot: PlayerState, state: GameState): string | null {
  let closest: string | null = null
  let minDist = Infinity
  for (const zone of RUNE_ZONES) {
    const runes = getRunesInZone(state, zone)
    if (runes.length > 0) {
      const dist = getDistance(bot.zone, zone)
      if (dist < minDist) {
        minDist = dist
        closest = zone
      }
    }
  }
  return closest
}

function getClosestJungleZoneWithNeutrals(bot: PlayerState, state: GameState): string | null {
  let closest: string | null = null
  let minDist = Infinity
  for (const zone of JUNGLE_ZONES) {
    const neutrals = getNeutralsInZone(state, zone)
    if (neutrals.length > 0) {
      const dist = getDistance(bot.zone, zone)
      if (dist < minDist) {
        minDist = dist
        closest = zone
      }
    }
  }
  return closest
}

type AbilitySlot = 'q' | 'w' | 'e' | 'r'

function canCastAbility(bot: PlayerState, ability: AbilityDef, slot: AbilitySlot): boolean {
  return bot.cooldowns[slot] === 0 && bot.mp >= ability.manaCost
}

function calculateThreatScore(enemy: PlayerState, _bot: PlayerState, _state: GameState): number {
  let score = 0
  const hero = enemy.heroId ? HEROES[enemy.heroId] : null
  if (hero) {
    score += hero.baseStats.attack * 0.5
    if (enemy.mp > 0) {
      for (const slot of ['q', 'w', 'e', 'r'] as const) {
        if (enemy.cooldowns[slot] === 0) {
          const ability = hero.abilities[slot]
          score += ability.manaCost * 0.3
        }
      }
    }
  }
  const hpPercent = getHpPercent(enemy)
  if (hpPercent < 30) score -= 50
  else if (hpPercent < 50) score -= 25
  score += enemy.kills * 10
  score -= enemy.deaths * 5
  return score
}

function shouldRetreatFromThreat(
  state: GameState,
  bot: PlayerState,
  config: BotDifficultyConfig,
): boolean {
  const hpPercent = getHpPercent(bot)
  if (hpPercent < config.retreatHpPercent) return true
  if (!config.threatAssessment) return false
  const enemyHeroes = getEnemyHeroesInZone(state, bot)
  if (enemyHeroes.length === 0) return false
  let totalEnemyThreat = 0
  for (const enemy of enemyHeroes) {
    totalEnemyThreat += calculateThreatScore(enemy, bot, state)
  }
  const botThreat = calculateThreatScore(bot, bot, state)
  const allies = Object.values(state.players).filter(
    (p) => p.zone === bot.zone && p.team === bot.team && p.alive && p.id !== bot.id,
  )
  let totalAllyThreat = botThreat
  for (const ally of allies) {
    totalAllyThreat += calculateThreatScore(ally, bot, state) * 0.7
  }
  if (totalEnemyThreat > totalAllyThreat * 1.5 && hpPercent < 50) return true
  return false
}

function tryGetAbilityCommand(
  state: GameState,
  bot: PlayerState,
  enemiesInZone: PlayerState[],
): Command | null {
  const hero = bot.heroId ? HEROES[bot.heroId] : null
  if (!hero) return null
  const slots: AbilitySlot[] = ['r', 'q', 'w', 'e']
  for (const slot of slots) {
    const ability = hero.abilities[slot]
    if (!canCastAbility(bot, ability, slot)) continue
    const target = getAbilityTarget(ability.targetType, bot, enemiesInZone)
    if (target === undefined) continue
    if (target === null) {
      return { type: 'cast', ability: slot }
    }
    return { type: 'cast', ability: slot, target }
  }
  return null
}

function getAbilityTarget(
  targetType: TargetType,
  bot: PlayerState,
  enemiesInZone: PlayerState[],
): TargetRef | null | undefined {
  switch (targetType) {
    case 'none':
      return enemiesInZone.length > 0 ? null : undefined
    case 'self':
      return enemiesInZone.length > 0 || getHpPercent(bot) < 50 ? null : undefined
    case 'hero':
    case 'unit': {
      if (enemiesInZone.length === 0) return undefined
      const target = enemiesInZone.reduce((a, b) => (a.hp < b.hp ? a : b))
      return { kind: 'hero', name: target.id }
    }
    case 'zone': {
      if (enemiesInZone.length === 0) return undefined
      return { kind: 'zone', zone: enemiesInZone[0]!.zone }
    }
    default:
      return undefined
  }
}

function tryCombo(
  state: GameState,
  bot: PlayerState,
  enemiesInZone: PlayerState[],
  config: BotDifficultyConfig,
): Command | null {
  if (Math.random() > config.abilityComboChance) return null
  const heroId = bot.heroId
  if (!heroId) return null
  const combos = HERO_COMBOS[heroId]
  if (!combos || combos.length === 0) return null
  const comboState = comboStates.get(bot.id)
  if (comboState && comboState.currentCombo) {
    const comboDef = combos.find((c) => c.name === comboState.currentCombo![0])
    if (comboDef) {
      const nextAbility = comboDef.sequence[comboState.comboIndex]
      if (
        nextAbility &&
        canCastAbility(bot, HEROES[heroId]!.abilities[nextAbility.ability], nextAbility.ability)
      ) {
        const newComboState: ComboState = {
          currentCombo: comboState.currentCombo,
          comboIndex: comboState.comboIndex + 1,
          lastComboTick: state.tick,
        }
        comboStates.set(bot.id, newComboState)
        const target = getAbilityTarget(
          HEROES[heroId]!.abilities[nextAbility.ability].targetType,
          bot,
          enemiesInZone,
        )
        if (target === undefined) {
          comboStates.delete(bot.id)
          return null
        }
        return target === null
          ? { type: 'cast', ability: nextAbility.ability }
          : { type: 'cast', ability: nextAbility.ability, target }
      }
    }
    comboStates.delete(bot.id)
  }
  for (const combo of combos) {
    const conditionsMet = combo.conditions.every((cond) => {
      switch (cond) {
        case 'enemy_present':
          return enemiesInZone.length > 0
        case 'low_hp_enemy':
          return enemiesInZone.some((e) => getHpPercent(e) < 30)
        case 'stunned_enemy':
          return enemiesInZone.some((e) => e.buffs.some((b) => b.id.includes('stun')))
        default:
          return true
      }
    })
    if (!conditionsMet) continue
    const firstAbility = combo.sequence[0]
    if (
      firstAbility &&
      canCastAbility(bot, HEROES[heroId]!.abilities[firstAbility.ability], firstAbility.ability)
    ) {
      comboStates.set(bot.id, {
        currentCombo: [combo.name],
        comboIndex: 1,
        lastComboTick: state.tick,
      })
      const target = getAbilityTarget(
        HEROES[heroId]!.abilities[firstAbility.ability].targetType,
        bot,
        enemiesInZone,
      )
      if (target === undefined) {
        comboStates.delete(bot.id)
        continue
      }
      return target === null
        ? { type: 'cast', ability: firstAbility.ability }
        : { type: 'cast', ability: firstAbility.ability, target }
    }
  }
  return null
}

function tryBuyItem(bot: PlayerState): Command | null {
  if (getItemCount(bot) >= 6) return null
  for (const itemId of BOT_BUILD_ORDER) {
    if (bot.items.includes(itemId)) continue
    const cost = ITEM_COSTS[itemId]
    if (cost !== undefined && bot.gold >= cost) {
      return { type: 'buy', item: itemId }
    }
    break
  }
  return null
}

function tryPickupRune(
  state: GameState,
  bot: PlayerState,
  config: BotDifficultyConfig,
): Command | null {
  if (!config.runeAwareness) return null
  const runesInZone = getRunesInZone(state, bot.zone)
  if (runesInZone.length > 0) {
    return { type: 'cast', ability: 'q' }
  }
  const closestRuneZone = getClosestRuneZone(bot, state)
  if (closestRuneZone && getDistance(bot.zone, closestRuneZone) <= 2) {
    const path = findPath(bot.zone, closestRuneZone)
    if (path.length > 1) {
      return { type: 'move', zone: path[1]! }
    }
  }
  return null
}

function tryFarmJungle(
  state: GameState,
  bot: PlayerState,
  config: BotDifficultyConfig,
): Command | null {
  if (!config.jungleFarming) return null
  const neutralsHere = getNeutralsInZone(state, bot.zone)
  if (neutralsHere.length > 0) {
    const target = neutralsHere.reduce((a, b) => (a.hp < b.hp ? a : b))
    const neutralIdx = state.neutrals.indexOf(target)
    return { type: 'attack', target: { kind: 'neutral', index: neutralIdx } }
  }
  const closestJungle = getClosestJungleZoneWithNeutrals(bot, state)
  if (closestJungle && getDistance(bot.zone, closestJungle) <= 3) {
    const path = findPath(bot.zone, closestJungle)
    if (path.length > 1) {
      return { type: 'move', zone: path[1]! }
    }
  }
  return null
}

export function decideBotAction(
  state: GameState,
  bot: PlayerState,
  assignedLane: string,
): Command | null {
  const config = getBotDifficultyConfig(state.tick.toString(), bot.id)
  if (!bot.alive) {
    if (bot.respawnTick !== null && state.tick >= bot.respawnTick) {
      const fountain = getFountainZone(bot.team)
      if (bot.zone !== fountain) {
        return { type: 'move', zone: fountain }
      }
    }
    return null
  }
  if (isInFountain(bot)) {
    const buyCmd = tryBuyItem(bot)
    if (buyCmd) return buyCmd
    if (getHpPercent(bot) >= 95 && getMpPercent(bot) >= 95) {
      const nextZone = getNextLaneZone(bot, assignedLane)
      if (nextZone) return { type: 'move', zone: nextZone }
    }
    return null
  }
  if (shouldRetreatFromThreat(state, bot, config)) {
    const fountain = getFountainZone(bot.team)
    const path = findPath(bot.zone, fountain)
    if (path.length > 1) {
      return { type: 'move', zone: path[1]! }
    }
    return null
  }
  const enemyHeroes = getEnemyHeroesInZone(state, bot)
  const enemyCreeps = getEnemyCreepsInZone(state, bot)
  if (enemyHeroes.length > 0) {
    const comboCmd = tryCombo(state, bot, enemyHeroes, config)
    if (comboCmd) return comboCmd
    const abilityCmd = tryGetAbilityCommand(state, bot, enemyHeroes)
    if (abilityCmd) return abilityCmd
    const target = enemyHeroes.reduce((a, b) => (a.hp < b.hp ? a : b))
    return { type: 'attack', target: { kind: 'hero', name: target.id } }
  }
  if (enemyCreeps.length > 0) {
    const lowestCreep = enemyCreeps.reduce((a, b) => (a.hp < b.hp ? a : b))
    const creepIdx = state.creeps.indexOf(lowestCreep)
    if (Math.random() < config.lastHitAccuracy || lowestCreep.hp <= 50) {
      return { type: 'attack', target: { kind: 'creep', index: creepIdx } }
    }
  }
  const enemyTower = getEnemyTowerInZone(state, bot)
  if (enemyTower && getAlliedCreepsInZone(state, bot).length > 0) {
    return { type: 'attack', target: { kind: 'tower', zone: enemyTower.zone } }
  }
  const runeCmd = tryPickupRune(state, bot, config)
  if (runeCmd) return runeCmd
  if (assignedLane === 'jungle' || (config.jungleFarming && getHpPercent(bot) > 60)) {
    const jungleCmd = tryFarmJungle(state, bot, config)
    if (jungleCmd) return jungleCmd
  }
  const nextZone = getNextLaneZone(bot, assignedLane)
  if (nextZone) {
    return { type: 'move', zone: nextZone }
  }
  return null
}

export function cleanupBotState(playerId: string): void {
  comboStates.delete(playerId)
}
