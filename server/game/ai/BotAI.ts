import type {
  GameState,
  PlayerState,
  TeamId,
  WaveUnitState,
  IceState,
  SiltDwellerState,
  CacheState,
} from '~~/shared/types/game'
import type { Command, TargetRef } from '~~/shared/types/commands'
import type { AbilityDef } from '~~/shared/types/hero'
import { HEROES } from '~~/shared/constants/heroes'
import { getItem } from '~~/shared/constants/items'
import {
  recommendedItemsForRole,
  damageMixForHeroes,
  counterItemsFor,
} from '~~/shared/constants/itemBuilds'
import { getTalentTree } from '~~/shared/constants/talents'
import { findPath, getDistance, areAdjacent } from '~~/server/game/map/topology'
import {
  WARD_LIMIT_PER_TEAM,
  HARDEN_COOLDOWN_CYCLES,
  SELL_REFUND_RATIO,
  BURN_HP_THRESHOLD,
  BREACH_BW_COST,
  waveUnitMaxHp,
} from '~~/shared/constants/balance'
import { LANE_ROUTES } from '~~/shared/constants/lanes'
import { ZONE_MAP, isShopZoneFor } from '~~/shared/constants/zones'
import { TERMINAL_ZONES } from '~~/server/game/engine/TerminalSystem'
import { fastGameFactor } from '~~/server/game/engine/fastGame'
import { getAbilityLevel } from '~~/server/game/heroes/_base'
import { getAbilityBwCost } from '~~/shared/utils/ability'
import { getBotDifficultyConfig, type BotDifficultyConfig } from './BotManager'

// Item build orders now live in shared/constants/itemBuilds (the SINGLE source
// shared with the shop UI, which recommends them to the human player). The bot
// keeps the name `buildOrderForRole`; tryBuyItem buys the first affordable item
// in the list and STOPS, so list order = purchase priority.
export const buildOrderForRole = recommendedItemsForRole

// Defensive consumables bots keep stocked (one of each)
const BOT_CONSUMABLES = ['trauma_patch', 'recall_token']

/**
 * Deaths before a bot will itemise against the enemy draft.
 *
 * The draft skew alone is NOT the trigger. A bot winning its lane against a
 * code-heavy team is not being hurt by code damage, and making it buy ice
 * anyway would only slow its build — the greedy order is correct while it is
 * ahead. Deaths are the cheapest honest evidence that what the enemy deals is
 * actually landing.
 */
const COUNTER_BUY_DEATHS = 3

/** At most one counter item — past that the bot has stopped building a hero. */
const MAX_COUNTER_ITEMS = 1

// Heroes with invisibility abilities — drives SNIFFER purchasing.
// Only Cipher (W) and Daemon (passive) grant stealth; see VisionCalculator's
// INVISIBILITY_BUFF_IDS for the authoritative buff list.
const INVIS_HEROES = new Set(['cipher', 'daemon'])

// Items a bot will sell to make room for a higher-priority purchase
const SELLABLE_ITEMS = new Set([
  'trauma_patch',
  'recall_token',
  'camtap',
  'sniffer',
  'scrap_lot',
  'boots',
  'quelling_blade',
])

// Combat item actives a bot uses mid-fight. Every one mirrors validateAction's
// `use` gates via itemOffCooldown (owned + not on item_cd) and resolves cleanly:
// the self-cast ones take no target; the targeted ones (Burnout/Ethereal/Hex/
// Cyclone) all require an alive enemy hero in the same zone, which the in-combat
// caller already has. Only items that appear in a build order are listed — a bot
// never owns the rest. Defensive = survive a fight; offensive = control + burst.
// All three are self-cast (no target): Hardshell (magic immunity) and Spite Plate
// (reflect) are carry/tank cores; Lotus Orb (spell-reflect shield) is the
// support core — so under-pressure survival now fires across every role.
const DEFENSIVE_COMBAT_ITEMS = ['hardshell', 'spite_plate', 'mirror_shell']

/** Bot owns the item and its active is not on cooldown (mirrors validateAction). */
function itemOffCooldown(bot: PlayerState, item: string): boolean {
  return (
    bot.items.includes(item) &&
    !bot.buffs.some((b) => b.id === `item_cd_${item}` && b.cyclesRemaining > 0)
  )
}

/**
 * Deterministic pseudo-random in [0, 1) from (id, cycle). Keeps bot behavior
 * reproducible across tests (Math.random would make assertion-based tests flaky).
 * Uses a simple xfnv1a-ish hash; quality doesn't matter, only uniformity.
 */
function deterministicRoll(id: string, cycle: number): number {
  let hash = 2166136261
  for (let i = 0; i < id.length; i++) {
    hash = Math.imul(hash ^ id.charCodeAt(i), 16777619)
  }
  hash = Math.imul(hash ^ cycle, 16777619)
  return ((hash >>> 0) % 10000) / 10000
}

/** Magic-immune / invulnerable targets negate the pure code-burst items (Burnout, Ethereal). */
function isAirgapTarget(p: PlayerState): boolean {
  return p.buffs.some(
    (b) => (b.id === 'airgap' || b.id === 'invulnerable') && b.cyclesRemaining > 0,
  )
}

const HARD_CONTROL_EFFECTS = new Set(['stun', 'silence', 'root', 'taunt', 'fear', 'hex', 'cyclone'])

/**
 * R4-12: true when the intended cast needs the target BREACHED first —
 * hard control fails and code damage is halved into a closed target.
 * Airgapped targets cannot be breached; skip.
 */
function needsBreach(target: PlayerState, ability: AbilityDef): boolean {
  if (target.buffs.some((b) => b.id === 'breached' && b.cyclesRemaining > 0)) return false
  if (isAirgapTarget(target)) return false
  const hardControl = ability.effects.some((e) => HARD_CONTROL_EFFECTS.has(e.type))
  const primarilyCode =
    ability.damageType === 'code' ||
    ability.effects.some((e) => e.type === 'damage' && e.damageType === 'code')
  return hardControl || primarilyCode
}

/** Canonical shop cost; an unknown item is treated as unaffordable (never bought). */
function itemCost(id: string): number {
  return getItem(id)?.cost ?? Number.POSITIVE_INFINITY
}

/** Pop a salve when below this INTEG% (out of combat). */
const SALVE_HP_PERCENT = 60
/** TP home instead of walking when the fountain is further than this. */
const TP_RETREAT_MIN_DISTANCE = 2

