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
import type { AbilityDef } from '~~/shared/types/hero'
import { HEROES } from '~~/shared/constants/heroes'
import { findPath, getDistance } from '~~/server/game/map/topology'
import { ANCIENT_ZONES } from '~~/server/game/engine/AncientSystem'
import { fastGameFactor } from '~~/server/game/engine/fastGame'
import { getAbilityLevel } from '~~/server/game/heroes/_base'
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

// Core build: every entry grants stats the engine actually consumes
// (attack/defense/hp/mp) — no dead moveSpeed-only items like boots_of_speed.
const BOT_BUILD_ORDER = [
  'blades_of_attack',
  'null_pointer',
  'garbage_collector',
  'blink_module',
  'stack_overflow',
  'segfault_blade',
]

const ITEM_COSTS: Record<string, number> = {
  blades_of_attack: 430,
  null_pointer: 1400,
  garbage_collector: 1800,
  blink_module: 2150,
  stack_overflow: 3200,
  segfault_blade: 5500,
}

// Defensive consumables bots keep stocked (one of each)
const BOT_CONSUMABLES: Array<{ item: string; cost: number }> = [
  { item: 'healing_salve', cost: 150 },
  { item: 'town_portal_scroll', cost: 50 },
]

/** Pop a salve when below this HP% (out of combat). */
const SALVE_HP_PERCENT = 60
/** TP home instead of walking when the fountain is further than this. */
const TP_RETREAT_MIN_DISTANCE = 2

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