const CACHE_ZONES = ['cache-seawall', 'cache-shallows']
const JUNGLE_ZONES = [
  'silt-chaff-upper',
  'silt-chaff-lower',
  'silt-audit-upper',
  'silt-audit-lower',
]

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

  // --- Support heroes: peel/fortify combos ---

  sentry: [
    {
      name: 'fortify',
      sequence: [{ ability: 'e' }, { ability: 'r' }],
      conditions: ['enemy_present'],
    },
  ],
  proxy: [
    {
      name: 'harass',
      sequence: [{ ability: 'q' }, { ability: 'e' }],
      conditions: ['enemy_present'],
    },
  ],
  cron: [
    {
      name: 'rally',
      sequence: [{ ability: 'e' }, { ability: 'r' }],
      conditions: ['enemy_present'],
    },
  ],

  // --- Offlaners: CC chain combos ---

  socket: [
    {
      name: 'lockdown',
      sequence: [{ ability: 'q' }, { ability: 'e' }],
      conditions: ['enemy_present'],
    },
  ],
  mutex: [
    {
      name: 'lockdown',
      sequence: [{ ability: 'q' }, { ability: 'e' }],
      conditions: ['enemy_present'],
    },
  ],
  ping: [
    {
      name: 'disrupt',
      sequence: [{ ability: 'w' }, { ability: 'q' }],
      conditions: ['enemy_present'],
    },
    {
      name: 'flood',
      sequence: [{ ability: 'w' }, { ability: 'r' }],
      conditions: ['enemy_present'],
    },
  ],

  // --- Carries: build-then-burst combos ---

  malloc: [
    {
      name: 'allocate',
      sequence: [{ ability: 'q' }, { ability: 'w' }],
      conditions: ['enemy_present'],
    },
    {
      name: 'execute',
      sequence: [{ ability: 'e' }, { ability: 'w' }],
      conditions: ['low_hp_enemy'],
    },
  ],
  thread: [
    {
      name: 'mark',
      sequence: [{ ability: 'e' }, { ability: 'q' }],
      conditions: ['enemy_present'],
    },
    {
      name: 'overclock',
      sequence: [{ ability: 'e' }, { ability: 'r' }],
      conditions: ['enemy_present'],
    },
  ],

  // --- Assassins: open from stealth / isolate then burst ---

  cipher: [
    {
      name: 'burst',
      sequence: [{ ability: 'q' }, { ability: 'r' }],
      conditions: ['enemy_present'],
    },
  ],
  traceroute: [
    {
      name: 'hunt',
      sequence: [{ ability: 'w' }, { ability: 'q' }],
      conditions: ['enemy_present'],
    },
  ],

  // --- Mages: shred defenses then nuke ---

  null_ref: [
    {
      name: 'shred',
      sequence: [{ ability: 'q' }, { ability: 'w' }, { ability: 'r' }],
      conditions: ['enemy_present'],
    },
  ],
  lambda: [
    // 3 casts trigger Closure (free + 30% bonus dmg); R as the 3rd cast
    // gets the full amplification — the hero's defining synergy.
    {
      name: 'chain',
      sequence: [{ ability: 'q' }, { ability: 'e' }, { ability: 'r' }],
      conditions: ['enemy_present'],
    },
  ],

  // --- Tanks: CC chain / defensive combos ---

  firewall: [
    {
      name: 'containment',
      sequence: [{ ability: 'q' }, { ability: 'e' }],
      conditions: ['enemy_present'],
    },
  ],
  cache: [
    {
      name: 'evict',
      sequence: [{ ability: 'e' }, { ability: 'q' }],
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

function getEnemyWavesInZone(state: GameState, bot: PlayerState): WaveUnitState[] {
  return state.waves.filter((c) => c.zone === bot.zone && c.team !== bot.team && c.integ > 0)
}

function getAlliedWavesInZone(state: GameState, bot: PlayerState): WaveUnitState[] {
  return state.waves.filter((c) => c.zone === bot.zone && c.team === bot.team && c.integ > 0)
}

function getEnemyIceInZone(state: GameState, bot: PlayerState): IceState | undefined {
  return state.ice.find((t) => t.zone === bot.zone && t.team !== bot.team && t.alive)
}

function getNeutralsInZone(state: GameState, zone: string): SiltDwellerState[] {
  return state.neutrals.filter((n) => n.zone === zone && n.alive && n.integ > 0)
}

function getCachesInZone(state: GameState, zone: string): CacheState[] {
  return state.caches.filter((r) => r.zone === zone)
}

function getFountainZone(team: TeamId): string {
  return team === 'chaff' ? 'rookery-anchor' : 'landing-anchor'
}

function isInFountain(bot: PlayerState): boolean {
  return bot.zone === getFountainZone(bot.team)
}

function getHpPercent(bot: PlayerState): number {
  return bot.maxInteg > 0 ? (bot.integ / bot.maxInteg) * 100 : 0
}

function getMpPercent(bot: PlayerState): number {
  return bot.maxBw > 0 ? (bot.bw / bot.maxBw) * 100 : 0
}

function getItemCount(bot: PlayerState): number {
  return bot.items.filter((i) => i !== null).length
}

function getNextLaneZone(
  bot: PlayerState,
  lane: string,
  hasZone?: (id: string) => boolean,
): string | null {
  const route = LANE_ROUTES[lane]?.[bot.team]
  if (!route) return null
  const currentIdx = route.indexOf(bot.zone)
  if (currentIdx === -1) {
    const laneStart = route[2]
    if (!laneStart) return null
    const path = findPath(bot.zone, laneStart, hasZone)
    return path.length > 1 ? path[1]! : null
  }
  if (currentIdx < route.length - 1) {
    return route[currentIdx + 1]!
  }
  return null
}

function getClosestCacheZone(
  bot: PlayerState,
  state: GameState,
  hasZone?: (id: string) => boolean,
): string | null {
  let closest: string | null = null
  let minDist = Infinity
  for (const zone of CACHE_ZONES) {
    const caches = getCachesInZone(state, zone)
    if (caches.length > 0) {
      const dist = getDistance(bot.zone, zone, hasZone)
      if (dist < minDist) {
        minDist = dist
        closest = zone
      }
    }
  }
  return closest
}

function getClosestJungleZoneWithNeutrals(
  bot: PlayerState,
  state: GameState,
  hasZone?: (id: string) => boolean,
): string | null {
  let closest: string | null = null
  let minDist = Infinity
  for (const zone of JUNGLE_ZONES) {
    const neutrals = getNeutralsInZone(state, zone)
    if (neutrals.length > 0) {
      const dist = getDistance(bot.zone, zone, hasZone)
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
  // burns its one action per cycle on a cast the resolver always rejects:
  // it never attacks, never earns XP, never levels — and a whole game of
  // bots in that state deadlocks the match forever.
  // The cost has to be the RANK cost, not the registry's rank-1 headline: a
  // levelled bot reading the flat number queues casts it cannot pay for (up to
  // 2.2x short at rank 4) and the resolver rejects them, burning the cycle.
  return (
    getAbilityLevel(bot.level, slot) >= 1 &&
    bot.cooldowns[slot] === 0 &&
    bot.bw >= getAbilityBwCost(ability, slot, bot.level)
  )
}

// A few abilities consume a SELF-BUILT resource and are wasted — or outright
// rejected by the resolver — when cast without it. The generic ['r','q','w','e']
// cast priority is blind to those resources, so without a guard the bot spends
// its one action per cycle on a near-zero or auto-rejected cast instead of
// building the resource (attacking / using its other abilities). Swept from the
// hero resolvers, these are the only resource-gated casts:
//   • cache R (Eviction): black damage EQUALS stored energy; W (Flush): shield
//     equals it. At low energy R is a lone slow on a 50-cycle cooldown and W a
//     ~0 shield — hold until it's worth spending (Cache's build-then-burst).
//   • echo E (Feedback Loop): the resolver HARD-FAILS at 0 stored stacks, so
//     casting it then just burns the cycle. Stacks build from attacks.
const CACHE_MIN_ENERGY_TO_EVICT = 60
const CACHE_MIN_ENERGY_TO_FLUSH = 30

function lacksResourceForCast(bot: PlayerState, slot: AbilitySlot): boolean {
  const stacks = (id: string) => bot.buffs.find((b) => b.id === id)?.stacks ?? 0
  switch (bot.heroId) {
    case 'cache':
      if (slot === 'r') return stacks('cachedEnergy') < CACHE_MIN_ENERGY_TO_EVICT
      if (slot === 'w') return stacks('cachedEnergy') < CACHE_MIN_ENERGY_TO_FLUSH
      return false
    case 'echo':
      return slot === 'e' && stacks('feedbackLoop') <= 0
    default:
      return false
  }
}

/**
 * Expected-DPS threat model. Sums the actual damage of off-cooldown abilities
 * (damage/stun/slow/dot/execute effects) plus auto-attack DPS, then adjusts
 * for the level delta and item actives. A 50-BW 300-damage nuke now outscores
 * a 200-BW utility buff — the old `bwCost * 0.3` formula had them reversed.
 *
 * Used by `shouldRetreatFromThreat` to decide whether a bot is outmatched in
 * its current zone. The score is intentionally a rough proxy (cooldowns and
 * exact damage vary by level/rank), not a precise simulation.
 */
function abilityDamageValue(ability: AbilityDef): number {
  let total = 0
  for (const effect of ability.effects) {
    switch (effect.type) {
      case 'damage':
        // Some abilities list multiple damage effects (e.g. base + bonus);
        // summing them captures the full burst.
        total += effect.value
        break
      case 'dot':
        // DoT `value` is total over `duration` ticks — already the full payload.
        total += effect.value
        break
      case 'execute':
        // Execute abilities can deal massive damage; weight by the base
        // damage effect on the same ability if present, else a flat bonus.
        total += 150
        break
      case 'stun':
      case 'root':
      case 'silence':
      case 'fear':
      case 'taunt':
        // Hard CC is worth ~80 effective "damage" (a free turn to attack).
        total += 80
        break
      case 'slow':
        // Soft CC is worth less.
        total += 30
        break
      default:
        // Buffs/debuffs/heals/shields are situational; small contribution.
        total += 10
        break
    }
  }
  return total
}

function calculateThreatScore(enemy: PlayerState, bot: PlayerState, _state: GameState): number {
  let score = 0
  const hero = enemy.heroId ? HEROES[enemy.heroId] : null
  if (hero) {
    // Auto-attack DPS proxy: base attack scaled by level (growth).
    const enemyAttack =
      hero.baseStats.attack + (hero.growthPerLevel.attack ?? 0) * (enemy.level - 1)
    score += enemyAttack * 0.5

    // Sum actual damage of off-cooldown abilities the enemy can cast right now.
    if (enemy.bw > 0) {
      for (const slot of ['q', 'w', 'e', 'r'] as const) {
        if (enemy.cooldowns[slot] === 0) {
          const ability = hero.abilities[slot]
          // R requires level 6+ to cast; if enemy hasn't hit it, skip.
          if (slot === 'r' && enemy.level < 6) continue
          // Rank cost, not the rank-1 headline: an enemy who cannot pay for a
          // cast is not threatening with it, and reading the headline had bots
          // fleeing fights the enemy had no BW to win.
          if (enemy.bw >= getAbilityBwCost(ability, slot, enemy.level)) {
            score += abilityDamageValue(ability)
          }
        }
      }
    }

    // Item actives add burst potential — count known combat items.
    for (const item of enemy.items) {
      if (item === 'burnout') score += 300
      else if (item === 'phase_shim') score += 150
      else if (item === 'lockout_shunt') score += 80
      else if (item === 'discord_routine') score += 40
    }
  }

  // Level delta: a 3-level-ahead enemy is dramatically more dangerous.
  const levelDelta = enemy.level - bot.level
  score += levelDelta * 15

  // Low-HP enemies are less threatening (can't fight back long).
  const hpPercent = getHpPercent(enemy)
  if (hpPercent < 30) score -= 50
  else if (hpPercent < 50) score -= 25

  // K/D ratio as a soft signal of combat effectiveness.
  score += enemy.kills * 10
  score -= enemy.deaths * 5

  return score
}

export function shouldRetreatFromThreat(
  state: GameState,
  bot: PlayerState,
  config: BotDifficultyConfig,
): boolean {
  const hpPercent = getHpPercent(bot)
  const enemyHeroes = getEnemyHeroesInZone(state, bot)

  // Tier 1: Critical INTEG — always retreat below the configured floor.
  // Slower bots (reactionDelayTicks > 0) have a per-cycle chance to NOT react
  // yet, simulating slower reflexes. But a bot at <half the floor never delays.
  if (hpPercent < config.retreatHpPercent) {
    if (config.reactionDelayTicks > 0 && hpPercent > config.retreatHpPercent * 0.5) {
      const roll = deterministicRoll(bot.id, state.cycle)
      if (roll < config.reactionDelayTicks / 10) return false
    }
    return true
  }
  if (!config.threatAssessment || enemyHeroes.length === 0) return false

  // Graduated threat-based retreat — the lower the INTEG, the more cautious.
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

  // Tier 2: Outnumbered at moderate INTEG — retreat when losing the fight badly.
  // The INTEG threshold and the required threat ratio scale together: a hurt bot
  // (30% INTEG) retreats at a modest disadvantage (1.3x), a healthy bot (50% INTEG)
  // only retreats when badly outmatched (1.5x). Above 50% INTEG, hold ground.
  if (hpPercent < 50) {
    // Interpolate: at retreatHpPercent → 1.3x ratio, at 50% → 1.5x ratio.
    const ratio =
      1.3 + ((hpPercent - config.retreatHpPercent) / (50 - config.retreatHpPercent)) * 0.2
    if (totalEnemyThreat > totalAllyThreat * ratio) return true
  }

  // Tier 3: Gank awareness — even at high INTEG, retreat if severely outnumbered
  // (3+ enemies, alone) since a coordinated focus will burst through shields.
  if (enemyHeroes.length >= 3 && allies.length === 0 && hpPercent < 70) {
    return true
  }

  return false
}

function tryGetAbilityCommand(
  state: GameState,
  bot: PlayerState,
  enemiesInZone: PlayerState[],
  config: BotDifficultyConfig,
): Command | null {
  // Difficulty has to bite where a player can feel it. tryCombo already rolls
  // abilityComboChance for the scripted opener, but this fallback took no config
  // at all — so every bot, easy included, fired its ultimate the cycle it came off
  // cooldown and the combo roll only changed WHICH ability came out. Rolled on a
  // separate salt so a bot that fails its combo roll can still cast.
  if (deterministicRoll(`ability_${bot.id}`, state.cycle) > config.abilityComboChance) return null
  const hero = bot.heroId ? HEROES[bot.heroId] : null
  if (!hero) return null
  const alliesInZone = getAlliedHeroesInZone(state, bot)
  const slots: AbilitySlot[] = ['r', 'q', 'w', 'e']
  for (const slot of slots) {
    const ability = hero.abilities[slot]
    if (!canCastAbility(bot, ability, slot)) continue
    if (lacksResourceForCast(bot, slot)) continue
    const target = getAbilityTarget(ability, bot, enemiesInZone, alliesInZone)
    if (target === undefined) continue
    if (target === null) {
      return { type: 'cast', ability: slot }
    }
    // R4-12: medium+ bots breach before hard control / code into a closed target.
    // Easy bots (threatAssessment off) stay naive — they cast and waste the cycle.
    if (config.threatAssessment && target.kind === 'hero' && bot.bw >= BREACH_BW_COST) {
      const enemy = enemiesInZone.find(
        (e) => e.id === target.name || e.name === target.name || e.heroId === target.name,
      )
      if (enemy && needsBreach(enemy, ability)) {
        if (bot.buffs.some((b) => b.id === 'item_cd_breach' && b.cyclesRemaining > 0)) {
          // On cooldown — don't waste the cast into a closed target either;
          // fall through to the next ability.
          continue
        }
        return { type: 'breach', target }
      }
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
 * Pick the friendly target for an ally-only / supportive cast: the lowest-INTEG
 * ally in the zone, or the bot itself — NEVER an enemy. The per-hero resolvers
 * for these abilities (e.g. cron.q buff, proxy.r position swap, sentry heal)
 * reject any target whose team differs from the caster's, so a bot that aimed
 * one at an enemy would simply burn its one action for the cycle.
 *
 * `skipIfHealthy` is set for heal/shield/buff abilities so we don't waste BW
 * topping off a full-INTEG team; otherwise the cast always lands on a friendly
 * unit as long as one exists.
 *
 * When the bot is alone (no allies in zone) the only candidate is itself. Some
 * ally resolvers (cron.q buff, proxy.r position-swap) explicitly reject a
 * self-target with "Target must be an ally", so emitting a self-cast there
 * would burn the cycle. We only fall back to self when the ability is a heal or
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
      const target = enemiesInZone.reduce((a, b) => (a.integ < b.integ ? a : b))
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

/**
 * Total BW to cast a sequence of ability slots for a hero at `playerLevel`.
 * BW regen between casts is ignored on purpose — a conservative "can I finish
 * this combo?" check so a bot never burns its opener on a combo it can't
 * complete. Costs are per-rank for the same reason `canCastAbility` uses them:
 * summing the rank-1 headline made every levelled combo look affordable.
 */
export function sequenceBwCost(
  heroId: string,
  slots: Array<'q' | 'w' | 'e' | 'r'>,
  playerLevel: number,
): number {
  const abilities = HEROES[heroId]?.abilities
  if (!abilities) return 0
  return slots.reduce((sum, slot) => {
    const ability = abilities[slot]
    return sum + (ability ? getAbilityBwCost(ability, slot, playerLevel) : 0)
  }, 0)
}

function tryCombo(
  state: GameState,
  bot: PlayerState,
  enemiesInZone: PlayerState[],
  config: BotDifficultyConfig,
): Command | null {
  if (deterministicRoll(`combo_${bot.id}`, state.cycle) > config.abilityComboChance) return null
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
        canCastAbility(bot, HEROES[heroId]!.abilities[nextAbility.ability], nextAbility.ability) &&
        !lacksResourceForCast(bot, nextAbility.ability)
      ) {
        const newComboState: ComboState = {
          currentCombo: comboState.currentCombo,
          comboIndex: comboState.comboIndex + 1,
          lastComboTick: state.cycle,
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
        if (target === null) {
          return { type: 'cast', ability: nextAbility.ability }
        }
        // R4-12: breach before the next combo step if the target is closed.
        if (config.threatAssessment && target.kind === 'hero' && bot.bw >= BREACH_BW_COST) {
          const ability = HEROES[heroId]!.abilities[nextAbility.ability]
          const enemy = enemiesInZone.find(
            (e) => e.id === target.name || e.name === target.name || e.heroId === target.name,
          )
          if (
            enemy &&
            ability &&
            needsBreach(enemy, ability) &&
            !bot.buffs.some((b) => b.id === 'item_cd_breach' && b.cyclesRemaining > 0)
          ) {
            // Don't advance combo index — re-try this step next cycle after breach.
            comboStates.set(bot.id, {
              currentCombo: comboState.currentCombo,
              comboIndex: comboState.comboIndex,
              lastComboTick: state.cycle,
            })
            return { type: 'breach', target }
          }
        }
        return { type: 'cast', ability: nextAbility.ability, target }
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
    // Don't open a combo we can't afford to finish — a half-combo wastes the
    // opener's BW and leaves the bot mid-rotation with nothing.
    if (
      bot.bw <
      sequenceBwCost(
        heroId,
        combo.sequence.map((s) => s.ability),
        bot.level,
      )
    )
      continue
    const firstAbility = combo.sequence[0]
    if (
      firstAbility &&
      canCastAbility(bot, HEROES[heroId]!.abilities[firstAbility.ability], firstAbility.ability) &&
      !lacksResourceForCast(bot, firstAbility.ability)
    ) {
      comboStates.set(bot.id, {
        currentCombo: [combo.name],
        comboIndex: 1,
        lastComboTick: state.cycle,
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

/**
 * The counter item this bot should buy next, if any.
 *
 * Exported for the tests: the interesting cases are the ones where it returns
 * NOTHING (balanced draft, bot not dying, counter already owned), and those are
 * invisible from the outside — a bot that skips the counter buy and a bot that
 * never considered one produce the same `buy` command.
 */
export function counterBuyFor(bot: PlayerState, state: GameState): string | null {
  if (bot.deaths < COUNTER_BUY_DEATHS) return null

  const enemyHeroIds = Object.values(state.players)
    .filter((p) => p.team !== bot.team)
    .map((p) => p.heroId)
  const counters = counterItemsFor(damageMixForHeroes(enemyHeroIds))
  if (counters.length === 0) return null

  const owned = counters.filter((id) => bot.items.includes(id)).length
  if (owned >= MAX_COUNTER_ITEMS) return null

  // Cheapest affordable one it does not already have. No `break` on the first
  // unaffordable entry: unlike the core build there is nothing to save FOR
  // here, so a bot that cannot afford the cheap counter simply keeps building.
  for (const itemId of counters) {
    if (bot.items.includes(itemId)) continue
    if (bot.scrip >= itemCost(itemId)) return itemId
  }
  return null
}

function tryBuyItem(bot: PlayerState, state: GameState): Command | null {
  if (getItemCount(bot) >= 6) return null
  // Keep one of each defensive consumable stocked before core items
  for (const item of BOT_CONSUMABLES) {
    if (!bot.items.includes(item) && bot.scrip >= itemCost(item)) {
      return { type: 'buy', item }
    }
  }
  // Support bots keep an CAMTAP on hand for team vision (placed by
  // tryPlaceWard). Cheap, so bought before saving for the next core item.
  const role = bot.heroId ? HEROES[bot.heroId]?.role : undefined
  if (role === 'support' && !bot.items.includes('camtap') && bot.scrip >= itemCost('camtap')) {
    return { type: 'buy', item: 'camtap' }
  }
  // A bot that keeps dying to a lopsided draft buys against it, AHEAD of its
  // next core item — the whole point is that it arrives before the next death.
  const counter = counterBuyFor(bot, state)
  if (counter) return { type: 'buy', item: counter }

  const buildOrder = buildOrderForRole(role)
  for (const itemId of buildOrder) {
    if (bot.items.includes(itemId)) continue
    if (bot.scrip >= itemCost(itemId)) {
      return { type: 'buy', item: itemId }
    }
    break
  }
  return null
}

/**
 * How much an item has to be worth before it is worth WALKING HOME for.
 *
 * The trip is not free: base and lane are three or four zones apart, so a
 * round trip is roughly ten cycles of no farm, no XP and no lane presence.
 * The 400-odd scrip starter items are not worth that — a bot picks those up on
 * its next natural visit (a respawn, a retreat, or simply passing through its
 * base). What IS worth the walk is the 1400-2500 core the bot has been saving
 * for, which is exactly the band that was going unspent.
 */
const SHOPPING_TRIP_MIN_COST = 1000

/**
 * The next core item this bot could buy right now, if it were standing in a
 * shop. `null` when it cannot afford the next thing on its list.
 */
function affordableCoreItem(bot: PlayerState): string | null {
  if (getItemCount(bot) >= 6) return null
  const role = bot.heroId ? HEROES[bot.heroId]?.role : undefined
  for (const itemId of buildOrderForRole(role)) {
    if (bot.items.includes(itemId)) continue
    return bot.scrip >= itemCost(itemId) ? itemId : null
  }
  return null
}

/**
 * Go and spend it.
 *
 * Bots only ever reached a shop by DYING. Between deaths their income just
 * accumulated, so a twenty-minute match ended with heroes standing on two
 * thousand unspent scrip and two consumables — the bot had the item, it just
 * never walked to the counter. Farm is worth ~4sc/cycle passive plus strips;
 * a 2300sc core is worth far more than the ten cycles the round trip costs,
 * which is exactly why human players go back.
 *
 * Deliberately ABOVE wave farming in the decision order: "there is still a
 * wave here" is always true, so anything ranked below it never fires. Below
 * combat and objectives, so a bot never walks out of a fight to shop.
 */
function tryShoppingTrip(
  state: GameState,
  bot: PlayerState,
  hasZone: (id: string) => boolean,
): Command | null {
  if (isShopZoneFor(bot.zone, bot.team)) return null
  if (getEnemyHeroesInZone(state, bot).length > 0) return null
  const item = affordableCoreItem(bot)
  if (!item || itemCost(item) < SHOPPING_TRIP_MIN_COST) return null

  const home = getFountainZone(bot.team)
  // A recall is faster than the walk and the bot is already carrying one for
  // exactly this kind of trip.
  if (
    bot.items.includes('recall_token') &&
    getDistance(bot.zone, home, hasZone) > TP_RETREAT_MIN_DISTANCE
  ) {
    return { type: 'use', item: 'recall_token' }
  }
  const path = findPath(bot.zone, home, hasZone)
  return path.length > 1 ? { type: 'move', zone: path[1]! } : null
}

// Strategic ward spots — the cache/river control points worth team vision.
const STRATEGIC_WARD_ZONES = CACHE_ZONES

function teamWardCount(state: GameState, team: TeamId): number {
  let count = 0
  for (const zone of Object.values(state.zones)) {
    for (const ward of zone.wards) {
      if (ward.team === team) count++
    }
  }
  return count
}

function teamHasWardInZone(state: GameState, zoneId: string, team: TeamId): boolean {
  return (state.zones[zoneId]?.wards ?? []).some((w) => w.team === team)
}

/**
 * A ward-carrying bot (only supports buy CAMTAPs) drops one on a
 * strategic cache/river zone it's standing in or next to — giving its team
 * (including any human ally) map vision where it matters. Mirrors placeWard's
 * gates (team under WARD_LIMIT, zone not already team-warded) and validateAction's
 * current-or-adjacent rule, so the `ward` lands instead of wasting the cycle.
 */
export function tryPlaceWard(state: GameState, bot: PlayerState): Command | null {
  if (!bot.items.includes('camtap')) return null
  if (teamWardCount(state, bot.team) >= WARD_LIMIT_PER_TEAM) return null
  for (const zone of STRATEGIC_WARD_ZONES) {
    if (zone !== bot.zone && !areAdjacent(bot.zone, zone)) continue
    if (teamHasWardInZone(state, zone, bot.team)) continue
    return { type: 'tap', zone }
  }
  return null
}

/** Support bots also buy SNIFFERs for true-sight (reveals invisible enemies
 *  in a zone). Only bought when the enemy team has invisibility heroes. */
function tryBuySentryWard(bot: PlayerState, state: GameState): Command | null {
  if (getItemCount(bot) >= 6) return null
  const role = bot.heroId ? HEROES[bot.heroId]?.role : undefined
  if (role !== 'support') return null
  if (bot.items.includes('sniffer')) return null
  if (bot.scrip < itemCost('sniffer')) return null
  // Only buy sentries when the enemy has invisibility-capable heroes
  const hasInvisEnemy = Object.values(state.players).some(
    (p) => p.team !== bot.team && p.alive && p.heroId && INVIS_HEROES.has(p.heroId),
  )
  if (!hasInvisEnemy) return null
  return { type: 'buy', item: 'sniffer' }
}

/** Place a sentry ward for true-sight in the current/adjacent zone when
 *  invisible enemies are likely nearby (enemy invis hero on the map). */
function tryPlaceSentryWard(state: GameState, bot: PlayerState): Command | null {
  if (!bot.items.includes('sniffer')) return null
  if (teamWardCount(state, bot.team) >= WARD_LIMIT_PER_TEAM) return null
  const hasInvisEnemy = Object.values(state.players).some(
    (p) => p.team !== bot.team && p.alive && p.heroId && INVIS_HEROES.has(p.heroId),
  )
  if (!hasInvisEnemy) return null
  // Place on the current zone or an adjacent river/silt zone
  const candidates = [
    bot.zone,
    ...Object.values(state.zones)
      .map((z) => z.id)
      .filter((id) => areAdjacent(bot.zone, id)),
  ]
  for (const zone of candidates) {
    const hasSentry = (state.zones[zone]?.wards ?? []).some(
      (w) => w.team === bot.team && w.type === 'sniffer',
    )
    if (!hasSentry) return { type: 'tap', zone }
  }
  return null
}

/** Tenant is only worth STARTING at (near-)full INTEG; anything in between belongs
 *  to whichever team is already on him. */
const TENANT_START_HP_FRACTION = 0.7
/** Below this he is a steal target — dive in even without the full squad. */
const TENANT_SNIPE_HP_FRACTION = 0.4
/** Minimum level to open a fresh Tenant (he hits for TENANT_ATTACK a cycle). */
const TENANT_START_MIN_LEVEL = 8
/** Allies (excluding the bot) that must be able to JOIN for the call to be made. */
const TENANT_START_MIN_ALLIES = 2
/**
 * How close the bot MAKING the call has to be.
 *
 * Calling and joining are different jobs, and conflating them deadlocked the
 * objective: the open condition used to require two allies already within two
 * zones of the pit, but no bot walks toward the pit until its team has
 * committed, and the team only commits when someone opens. Nobody could go
 * first, so across 20 simulated matches the Tenant died 0.4 times — a major
 * objective that essentially never happened.
 *
 * Now the CALLER must be near (this radius) while the allies it counts only have
 * to be able to ARRIVE (TENANT_MAX_TRAVEL_DISTANCE). One bot commits the team,
 * and the existing 'committed' branch pulls the rest in.
 */
const TENANT_CALL_MAX_DISTANCE = 2
/** How far a bot will travel to join its team's attempt. */
const TENANT_MAX_TRAVEL_DISTANCE = 3
/** How long a team's commitment lasts before the attempt is written off. */
const TENANT_ATTEMPT_WINDOW_TICKS = 30
/** Lockout after an attempt window closes, so a team doesn't camp the pit. */
const TENANT_TEAM_COOLDOWN_TICKS = 90
/** Health to open on him with. */
const TENANT_START_MIN_HP_PERCENT = 70
/**
 * Health to keep swinging at a Tenant the team already committed to. Held well
 * clear of one TENANT_ATTACK so nobody dies to the pit, but far below the START
 * floor — applying the opening floor for the whole fight let each bot land two
 * hits and walk out, which chipped Tenant without ever killing him.
 */
const TENANT_HOLD_MIN_HP_PERCENT = 45

/**
 * Tick at which each team last committed to Tenant, keyed `${gameId}|${team}`.
 * Without it the start condition re-fires every cycle it holds, so the whole team
 * abandons its lanes and lives in the pit. Cleared per game by `cleanupBotGameState`.
 */
const tenantAttempts = new Map<string, number>()

type TenantPhase = 'open' | 'committed' | 'cooling'

function tenantAttemptPhase(key: string, cycle: number): TenantPhase {
  const started = tenantAttempts.get(key)
  // A cycle BEHIND the recorded start means a different game reused the key
  // (unit fixtures, a fresh match) — treat it as no attempt on record.
  if (started === undefined || cycle < started) return 'open'
  const elapsed = cycle - started
  if (elapsed < TENANT_ATTEMPT_WINDOW_TICKS) return 'committed'
  if (elapsed < TENANT_ATTEMPT_WINDOW_TICKS + TENANT_TEAM_COOLDOWN_TICKS) return 'cooling'
  return 'open'
}

/**
 * Tenant awareness. This used to be a pure LAST-HIT check ("only contest below
 * 40% INTEG") — but Tenant takes damage from nothing except heroes, and no bot would
 * open on him above 40%, so in a bots-only or human+bots match his INTEG never moved
 * and the Backup never dropped. It is now a START condition (near-full Tenant, a
 * squad already near the pit, level 8+), with the old 40% clause kept as an
 * opportunistic steal for whoever did NOT start him.
 *
 * Only a core role (carry/tank/assassin/mage) OPENS one, but any role within a
 * few zones joins once the call is made: Tenant focuses the lowest-INTEG hero in
 * the pit, so extra bodies spread his damage and the squad survives long enough
 * to finish. Distance-bounded either way — a bot trekking across the map for
 * Tenant is a lane thrown away.
 */
function tryTenant(
  state: GameState,
  bot: PlayerState,
  config: BotDifficultyConfig,
  gameId: string,
  hasZone?: (id: string) => boolean,
): Command | null {
  if (!config.threatAssessment) return null
  const tenant = state.tenant
  if (!tenant.alive) return null
  // Subset maps (one-lane, two-lane) have no pit at all.
  if (hasZone && !hasZone('hollow')) return null
  // Checked before the attempt is recorded: a bot that could never get there
  // must not consume its team's one commitment window.
  const distance = getDistance(bot.zone, 'hollow', hasZone)
  if (distance > TENANT_MAX_TRAVEL_DISTANCE) return null

  const key = `${gameId}|${bot.team}`
  const phase = tenantAttemptPhase(key, state.cycle)
  const hpFraction = tenant.maxInteg > 0 ? tenant.integ / tenant.maxInteg : 0
  const snipe = hpFraction < TENANT_SNIPE_HP_FRACTION

  if (phase === 'committed') {
    if (getHpPercent(bot) < TENANT_HOLD_MIN_HP_PERCENT) return null
  } else {
    const role = bot.heroId ? HEROES[bot.heroId]?.role : undefined
    if (role !== 'carry' && role !== 'tank' && role !== 'assassin' && role !== 'mage') return null
    if (getHpPercent(bot) < TENANT_START_MIN_HP_PERCENT) return null
    // A team inside its lockout only re-engages to steal a nearly-dead Tenant.
    if (phase === 'cooling' && !snipe) return null
    if (!snipe && hpFraction < TENANT_START_HP_FRACTION) return null
    if (bot.level < (snipe ? 6 : TENANT_START_MIN_LEVEL)) return null
    // The caller has to be at the pit's door, not across the map.
    if (!snipe && distance > TENANT_CALL_MAX_DISTANCE) return null
    // The allies only have to be able to GET there — see TENANT_CALL_MAX_DISTANCE.
    const alliesAbleToJoin = Object.values(state.players).filter(
      (p) =>
        p.team === bot.team &&
        p.alive &&
        p.id !== bot.id &&
        getDistance(p.zone, 'hollow', hasZone) <= TENANT_MAX_TRAVEL_DISTANCE,
    ).length
    if (alliesAbleToJoin < (snipe ? 1 : TENANT_START_MIN_ALLIES)) return null
    tenantAttempts.set(key, state.cycle)
  }

  if (bot.zone === 'hollow') {
    return { type: 'attack', target: { kind: 'tenant' } }
  }
  const path = findPath(bot.zone, 'hollow', hasZone)
  if (path.length > 1) return { type: 'move', zone: path[1]! }
  return null
}

/** Grab the Backup when it has dropped in the Tenant pit and is still unclaimed.
 *  The backup only ever lands in hollow, so a bot already there (e.g. the one
 *  that just contested Tenant) picks it up; otherwise it only diverts when the
 *  pit is adjacent — it never abandons its lane to trek across the map for it. */
function tryBackup(
  state: GameState,
  bot: PlayerState,
  config: BotDifficultyConfig,
  hasZone?: (id: string) => boolean,
): Command | null {
  if (!config.threatAssessment) return null
  const backup = state.backup
  if (!backup || backup.holderId) return null // none on the ground / already held
  if (bot.zone === 'hollow') return { type: 'backup' }
  // Only divert when the pit is right next to us (don't cross the map for it).
  if ((!hasZone || hasZone('hollow')) && getDistance(bot.zone, 'hollow', hasZone) <= 1) {
    const path = findPath(bot.zone, 'hollow', hasZone)
    if (path.length > 1) return { type: 'move', zone: path[1]! }
  }
  return null
}

/** Buyback — when dead and the game is still winnable, buy back if the bot
 *  has enough scrip and the cooldown is clear. Only when there's a fight to
 *  join (enemies near our structures) or the Terminal is threatened. */
function tryBuyback(
  state: GameState,
  bot: PlayerState,
  hasZone?: (id: string) => boolean,
): Command | null {
  if (bot.alive) return null
  if (bot.respawnCycle === null) return null
  // Can't buyback if on cooldown
  if (bot.buybackCooldown !== undefined && state.cycle < bot.buybackCooldown) return null
  if (bot.scrip < bot.buybackCost) return null
  // Don't buyback if respawn is imminent (within 2 ticks)
  if (bot.respawnCycle - state.cycle <= 2) return null
  // Buyback when the Terminal is under threat or allies are fighting near our base
  const enemyTeam: TeamId = bot.team === 'chaff' ? 'audit' : 'chaff'
  const ourBaseZone = bot.team === 'chaff' ? 'rookery-terminal' : 'landing-terminal'
  const enemyNearBase = Object.values(state.players).some(
    (p) => p.team === enemyTeam && p.alive && getDistance(p.zone, ourBaseZone, hasZone) <= 2,
  )
  if (enemyNearBase) return { type: 'buyback' }
  // Buyback if allies are in a teamfight (3+ allies fighting enemies)
  const alliesInFight = Object.values(state.players).filter(
    (p) =>
      p.team === bot.team &&
      p.alive &&
      Object.values(state.players).some(
        (e) => e.team === enemyTeam && e.alive && e.zone === p.zone,
      ),
  )
  if (alliesInFight.length >= 2) return { type: 'buyback' }
  return null
}

/** The cheapest item a bot would sell to free a slot, or null if it holds none.
 *  Used to make room (and check the real refund) for a higher-priority item. */
function cheapestSellableItem(bot: PlayerState): string | null {
  const sellable = bot.items.filter((i): i is string => i !== null && SELLABLE_ITEMS.has(i))
  if (sellable.length === 0) return null
  return [...sellable].sort((a, b) => itemCost(a) - itemCost(b))[0]!
}

/** Harden/fortification — pop team-wide ice invulnerability when the enemy
 *  team is diving a ice and it's about to fall. Only one harden per team
 *  per cooldown, so this is reserved for desperate saves. */
function tryGlyph(state: GameState, bot: PlayerState): Command | null {
  // Harden is a team command — any teammate can issue it. Check cooldown.
  const teamState = state.teams[bot.team]
  if (teamState.hardenUsedCycle !== null) {
    if (state.cycle - teamState.hardenUsedCycle < HARDEN_COOLDOWN_CYCLES) return null
  }
  // Only harden when an enemy hero is attacking one of our ice that's low
  const ourIce = state.ice.filter((t) => t.team === bot.team && t.alive)
  const enemyHeroes = Object.values(state.players).filter((p) => p.team !== bot.team && p.alive)
  for (const ice of ourIce) {
    if (ice.integ / ice.maxInteg > 0.25) continue // only harden a critically low ice
    const enemyOnIce = enemyHeroes.some((e) => e.zone === ice.zone)
    if (enemyOnIce) {
      // Bot must be on the same team and able to issue the command
      // (harden is team-wide, not zone-restricted)
      return { type: 'harden' }
    }
  }
  return null
}

/** A rescue that takes five ticks to arrive is a lane abandoned for nothing —
 *  the fight is over before the bot gets there. */
const DEFEND_MAX_DISTANCE = 3

/**
 * Defensive ice rotation. The trigger is OUTNUMBERED, not undefended: the old
 * "is any ally already at the ice?" test meant a single teammate caught 1-v-2
 * counted as the ice being handled, so nobody ever rotated to a fight already
 * in progress — and, perversely, a HUMAN doing the right thing (running back to
 * defend) was the thing that told the bots to stay in lane.
 *
 * Deliberately still ice-anchored: an ally outnumbered mid-silt gets nothing
 * from this. Bounded by distance so a bot never crosses the map for it.
 */
function tryDefendIce(
  state: GameState,
  bot: PlayerState,
  hasZone?: (id: string) => boolean,
): Command | null {
  const ourIce = state.ice.filter((t) => t.team === bot.team && t.alive)
  const enemyHeroes = Object.values(state.players).filter((p) => p.team !== bot.team && p.alive)
  const allies = Object.values(state.players).filter(
    (p) => p.team === bot.team && p.alive && p.id !== bot.id,
  )
  const threatened = ourIce.filter((ice) => {
    const enemiesHere = enemyHeroes.filter((e) => e.zone === ice.zone).length
    if (enemiesHere === 0) return false
    const alliesHere = allies.filter((a) => a.zone === ice.zone).length
    return alliesHere < enemiesHere
  })
  if (threatened.length === 0) return null
  // Move to the nearest threatened ice
  let closest: IceState | null = null
  let minDist = Infinity
  for (const ice of threatened) {
    const dist = getDistance(bot.zone, ice.zone, hasZone)
    if (dist < minDist) {
      minDist = dist
      closest = ice
    }
  }
  if (minDist > DEFEND_MAX_DISTANCE) return null
  if (closest && closest.zone !== bot.zone) {
    const path = findPath(bot.zone, closest.zone, hasZone)
    if (path.length > 1) return { type: 'move', zone: path[1]! }
  }
  return null
}

function tryPickupRune(
  state: GameState,
  bot: PlayerState,
  config: BotDifficultyConfig,
  hasZone?: (id: string) => boolean,
): Command | null {
  if (!config.cacheAwareness) return null
  const cachesInZone = getCachesInZone(state, bot.zone)
  if (cachesInZone.length > 0) {
    return { type: 'grab' }
  }
  const closestCacheZone = getClosestCacheZone(bot, state, hasZone)
  if (closestCacheZone && getDistance(bot.zone, closestCacheZone, hasZone) <= 2) {
    const path = findPath(bot.zone, closestCacheZone, hasZone)
    if (path.length > 1) {
      return { type: 'move', zone: path[1]! }
    }
  }
  return null
}

/**
 * Rotation — leave a quiet route to help one that is not.
 *
 * A bot's route is assigned once and never revisited, so it farms the same
 * three zones for the whole match while a teammate two routes over dies 2v1.
 * That is the single most visible way bots read as *not playing the game*: a
 * human immediately understands that nobody came.
 *
 * The guards matter more than the behaviour. A bot that rotates eagerly stops
 * farming, arrives late to every fight, and is worse than one that never moves
 * — so every one of these has to hold:
 *
 *   - the bot's OWN ground is quiet (no enemy heroes, no wave to clear)
 *   - a teammate is genuinely OUTNUMBERED, not merely fighting
 *   - the bot can actually arrive (bounded travel)
 *   - it is healthy enough to matter on arrival
 *   - and it is rate-limited, so two bots do not ping-pong across the map
 *     answering each other's calls
 */
const ROTATE_MAX_TRAVEL = 3
const ROTATE_MIN_HP_PERCENT = 55
const ROTATE_MIN_LEVEL = 4
/** Cycles a bot must farm before it may answer another call. */
const ROTATE_COOLDOWN_TICKS = 25
const lastRotation = new Map<string, number>()

function tryRotate(
  state: GameState,
  bot: PlayerState,
  config: BotDifficultyConfig,
  gameId: string,
  hasZone?: (id: string) => boolean,
): Command | null {
  if (!config.threatAssessment) return null
  if (bot.level < ROTATE_MIN_LEVEL) return null
  if (getHpPercent(bot) < ROTATE_MIN_HP_PERCENT) return null

  // Busy where you are: clearing a wave or in a fight beats walking away.
  if (getEnemyHeroesInZone(state, bot).length > 0) return null
  if (state.waves.some((c) => c.zone === bot.zone && c.team !== bot.team && c.integ > 0)) {
    return null
  }

  const key = `${gameId}|${bot.id}`
  const last = lastRotation.get(key)
  if (last !== undefined && state.cycle - last < ROTATE_COOLDOWN_TICKS) return null

  // Find the teammate in the worst spot that this bot could actually reach.
  let best: { zone: string; deficit: number; distance: number } | null = null
  for (const ally of Object.values(state.players)) {
    if (ally.team !== bot.team || !ally.alive || ally.id === bot.id) continue
    if (ally.zone === bot.zone) continue

    const enemies = Object.values(state.players).filter(
      (p) => p.team !== bot.team && p.alive && p.zone === ally.zone,
    ).length
    if (enemies === 0) continue
    const friends = Object.values(state.players).filter(
      (p) => p.team === bot.team && p.alive && p.zone === ally.zone,
    ).length
    const deficit = enemies - friends
    if (deficit <= 0) continue // a fair fight needs no rescue

    const distance = getDistance(bot.zone, ally.zone, hasZone)
    if (distance <= 0 || distance > ROTATE_MAX_TRAVEL) continue

    // Worst deficit first; nearer breaks the tie.
    if (!best || deficit > best.deficit || (deficit === best.deficit && distance < best.distance)) {
      best = { zone: ally.zone, deficit, distance }
    }
  }
  if (!best) return null

  const path = findPath(bot.zone, best.zone, hasZone)
  if (path.length <= 1) return null
  lastRotation.set(key, state.cycle)
  return { type: 'move', zone: path[1]! }
}

function tryFarmJungle(
  state: GameState,
  bot: PlayerState,
  config: BotDifficultyConfig,
  hasZone?: (id: string) => boolean,
): Command | null {
  if (!config.jungleFarming) return null
  const neutralsHere = getNeutralsInZone(state, bot.zone)
  if (neutralsHere.length > 0) {
    const target = neutralsHere.reduce((a, b) => (a.integ < b.integ ? a : b))
    const neutralIdx = state.neutrals.indexOf(target)
    return { type: 'attack', target: { kind: 'neutral', index: neutralIdx } }
  }
  const closestJungle = getClosestJungleZoneWithNeutrals(bot, state, hasZone)
  if (closestJungle && getDistance(bot.zone, closestJungle, hasZone) <= 3) {
    const path = findPath(bot.zone, closestJungle, hasZone)
    if (path.length > 1) {
      return { type: 'move', zone: path[1]! }
    }
  }
  return null
}

/**
 * Burn an allied wave out from under the enemy laner. Mirrors resolveDenyPhase's
 * window exactly — own team, at or below BURN_HP_THRESHOLD of the INTEG it SPAWNED
 * with — so the command resolves instead of silently burning the cycle, and uses
 * the zone-local index the resolver reads.
 *
 * Only fires with an enemy hero in the zone: with nobody to burn, killing your
 * own wave for half scrip just weakens your wave. Callers therefore place it in
 * the combat branch, below abilities, as a better use of a cycle than one more
 * right-click on a hero.
 */
function tryBurn(state: GameState, bot: PlayerState, config: BotDifficultyConfig): Command | null {
  if (!config.denyAwareness) return null
  const zoneWaves = state.waves.filter((c) => c.zone === bot.zone)
  let bestIdx = -1
  let bestHp = Infinity
  for (let i = 0; i < zoneWaves.length; i++) {
    const wave = zoneWaves[i]!
    if (wave.team !== bot.team || wave.integ <= 0) continue
    if (wave.integ > (wave.maxInteg ?? waveUnitMaxHp(wave.type, 0)) * BURN_HP_THRESHOLD) continue
    if (wave.integ < bestHp) {
      bestHp = wave.integ
      bestIdx = i
    }
  }
  if (bestIdx < 0) return null
  return { type: 'burn', target: { kind: 'wave', index: bestIdx } }
}

/**
 * The wave a bot swings at. On a failed last-hit roll it drops to the
 * SECOND-lowest wave rather than to no action at all: same cycle spent, same
 * damage dealt into the wave, only the scrip is missed. Returning null on a miss
 * was the original standstill bug — bots stopped out-clearing the incoming wave
 * and never reached a ice (pinned by BotForwardProgress).
 */
function pickWaveTarget(
  enemyWaves: WaveUnitState[],
  bot: PlayerState,
  cycle: number,
  config: BotDifficultyConfig,
): WaveUnitState {
  const byHp = [...enemyWaves].sort((a, b) => a.integ - b.integ)
  const lowest = byHp[0]!
  if (byHp.length < 2) return lowest
  if (deterministicRoll(`lasthit_${bot.id}`, cycle) < config.lastHitAccuracy) return lowest
  return byHp[1]!
}

/** Attack the enemy Terminal when in the enemy base and it is vulnerable. */
function tryAttackTerminal(state: GameState, bot: PlayerState): Command | null {
  const enemyTeam: TeamId = bot.team === 'chaff' ? 'audit' : 'chaff'
  if (bot.zone !== TERMINAL_ZONES[enemyTeam]) return null
  // Optional chaining guards old snapshots/fixtures created before Terminals existed
  const terminal = state.terminals?.[enemyTeam]
  if (!terminal || !terminal.alive || !terminal.vulnerable) return null
  return { type: 'attack', target: { kind: 'terminal' } }
}

/**
 * Pick a talent when the bot has reached a tier but not chosen yet. Deterministic
 * (no RNG, for replayable sims): prefer a concrete power talent (stat / damage
 * boost) over a situational one, else take the first option. select_talent is an
 * out-of-band special action, but decideBotAction returns one command per cycle,
 * so we only offer this when the bot has nothing more urgent to do (see caller).
 */
function tryPickTalent(bot: PlayerState): Command | null {
  if (!bot.heroId) return null
  const tree = getTalentTree(bot.heroId)
  if (!tree) return null
  for (const tier of [10, 15, 20, 25] as const) {
    if (bot.level >= tier && !bot.talents[`tier${tier}` as const]) {
      const opts = tree.tiers[tier]
      const preferred =
        opts.find((t) => t.type === 'stat_bonus' || t.type === 'damage_boost') ?? opts[0]!
      return { type: 'select_talent', tier, talentId: preferred.id }
    }
  }
  return null
}

/**
 * Mid-fight item micro for tactically-aware bots. Returns a `use` for one owned,
 * off-cooldown combat active (self-cast or targeted), or null. Called only when
 * enemy heroes share the bot's zone (the combat block), so it never fires out of
 * a fight. One use per cycle, naturally rate-limited by each item's cooldown.
 *
 * Gated on `threatAssessment` so naive (easy) bots stay naive while medium+ bots
 * stop sitting on their items — the most visible "bots ignore their inventory"
 * gap. Every `use` returned here resolves: self-cast actives have no target, and
 * the targeted ones aim at an enemy already confirmed alive + in-zone.
 *
 *  - Defensive (Hardshell magic-immunity, Spite Plate reflect) only when actually under
 *    pressure — hurt or outnumbered — not burned on a trivial skirmish.
 *  - Setup/control/burst on the kill target (lowest-INTEG enemy): Veil (zone magic-
 *    vuln) → Ethereal (kinetic-immune + 40% magic-vuln) → Hex (hard disable,
 *    still killable) → Burnout (300 magic nuke). Ethereal/Burnout are held if that
 *    target is magic-immune (they'd fizzle).
 *  - Cyclone (Eul's) is aimed at a SECONDARY enemy, never the kill target: it
 *    makes its victim invulnerable, so it removes a second threat rather than
 *    shielding the one we're trying to kill. Skipped in a 1v1.
 *  - Stack Overflow (double next ability) only when an ability is ready to spend
 *    the charge next cycle, so it's never wasted on a pure right-click.
 */
export function tryUseCombatItem(
  bot: PlayerState,
  enemiesInZone: PlayerState[],
  alliesInZone: PlayerState[],
  config: BotDifficultyConfig,
): Command | null {
  if (!config.threatAssessment || enemiesInZone.length === 0) return null

  // Defensive: hurt, or outnumbered in this zone (enemies > allies + self).
  const underPressure = getHpPercent(bot) < 80 || enemiesInZone.length > alliesInZone.length + 1
  if (underPressure) {
    for (const item of DEFENSIVE_COMBAT_ITEMS) {
      if (itemOffCooldown(bot, item)) return { type: 'use', item }
    }
  }

  // Offensive setup → control → burst, aimed at the kill target (lowest INTEG).
  const killTarget = enemiesInZone.reduce((a, b) => (a.integ < b.integ ? a : b))
  const killRef: TargetRef = { kind: 'hero', name: killTarget.id }
  const killImmune = isAirgapTarget(killTarget)

  if (itemOffCooldown(bot, 'discord_routine')) {
    return { type: 'use', item: 'discord_routine' }
  }
  if (!killImmune && itemOffCooldown(bot, 'phase_shim')) {
    return { type: 'use', item: 'phase_shim', target: killRef }
  }
  if (itemOffCooldown(bot, 'lockout_shunt')) {
    return { type: 'use', item: 'lockout_shunt', target: killRef }
  }
  // Cyclone a SECONDARY enemy (healthiest other threat) — never the kill target.
  if (enemiesInZone.length >= 2 && itemOffCooldown(bot, 'stasis_shunt')) {
    const secondary = enemiesInZone
      .filter((e) => e.id !== killTarget.id)
      .reduce((a, b) => (a.integ > b.integ ? a : b))
    return { type: 'use', item: 'stasis_shunt', target: { kind: 'hero', name: secondary.id } }
  }
  if (!killImmune && itemOffCooldown(bot, 'burnout')) {
    return { type: 'use', item: 'burnout', target: killRef }
  }

  // Stack Overflow: double the next ability — only with an ability to spend it.
  const hero = bot.heroId ? HEROES[bot.heroId] : null
  const hasAbilityReady =
    !!hero &&
    (['q', 'w', 'e', 'r'] as AbilitySlot[]).some((s) => canCastAbility(bot, hero.abilities[s], s))
  if (hasAbilityReady && itemOffCooldown(bot, 'stack_overflow')) {
    return { type: 'use', item: 'stack_overflow' }
  }
  return null
}

/**
 * A defensive panic item (Hardshell / Spite Plate) for a chased, RETREATING bot. The
 * retreat branch returns before the combat block, so without this a low-INTEG bot
 * being chased flees to its death with its survival items unused. Gated on
 * threatAssessment; mirrors validateAction's `use` gates so it always resolves.
 */
export function tryPanicDefensiveItem(
  bot: PlayerState,
  config: BotDifficultyConfig,
): Command | null {
  if (!config.threatAssessment) return null
  for (const item of DEFENSIVE_COMBAT_ITEMS) {
    if (itemOffCooldown(bot, item)) return { type: 'use', item }
  }
  return null
}

export function decideBotAction(
  state: GameState,
  bot: PlayerState,
  assignedLane: string,
  gameId?: string,
): Command | null {
  const config = getBotDifficultyConfig(gameId ?? '', bot.id)
  // Restrict pathfinding to the live game's zone set so subset maps
  // (one-lane, two-lane) produce in-bounds paths instead of routing
  // through zones that don't exist in this match.
  const hasZone = (id: string) => id in state.zones
  if (!bot.alive) {
    // Buyback when the game needs us (Terminal threatened or allies teamfighting)
    const buybackCmd = tryBuyback(state, bot, hasZone)
    if (buybackCmd) return buybackCmd
    if (bot.respawnCycle !== null && state.cycle >= bot.respawnCycle) {
      const fountain = getFountainZone(bot.team)
      if (bot.zone !== fountain) {
        return { type: 'move', zone: fountain }
      }
    }
    return null
  }
  // Any shop zone, not just the fountain. Bases sell too, and a bot walks
  // through its own base on the way out of every respawn — gating purchases on
  // the anchor alone threw away a free shopping stop each trip.
  if (isShopZoneFor(bot.zone, bot.team)) {
    const buyCmd = tryBuyItem(bot, state)
    if (buyCmd) return buyCmd
    // Buy sentry wards when enemy has invisibility heroes
    const sentryBuy = tryBuySentryWard(bot, state)
    if (sentryBuy) return sentryBuy
    // Sell a low-value item to make room when at 6 items — but only if the
    // sale actually unlocks the next core item. The refund is 50% of the SOLD
    // item's price (not the core's), so gate on the real sale proceeds.
    if (getItemCount(bot) >= 6) {
      const buildOrder = buildOrderForRole(bot.heroId ? HEROES[bot.heroId]?.role : undefined)
      const nextCore = buildOrder.find((id) => !bot.items.includes(id))
      const sellItem = nextCore ? cheapestSellableItem(bot) : null
      if (
        nextCore &&
        sellItem &&
        bot.scrip + Math.floor(itemCost(sellItem) * SELL_REFUND_RATIO) >= itemCost(nextCore)
      ) {
        return { type: 'sell', item: sellItem }
      }
    }
    // Only the fountain regenerates, so only there is standing still worth a
    // cycle. Done shopping in the BASE, the bot falls through to the normal
    // decision tree and walks itself back out.
    if (isInFountain(bot)) {
      if (getHpPercent(bot) >= 95 && getMpPercent(bot) >= 95) {
        const nextZone = getNextLaneZone(bot, assignedLane, hasZone)
        if (nextZone) return { type: 'move', zone: nextZone }
      }
      return null
    }
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
    bot.items.includes('trauma_patch') &&
    !bot.buffs.some((b) => b.id === 'trauma_patch_regen')
  ) {
    return { type: 'use', item: 'trauma_patch' }
  }
  if (shouldRetreatFromThreat(state, bot, config)) {
    const fountain = getFountainZone(bot.team)
    // TP home instead of walking when retreating from deep positions
    if (
      enemyHeroes.length === 0 &&
      bot.items.includes('recall_token') &&
      getDistance(bot.zone, fountain, hasZone) > TP_RETREAT_MIN_DISTANCE
    ) {
      return { type: 'use', item: 'recall_token' }
    }
    // Being chased (can't TP through combat): pop a survival item so the bot
    // doesn't flee to its death with Hardshell/Spite Plate unused.
    if (enemyHeroes.length > 0) {
      const panic = tryPanicDefensiveItem(bot, config)
      if (panic) return panic
    }
    const path = findPath(bot.zone, fountain, hasZone)
    if (path.length > 1) {
      // Escape a gank even while impaired: a root HARD-blocks the next move and
      // a slow gives it up to an 80% fail chance — either way the bot can die in
      // place. A mobility ITEM is resolved outside the movement phase, so it goes
      // through both. Prefer Blink (it lands on the exact retreat zone); else
      // Shove Splice, which auto-shoves toward our own fountain (same direction).
      // Unimpaired, a normal move is free — don't waste an item cooldown.
      const movementImpaired = bot.buffs.some((b) => b.id.includes('root') || b.id.includes('slow'))
      if (
        movementImpaired &&
        itemOffCooldown(bot, 'jump_shunt') &&
        areAdjacent(bot.zone, path[1]!)
      ) {
        return { type: 'use', item: 'jump_shunt', target: path[1]! }
      }
      if (movementImpaired && itemOffCooldown(bot, 'shove_splice')) {
        return { type: 'use', item: 'shove_splice' }
      }
      return { type: 'move', zone: path[1]! }
    }
    return null
  }
  // Spend a calm cycle (no enemy hero in zone) banking an unlocked talent so bots
  // aren't permanently down 1–4 talents on human players, then dropping a ward
  // on a strategic spot for team vision.
  if (enemyHeroes.length === 0) {
    // Harden to save a critically low ice from an enemy push (team-wide, any zone)
    const glyphCmd = tryGlyph(state, bot)
    if (glyphCmd) return glyphCmd
    const talentCmd = tryPickTalent(bot)
    if (talentCmd) return talentCmd
    const wardCmd = tryPlaceWard(state, bot)
    if (wardCmd) return wardCmd
    // Place sentry wards for true-sight against invisible enemies
    const sentryWardCmd = tryPlaceSentryWard(state, bot)
    if (sentryWardCmd) return sentryWardCmd
    // Rotate to a ice where the defenders are outnumbered
    const defendCmd = tryDefendIce(state, bot, hasZone)
    if (defendCmd) return defendCmd
    // Start (or steal) Tenant — carry/tank/assassin/mage only, squad nearby
    const tenantCmd = tryTenant(state, bot, config, gameId ?? '', hasZone)
    if (tenantCmd) return tenantCmd
    // Once Tenant is dead, grab the Backup drop from the pit
    const backupCmd = tryBackup(state, bot, config, hasZone)
    if (backupCmd) return backupCmd
  }
  const enemyWaves = getEnemyWavesInZone(state, bot)
  if (enemyHeroes.length > 0) {
    // Pop a combat item (Hardshell/Spite Plate to survive, Stack Overflow/Veil to amp)
    // before committing to a combo or right-click. One use per cycle, naturally
    // rate-limited by each item's cooldown, so this can't starve the bot's
    // damage — it falls through to the combo/ability/attack below once items
    // are spent or on cooldown.
    const itemCmd = tryUseCombatItem(bot, enemyHeroes, getAlliedHeroesInZone(state, bot), config)
    if (itemCmd) return itemCmd
    const comboCmd = tryCombo(state, bot, enemyHeroes, config)
    if (comboCmd) return comboCmd
    const abilityCmd = tryGetAbilityCommand(state, bot, enemyHeroes, config)
    if (abilityCmd) return abilityCmd
    // Below the burst, above the right-click: denying a dying allied wave
    // starves the laner opposite of scrip + XP for the same one action.
    const denyCmd = tryBurn(state, bot, config)
    if (denyCmd) return denyCmd
    const target = enemyHeroes.reduce((a, b) => (a.integ < b.integ ? a : b))
    return { type: 'attack', target: { kind: 'hero', name: target.id } }
  }
  // Win condition: hit the enemy Terminal when standing in their base and it's exposed
  const terminalCmd = tryAttackTerminal(state, bot)
  if (terminalCmd) return terminalCmd

  // In fast-game/test mode the loop is sped up to make matches end in minutes,
  // so bots push and breach DECISIVELY rather than last-hitting waves forever —
  // which keeps the play-to-the-end specs (game-over, smoke) fast. This is an
  // ADDITIONAL accelerator layered on top of the production pushing below; the
  // real game no longer depends on it for forward progress.
  const aggressivePush = fastGameFactor() > 1

  // Close out a won game: if the enemy Terminal is exposed, march straight to
  // their base to finish it. The retreat-from-threat check already ran above,
  // so a low-INTEG bot still backs off rather than feeding into base defenses.
  const enemyTeamForClose: TeamId = bot.team === 'chaff' ? 'audit' : 'chaff'
  const exposedTerminal = state.terminals?.[enemyTeamForClose]
  if (exposedTerminal?.alive && exposedTerminal.vulnerable) {
    const baseZone = TERMINAL_ZONES[enemyTeamForClose]
    if (bot.zone !== baseZone) {
      const path = findPath(bot.zone, baseZone, hasZone)
      if (path.length > 1) return { type: 'move', zone: path[1]! }
    }
  }

  // Aggressive breach (test mode only): topple the enemy ice in this zone, else
  // march toward the enemy base. Sits ABOVE wave farming so test games converge
  // quickly; production bots fall through to the game-state-driven push below.
  if (aggressivePush) {
    const iceHere = getEnemyIceInZone(state, bot)
    if (iceHere) return { type: 'attack', target: { kind: 'ice', zone: iceHere.zone } }
    const advanceZone = getNextLaneZone(bot, assignedLane, hasZone)
    if (advanceZone) return { type: 'move', zone: advanceZone }
  }

  // Clear the wave. A failed last-hit roll re-aims at the second-lowest
  // wave; it must never return null, which is what left production bots idling
  // in lane instead of pushing — one half of the "bots look stuck" report.
  // Banked enough for the next core? Go and buy it. See tryShoppingTrip for
  // why this outranks farming.
  const shopCmd = tryShoppingTrip(state, bot, hasZone)
  if (shopCmd) return shopCmd

  if (enemyWaves.length > 0) {
    const waveTarget = pickWaveTarget(enemyWaves, bot, state.cycle, config)
    // Wave targets use zone-local indices (Nth wave in the attacker's zone)
    const waveIdx = state.waves.filter((c) => c.zone === bot.zone).indexOf(waveTarget)
    return { type: 'attack', target: { kind: 'wave', index: waveIdx } }
  }
  const enemyIce = getEnemyIceInZone(state, bot)
  if (enemyIce && getAlliedWavesInZone(state, bot).length > 0) {
    return { type: 'attack', target: { kind: 'ice', zone: enemyIce.zone } }
  }
  const cacheCmd = tryPickupRune(state, bot, config, hasZone)
  if (cacheCmd) return cacheCmd

  // Nothing to do here — is someone else drowning? (Guards inside; this only
  // fires from a quiet zone for a healthy bot that can actually arrive.)
  const rotateCmd = tryRotate(state, bot, config, gameId ?? '', hasZone)
  if (rotateCmd) return rotateCmd

  if (assignedLane === 'silt' || (config.jungleFarming && getHpPercent(bot) > 60)) {
    const jungleCmd = tryFarmJungle(state, bot, config, hasZone)
    if (jungleCmd) return jungleCmd
  }

  // Forward progress (production) is driven by GAME STATE, not the test
  // accelerator. A bot advances freely on its own half of the map; it pushes
  // into enemy territory only with lane support — allied waves in this zone or
  // the next, or an ally hero alongside — so a lone level-1 hero never marches
  // into the enemy base and feeds. Waves spawn continuously, so a bot
  // holding at the frontier advances as soon as the next wave reaches it, and
  // the retreat-from-threat check above still pulls hurt/outnumbered bots back.
  // (The old code returned null here whenever the next zone was enemy-side with
  // no co-located waves, hard-freezing every production bot at the frontier so
  // it never pushed, attacked, or — since buying only happens in the fountain —
  // bought again.)
  const nextZone = getNextLaneZone(bot, assignedLane, hasZone)
  if (nextZone) {
    const advancingIntoEnemy = !isOwnSide(nextZone, bot.team)
    const hasLaneSupport =
      getAlliedWavesInZone(state, bot).length > 0 ||
      state.waves.some((c) => c.zone === nextZone && c.team === bot.team && c.integ > 0) ||
      getAlliedHeroesInZone(state, bot).length > 0
    if (!advancingIntoEnemy || hasLaneSupport) {
      return { type: 'move', zone: nextZone }
    }
    return null
  }
  return null
}

/** Whether a zone is on the given team's half of the map (rivers/caches/tenant are neutral). */
export function isOwnSide(zone: string, team: TeamId): boolean {
  // Data lookup, NOT an id substring test — zone ids carry no side semantics a
  // rename must preserve (the old endsWith('-rad') check inverted silently).
  return ZONE_MAP[zone]?.team === team
}

export function cleanupBotState(playerId: string): void {
  comboStates.delete(playerId)
}

/** Drop per-GAME bot bookkeeping (currently the per-team Tenant commitment). */
export function cleanupBotGameState(gameId: string): void {
  tenantAttempts.delete(`${gameId}|chaff`)
  tenantAttempts.delete(`${gameId}|audit`)
}