function getAlliedHeroesInZone(state: GameState, bot: PlayerState): PlayerState[] {
  return Object.values(state.players).filter(
    (p) => p.zone === bot.zone && p.team === bot.team && p.alive && p.id !== bot.id,
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
  // Mirror the ActionResolver gates — most critically the auto-level unlock
  // (R locks until level 6). Without it, a level-1 bot facing an enemy hero
  // burns its one action per tick on a cast the resolver always rejects:
  // it never attacks, never earns XP, never levels — and a whole game of
  // bots in that state deadlocks the match forever.
  return (
    getAbilityLevel(bot.level, slot) >= 1 && bot.cooldowns[slot] === 0 && bot.mp >= ability.manaCost
  )
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
  const alliesInZone = getAlliedHeroesInZone(state, bot)
  const slots: AbilitySlot[] = ['r', 'q', 'w', 'e']
  for (const slot of slots) {
    const ability = hero.abilities[slot]
    if (!canCastAbility(bot, ability, slot)) continue
    const target = getAbilityTarget(ability, bot, enemiesInZone, alliesInZone)
    if (target === undefined) continue
    if (target === null) {
      return { type: 'cast', ability: slot }
    }
    return { type: 'cast', ability: slot, target }
  }
  return null
}

const SUPPORTIVE_EFFECTS = new Set(['heal', 'shield', 'buff'])
const OFFENSIVE_EFFECTS = new Set([
  'damage',
  'stun',
  'silence',
  'root',
  'slow',
  'dot',
  'debuff',
  'fear',
  'taunt',
  'execute',
])

/** Heal/shield/buff abilities with no offensive component go to allies, not enemies. */
function isSupportiveAbility(ability: AbilityDef): boolean {
  return (
    ability.effects.some((e) => SUPPORTIVE_EFFECTS.has(e.type)) &&
    !ability.effects.some((e) => OFFENSIVE_EFFECTS.has(e.type))
  )
}

const SELF_VIABLE_EFFECTS = new Set(['heal', 'shield'])

/** A heal/shield can usefully land on the caster; a pure ally buff/utility cannot. */
function isSelfCastViable(ability: AbilityDef): boolean {
  return ability.effects.some((e) => SELF_VIABLE_EFFECTS.has(e.type))
}

/**
 * Pick the friendly target for an ally-only / supportive cast: the lowest-HP
 * ally in the zone, or the bot itself — NEVER an enemy. The per-hero resolvers
 * for these abilities (e.g. cron.q buff, proxy.r position swap, sentry heal)
 * reject any target whose team differs from the caster's, so a bot that aimed
 * one at an enemy would simply burn its one action for the tick.
 *
 * `skipIfHealthy` is set for heal/shield/buff abilities so we don't waste mana
 * topping off a full-HP team; otherwise the cast always lands on a friendly
 * unit as long as one exists.
 *
 * When the bot is alone (no allies in zone) the only candidate is itself. Some
 * ally resolvers (cron.q buff, proxy.r position-swap) explicitly reject a
 * self-target with "Target must be an ally", so emitting a self-cast there
 * would burn the tick. We only fall back to self when the ability is a heal or
 * shield — exactly the cases the resolvers accept on the caster (sentry.q/w,
 * proxy.w, cron.w) — and skip the cast otherwise.
 */
function pickAllyTarget(
  ability: AbilityDef,
  bot: PlayerState,
  alliesInZone: PlayerState[],
  skipIfHealthy: boolean,
): TargetRef | undefined {
  if (alliesInZone.length === 0 && !isSelfCastViable(ability)) return undefined
  const candidates = [...alliesInZone, bot]
  const target = candidates.reduce((a, b) => (getHpPercent(a) <= getHpPercent(b) ? a : b))
  if (skipIfHealthy && getHpPercent(target) >= 90) return undefined
  return { kind: 'hero', name: target.id }
}

export function getAbilityTarget(
  ability: AbilityDef,
  bot: PlayerState,
  enemiesInZone: PlayerState[],
  alliesInZone: PlayerState[],
): TargetRef | null | undefined {
  // Compare on the raw string so this stays correct whether or not the shared
  // TargetType union has gained an explicit 'ally' member yet (hero data is
  // edited in parallel). An 'ally' ability must resolve to a friendly target.
  const targetType = ability.targetType as string
  if (targetType === 'ally') {
    return pickAllyTarget(ability, bot, alliesInZone, isSupportiveAbility(ability))
  }
  switch (ability.targetType) {
    case 'none':
      return enemiesInZone.length > 0 ? null : undefined
    case 'self':
      return enemiesInZone.length > 0 || getHpPercent(bot) < 50 ? null : undefined
    case 'hero':
    case 'unit': {
      // Heal/shield/buff-only single-target casts go to the most-hurt ally
      // (or the bot itself), never an enemy.
      if (isSupportiveAbility(ability)) {
        return pickAllyTarget(ability, bot, alliesInZone, true)
      }
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
  const alliesInZone = getAlliedHeroesInZone(state, bot)
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
          HEROES[heroId]!.abilities[nextAbility.ability],
          bot,
          enemiesInZone,
          alliesInZone,
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
        HEROES[heroId]!.abilities[firstAbility.ability],
        bot,
        enemiesInZone,
        alliesInZone,
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
  // Keep one of each defensive consumable stocked before core items
  for (const consumable of BOT_CONSUMABLES) {
    if (!bot.items.includes(consumable.item) && bot.gold >= consumable.cost) {
      return { type: 'buy', item: consumable.item }
    }
  }
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
    return { type: 'rune' }
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

/** Attack the enemy Ancient when in the enemy base and it is vulnerable. */
function tryAttackAncient(state: GameState, bot: PlayerState): Command | null {
  const enemyTeam: TeamId = bot.team === 'radiant' ? 'dire' : 'radiant'
  if (bot.zone !== ANCIENT_ZONES[enemyTeam]) return null
  // Optional chaining guards old snapshots/fixtures created before Ancients existed
  const ancient = state.ancients?.[enemyTeam]
  if (!ancient || !ancient.alive || !ancient.vulnerable) return null
  return { type: 'attack', target: { kind: 'ancient' } }
}

export function decideBotAction(
  state: GameState,
  bot: PlayerState,
  assignedLane: string,
  gameId?: string,
): Command | null {
  const config = getBotDifficultyConfig(gameId ?? '', bot.id)
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
  // Stand still while channeling TP — moving would cancel it
  if (bot.buffs.some((b) => b.id === 'tp_channeling')) {
    return null
  }
  const enemyHeroes = getEnemyHeroesInZone(state, bot)
  // Pop a healing salve when hurt and out of combat
  if (
    enemyHeroes.length === 0 &&
    getHpPercent(bot) < SALVE_HP_PERCENT &&
    bot.items.includes('healing_salve') &&
    !bot.buffs.some((b) => b.id === 'healing_salve_regen')
  ) {
    return { type: 'use', item: 'healing_salve' }
  }
  if (shouldRetreatFromThreat(state, bot, config)) {
    const fountain = getFountainZone(bot.team)
    // TP home instead of walking when retreating from deep positions
    if (
      enemyHeroes.length === 0 &&
      bot.items.includes('town_portal_scroll') &&
      getDistance(bot.zone, fountain) > TP_RETREAT_MIN_DISTANCE
    ) {
      return { type: 'use', item: 'town_portal_scroll' }
    }
    const path = findPath(bot.zone, fountain)
    if (path.length > 1) {
      return { type: 'move', zone: path[1]! }
    }
    return null
  }
  const enemyCreeps = getEnemyCreepsInZone(state, bot)
  if (enemyHeroes.length > 0) {
    const comboCmd = tryCombo(state, bot, enemyHeroes, config)
    if (comboCmd) return comboCmd
    const abilityCmd = tryGetAbilityCommand(state, bot, enemyHeroes)
    if (abilityCmd) return abilityCmd
    const target = enemyHeroes.reduce((a, b) => (a.hp < b.hp ? a : b))
    return { type: 'attack', target: { kind: 'hero', name: target.id } }
  }
  // Win condition: hit the enemy Ancient when standing in their base and it's exposed
  const ancientCmd = tryAttackAncient(state, bot)
  if (ancientCmd) return ancientCmd

  // In fast-game/test mode the loop is sped up to make matches end in minutes,
  // so bots push and siege DECISIVELY rather than last-hitting creeps forever —
  // which keeps the play-to-the-end specs (game-over, smoke) fast. This is an
  // ADDITIONAL accelerator layered on top of the production pushing below; the
  // real game no longer depends on it for forward progress.
  const aggressivePush = fastGameFactor() > 1

  // Close out a won game: if the enemy Ancient is exposed, march straight to
  // their base to finish it. The retreat-from-threat check already ran above,
  // so a low-HP bot still backs off rather than feeding into base defenses.
  const enemyTeamForClose: TeamId = bot.team === 'radiant' ? 'dire' : 'radiant'
  const exposedAncient = state.ancients?.[enemyTeamForClose]
  if (exposedAncient?.alive && exposedAncient.vulnerable) {
    const baseZone = ANCIENT_ZONES[enemyTeamForClose]
    if (bot.zone !== baseZone) {
      const path = findPath(bot.zone, baseZone)
      if (path.length > 1) return { type: 'move', zone: path[1]! }
    }
  }

  // Aggressive siege (test mode only): topple the enemy tower in this zone, else
  // march toward the enemy base. Sits ABOVE creep farming so test games converge
  // quickly; production bots fall through to the game-state-driven push below.
  if (aggressivePush) {
    const towerHere = getEnemyTowerInZone(state, bot)
    if (towerHere) return { type: 'attack', target: { kind: 'tower', zone: towerHere.zone } }
    const advanceZone = getNextLaneZone(bot, assignedLane)
    if (advanceZone) return { type: 'move', zone: advanceZone }
  }

  // Clear the creep wave: always attack the lowest-HP enemy creep in the zone.
  // A failed last-hit roll used to return null here, which left production bots
  // idling in lane instead of pushing — one half of the "bots look stuck"
  // report. Gold for the kill is awarded engine-side to whoever lands the blow,
  // so attacking unconditionally only changes whether the bot acts, not balance.
  if (enemyCreeps.length > 0) {
    const lowestCreep = enemyCreeps.reduce((a, b) => (a.hp < b.hp ? a : b))
    // Creep targets use zone-local indices (Nth creep in the attacker's zone)
    const creepIdx = state.creeps.filter((c) => c.zone === bot.zone).indexOf(lowestCreep)
    return { type: 'attack', target: { kind: 'creep', index: creepIdx } }
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

  // Forward progress (production) is driven by GAME STATE, not the test
  // accelerator. A bot advances freely on its own half of the map; it pushes
  // into enemy territory only with lane support — allied creeps in this zone or
  // the next, or an ally hero alongside — so a lone level-1 hero never marches
  // into the enemy base and feeds. Creep waves spawn continuously, so a bot
  // holding at the frontier advances as soon as the next wave reaches it, and
  // the retreat-from-threat check above still pulls hurt/outnumbered bots back.
  // (The old code returned null here whenever the next zone was enemy-side with
  // no co-located creeps, hard-freezing every production bot at the frontier so
  // it never pushed, attacked, or — since buying only happens in the fountain —
  // bought again.)
  const nextZone = getNextLaneZone(bot, assignedLane)
  if (nextZone) {
    const advancingIntoEnemy = !isOwnSide(nextZone, bot.team)
    const hasLaneSupport =
      getAlliedCreepsInZone(state, bot).length > 0 ||
      state.creeps.some((c) => c.zone === nextZone && c.team === bot.team && c.hp > 0) ||
      getAlliedHeroesInZone(state, bot).length > 0
    if (!advancingIntoEnemy || hasLaneSupport) {
      return { type: 'move', zone: nextZone }
    }
    return null
  }
  return null
}

/** Whether a zone is on the given team's half of the map (rivers/runes/roshan are neutral). */
function isOwnSide(zone: string, team: TeamId): boolean {
  if (team === 'radiant') {
    return zone.endsWith('-rad') || zone.startsWith('radiant') || zone.startsWith('jungle-rad')
  }
  return zone.endsWith('-dire') || zone.startsWith('dire') || zone.startsWith('jungle-dire')
}

export function cleanupBotState(playerId: string): void {
  comboStates.delete(playerId)
}
