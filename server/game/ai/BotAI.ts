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
import { getItem } from '~~/shared/constants/items'
import { recommendedItemsForRole } from '~~/shared/constants/itemBuilds'
import { getTalentTree } from '~~/shared/constants/talents'
import { findPath, getDistance, areAdjacent } from '~~/server/game/map/topology'
import {
  WARD_LIMIT_PER_TEAM,
  GLYPH_COOLDOWN_TICKS,
  SELL_REFUND_RATIO,
} from '~~/shared/constants/balance'
import { LANE_ROUTES } from '~~/shared/constants/lanes'
import { ANCIENT_ZONES } from '~~/server/game/engine/AncientSystem'
import { fastGameFactor } from '~~/server/game/engine/fastGame'
import { getAbilityLevel } from '~~/server/game/heroes/_base'
import { getBotDifficultyConfig, type BotDifficultyConfig } from './BotManager'

// Item build orders now live in shared/constants/itemBuilds (the SINGLE source
// shared with the shop UI, which recommends them to the human player). The bot
// keeps the name `buildOrderForRole`; tryBuyItem buys the first affordable item
// in the list and STOPS, so list order = purchase priority.
export const buildOrderForRole = recommendedItemsForRole

// Defensive consumables bots keep stocked (one of each)
const BOT_CONSUMABLES = ['healing_salve', 'town_portal_scroll']

// Heroes with invisibility abilities — drives Sentry Ward purchasing.
// Only Cipher (W) and Daemon (passive) grant stealth; see VisionCalculator's
// INVISIBILITY_BUFF_IDS for the authoritative buff list.
const INVIS_HEROES = new Set(['cipher', 'daemon'])

// Items a bot will sell to make room for a higher-priority purchase
const SELLABLE_ITEMS = new Set([
  'healing_salve',
  'town_portal_scroll',
  'observer_ward',
  'sentry_ward',
  'iron_branch',
  'boots',
  'quelling_blade',
])

// Combat item actives a bot uses mid-fight. Every one mirrors validateAction's
// `use` gates via itemOffCooldown (owned + not on item_cd) and resolves cleanly:
// the self-cast ones take no target; the targeted ones (Dagon/Ethereal/Hex/
// Cyclone) all require an alive enemy hero in the same zone, which the in-combat
// caller already has. Only items that appear in a build order are listed — a bot
// never owns the rest. Defensive = survive a fight; offensive = control + burst.
// All three are self-cast (no target): BKB (magic immunity) and Blade Mail
// (reflect) are carry/tank cores; Lotus Orb (spell-reflect shield) is the
// support core — so under-pressure survival now fires across every role.
const DEFENSIVE_COMBAT_ITEMS = ['black_king_bar', 'blade_mail', 'lotus_orb']

/** Bot owns the item and its active is not on cooldown (mirrors validateAction). */
function itemOffCooldown(bot: PlayerState, item: string): boolean {
  return (
    bot.items.includes(item) &&
    !bot.buffs.some((b) => b.id === `item_cd_${item}` && b.ticksRemaining > 0)
  )
}

/**
 * Deterministic pseudo-random in [0, 1) from (id, tick). Keeps bot behavior
 * reproducible across tests (Math.random would make assertion-based tests flaky).
 * Uses a simple xfnv1a-ish hash; quality doesn't matter, only uniformity.
 */
function deterministicRoll(id: string, tick: number): number {
  let hash = 2166136261
  for (let i = 0; i < id.length; i++) {
    hash = Math.imul(hash ^ id.charCodeAt(i), 16777619)
  }
  hash = Math.imul(hash ^ tick, 16777619)
  return ((hash >>> 0) % 10000) / 10000
}

/** Magic-immune / invulnerable targets negate the pure magical-burst items (Dagon, Ethereal). */
function isMagicImmuneTarget(p: PlayerState): boolean {
  return p.buffs.some(
    (b) => (b.id === 'magic_immune' || b.id === 'invulnerable') && b.ticksRemaining > 0,
  )
}

/** Canonical shop cost; an unknown item is treated as unaffordable (never bought). */
function itemCost(id: string): number {
  return getItem(id)?.cost ?? Number.POSITIVE_INFINITY
}

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

function getClosestRuneZone(
  bot: PlayerState,
  state: GameState,
  hasZone?: (id: string) => boolean,
): string | null {
  let closest: string | null = null
  let minDist = Infinity
  for (const zone of RUNE_ZONES) {
    const runes = getRunesInZone(state, zone)
    if (runes.length > 0) {
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
  // burns its one action per tick on a cast the resolver always rejects:
  // it never attacks, never earns XP, never levels — and a whole game of
  // bots in that state deadlocks the match forever.
  return (
    getAbilityLevel(bot.level, slot) >= 1 && bot.cooldowns[slot] === 0 && bot.mp >= ability.manaCost
  )
}

// A few abilities consume a SELF-BUILT resource and are wasted — or outright
// rejected by the resolver — when cast without it. The generic ['r','q','w','e']
// cast priority is blind to those resources, so without a guard the bot spends
// its one action per tick on a near-zero or auto-rejected cast instead of
// building the resource (attacking / using its other abilities). Swept from the
// hero resolvers, these are the only resource-gated casts:
//   • cache R (Eviction): pure damage EQUALS stored energy; W (Flush): shield
//     equals it. At low energy R is a lone slow on a 50-tick cooldown and W a
//     ~0 shield — hold until it's worth spending (Cache's build-then-burst).
//   • echo E (Feedback Loop): the resolver HARD-FAILS at 0 stored stacks, so
//     casting it then just burns the tick. Stacks build from attacks.
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
 * for the level delta and item actives. A 50-mana 300-damage nuke now outscores
 * a 200-mana utility buff — the old `manaCost * 0.3` formula had them reversed.
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
    if (enemy.mp > 0) {
      for (const slot of ['q', 'w', 'e', 'r'] as const) {
        if (enemy.cooldowns[slot] === 0) {
          const ability = hero.abilities[slot]
          // R requires level 6+ to cast; if enemy hasn't hit it, skip.
          if (slot === 'r' && enemy.level < 6) continue
          if (enemy.mp >= ability.manaCost) {
            score += abilityDamageValue(ability)
          }
        }
      }
    }

    // Item actives add burst potential — count known combat items.
    for (const item of enemy.items) {
      if (item === 'dagon') score += 300
      else if (item === 'ethereal_blade') score += 150
      else if (item === 'scythe_of_vyse') score += 80
      else if (item === 'veil_of_discord') score += 40
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

function shouldRetreatFromThreat(
  state: GameState,
  bot: PlayerState,
  config: BotDifficultyConfig,
): boolean {
  const hpPercent = getHpPercent(bot)
  const enemyHeroes = getEnemyHeroesInZone(state, bot)

  // Tier 1: Critical HP — always retreat below the configured floor.
  // Slower bots (reactionDelayTicks > 0) have a per-tick chance to NOT react
  // yet, simulating slower reflexes. But a bot at <half the floor never delays.
  if (hpPercent < config.retreatHpPercent) {
    if (config.reactionDelayTicks > 0 && hpPercent > config.retreatHpPercent * 0.5) {
      const roll = deterministicRoll(bot.id, state.tick)
      if (roll < config.reactionDelayTicks / 10) return false
    }
    return true
  }
  if (!config.threatAssessment || enemyHeroes.length === 0) return false

  // Graduated threat-based retreat — the lower the HP, the more cautious.
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

  // Tier 2: Outnumbered at moderate HP — retreat when losing the fight badly.
  // The HP threshold and the required threat ratio scale together: a hurt bot
  // (30% HP) retreats at a modest disadvantage (1.3x), a healthy bot (50% HP)
  // only retreats when badly outmatched (1.5x). Above 50% HP, hold ground.
  if (hpPercent < 50) {
    // Interpolate: at retreatHpPercent → 1.3x ratio, at 50% → 1.5x ratio.
    const ratio =
      1.3 + ((hpPercent - config.retreatHpPercent) / (50 - config.retreatHpPercent)) * 0.2
    if (totalEnemyThreat > totalAllyThreat * ratio) return true
  }

  // Tier 3: Gank awareness — even at high HP, retreat if severely outnumbered
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
): Command | null {
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

/**
 * Total mana to cast a sequence of ability slots for a hero. Mana regen between
 * casts is ignored on purpose — a conservative "can I finish this combo?" check
 * so a bot never burns its opener on a combo it can't complete.
 */
export function sequenceManaCost(heroId: string, slots: Array<'q' | 'w' | 'e' | 'r'>): number {
  const abilities = HEROES[heroId]?.abilities
  if (!abilities) return 0
  return slots.reduce((sum, slot) => sum + (abilities[slot]?.manaCost ?? 0), 0)
}

function tryCombo(
  state: GameState,
  bot: PlayerState,
  enemiesInZone: PlayerState[],
  config: BotDifficultyConfig,
): Command | null {
  if (deterministicRoll(`combo_${bot.id}`, state.tick) > config.abilityComboChance) return null
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
    // Don't open a combo we can't afford to finish — a half-combo wastes the
    // opener's mana and leaves the bot mid-rotation with nothing.
    if (
      bot.mp <
      sequenceManaCost(
        heroId,
        combo.sequence.map((s) => s.ability),
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
  for (const item of BOT_CONSUMABLES) {
    if (!bot.items.includes(item) && bot.gold >= itemCost(item)) {
      return { type: 'buy', item }
    }
  }
  // Support bots keep an Observer Ward on hand for team vision (placed by
  // tryPlaceWard). Cheap, so bought before saving for the next core item.
  const role = bot.heroId ? HEROES[bot.heroId]?.role : undefined
  if (
    role === 'support' &&
    !bot.items.includes('observer_ward') &&
    bot.gold >= itemCost('observer_ward')
  ) {
    return { type: 'buy', item: 'observer_ward' }
  }
  const buildOrder = buildOrderForRole(role)
  for (const itemId of buildOrder) {
    if (bot.items.includes(itemId)) continue
    if (bot.gold >= itemCost(itemId)) {
      return { type: 'buy', item: itemId }
    }
    break
  }
  return null
}

// Strategic ward spots — the rune/river control points worth team vision.
const STRATEGIC_WARD_ZONES = RUNE_ZONES

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
 * A ward-carrying bot (only supports buy Observer Wards) drops one on a
 * strategic rune/river zone it's standing in or next to — giving its team
 * (including any human ally) map vision where it matters. Mirrors placeWard's
 * gates (team under WARD_LIMIT, zone not already team-warded) and validateAction's
 * current-or-adjacent rule, so the `ward` lands instead of wasting the tick.
 */
export function tryPlaceWard(state: GameState, bot: PlayerState): Command | null {
  if (!bot.items.includes('observer_ward')) return null
  if (teamWardCount(state, bot.team) >= WARD_LIMIT_PER_TEAM) return null
  for (const zone of STRATEGIC_WARD_ZONES) {
    if (zone !== bot.zone && !areAdjacent(bot.zone, zone)) continue
    if (teamHasWardInZone(state, zone, bot.team)) continue
    return { type: 'ward', zone }
  }
  return null
}

/** Support bots also buy Sentry Wards for true-sight (reveals invisible enemies
 *  in a zone). Only bought when the enemy team has invisibility heroes. */
function tryBuySentryWard(bot: PlayerState, state: GameState): Command | null {
  if (getItemCount(bot) >= 6) return null
  const role = bot.heroId ? HEROES[bot.heroId]?.role : undefined
  if (role !== 'support') return null
  if (bot.items.includes('sentry_ward')) return null
  if (bot.gold < itemCost('sentry_ward')) return null
  // Only buy sentries when the enemy has invisibility-capable heroes
  const hasInvisEnemy = Object.values(state.players).some(
    (p) => p.team !== bot.team && p.alive && p.heroId && INVIS_HEROES.has(p.heroId),
  )
  if (!hasInvisEnemy) return null
  return { type: 'buy', item: 'sentry_ward' }
}

/** Place a sentry ward for true-sight in the current/adjacent zone when
 *  invisible enemies are likely nearby (enemy invis hero on the map). */
function tryPlaceSentryWard(state: GameState, bot: PlayerState): Command | null {
  if (!bot.items.includes('sentry_ward')) return null
  if (teamWardCount(state, bot.team) >= WARD_LIMIT_PER_TEAM) return null
  const hasInvisEnemy = Object.values(state.players).some(
    (p) => p.team !== bot.team && p.alive && p.heroId && INVIS_HEROES.has(p.heroId),
  )
  if (!hasInvisEnemy) return null
  // Place on the current zone or an adjacent river/jungle zone
  const candidates = [
    bot.zone,
    ...Object.values(state.zones)
      .map((z) => z.id)
      .filter((id) => areAdjacent(bot.zone, id)),
  ]
  for (const zone of candidates) {
    const hasSentry = (state.zones[zone]?.wards ?? []).some(
      (w) => w.team === bot.team && w.type === 'sentry',
    )
    if (!hasSentry) return { type: 'ward', zone }
  }
  return null
}

/** Roshan awareness — when Roshan is alive and low HP, contest it.
 *  Only for carry/initiator roles at high HP with allies nearby. */
function tryRoshan(
  state: GameState,
  bot: PlayerState,
  config: BotDifficultyConfig,
  hasZone?: (id: string) => boolean,
): Command | null {
  if (!config.threatAssessment) return null
  const roshan = state.roshan
  if (!roshan.alive) return null
  // Only contest when Roshan is below 40% HP (last-hit window)
  if (roshan.hp / roshan.maxHp > 0.4) return null
  // Need to be healthy and level 6+
  if (getHpPercent(bot) < 70 || bot.level < 6) return null
  // Only carries and initiators contest Roshan
  const role = bot.heroId ? HEROES[bot.heroId]?.role : undefined
  if (role !== 'carry' && role !== 'tank' && role !== 'assassin' && role !== 'mage') return null
  // Need at least one ally nearby for a safe contest
  const alliesNear = Object.values(state.players).filter(
    (p) =>
      p.team === bot.team &&
      p.alive &&
      p.id !== bot.id &&
      getDistance(p.zone, 'roshan-pit', hasZone) <= 2,
  )
  if (alliesNear.length === 0) return null
  // If already in Roshan's pit, attack Roshan
  if (bot.zone === 'roshan-pit') {
    return { type: 'attack', target: { kind: 'roshan' } }
  }
  // Move toward Roshan
  if (!hasZone || hasZone('roshan-pit')) {
    const path = findPath(bot.zone, 'roshan-pit', hasZone)
    if (path.length > 1) return { type: 'move', zone: path[1]! }
  }
  return null
}

/** Grab the Aegis when it has dropped in the Roshan pit and is still unclaimed.
 *  The aegis only ever lands in roshan-pit, so a bot already there (e.g. the one
 *  that just contested Roshan) picks it up; otherwise it only diverts when the
 *  pit is adjacent — it never abandons its lane to trek across the map for it. */
function tryAegis(
  state: GameState,
  bot: PlayerState,
  config: BotDifficultyConfig,
  hasZone?: (id: string) => boolean,
): Command | null {
  if (!config.threatAssessment) return null
  const aegis = state.aegis
  if (!aegis || aegis.holderId) return null // none on the ground / already held
  if (bot.zone === 'roshan-pit') return { type: 'aegis' }
  // Only divert when the pit is right next to us (don't cross the map for it).
  if ((!hasZone || hasZone('roshan-pit')) && getDistance(bot.zone, 'roshan-pit', hasZone) <= 1) {
    const path = findPath(bot.zone, 'roshan-pit', hasZone)
    if (path.length > 1) return { type: 'move', zone: path[1]! }
  }
  return null
}

/** Buyback — when dead and the game is still winnable, buy back if the bot
 *  has enough gold and the cooldown is clear. Only when there's a fight to
 *  join (enemies near our structures) or the Ancient is threatened. */
function tryBuyback(
  state: GameState,
  bot: PlayerState,
  hasZone?: (id: string) => boolean,
): Command | null {
  if (bot.alive) return null
  if (bot.respawnTick === null) return null
  // Can't buyback if on cooldown
  if (bot.buybackCooldown !== undefined && state.tick < bot.buybackCooldown) return null
  if (bot.gold < bot.buybackCost) return null
  // Don't buyback if respawn is imminent (within 2 ticks)
  if (bot.respawnTick - state.tick <= 2) return null
  // Buyback when the Ancient is under threat or allies are fighting near our base
  const enemyTeam: TeamId = bot.team === 'radiant' ? 'dire' : 'radiant'
  const ourBaseZone = bot.team === 'radiant' ? 'radiant-base' : 'dire-base'
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

/** Glyph/fortification — pop team-wide tower invulnerability when the enemy
 *  team is diving a tower and it's about to fall. Only one glyph per team
 *  per cooldown, so this is reserved for desperate saves. */
function tryGlyph(state: GameState, bot: PlayerState): Command | null {
  // Glyph is a team command — any teammate can issue it. Check cooldown.
  const teamState = state.teams[bot.team]
  if (teamState.glyphUsedTick !== null) {
    if (state.tick - teamState.glyphUsedTick < GLYPH_COOLDOWN_TICKS) return null
  }
  // Only glyph when an enemy hero is attacking one of our towers that's low
  const ourTowers = state.towers.filter((t) => t.team === bot.team && t.alive)
  const enemyHeroes = Object.values(state.players).filter((p) => p.team !== bot.team && p.alive)
  for (const tower of ourTowers) {
    if (tower.hp / tower.maxHp > 0.25) continue // only glyph a critically low tower
    const enemyOnTower = enemyHeroes.some((e) => e.zone === tower.zone)
    if (enemyOnTower) {
      // Bot must be on the same team and able to issue the command
      // (glyph is team-wide, not zone-restricted)
      return { type: 'glyph' }
    }
  }
  return null
}

/** Defensive tower rotation — when an enemy hero is pushing a tower and no
 *  ally is there to defend, move to that tower. Prioritizes the nearest
 *  undefended tower under attack. */
function tryDefendTower(
  state: GameState,
  bot: PlayerState,
  hasZone?: (id: string) => boolean,
): Command | null {
  const ourTowers = state.towers.filter((t) => t.team === bot.team && t.alive)
  const enemyHeroes = Object.values(state.players).filter((p) => p.team !== bot.team && p.alive)
  const allies = Object.values(state.players).filter(
    (p) => p.team === bot.team && p.alive && p.id !== bot.id,
  )
  // Find undefended towers under enemy hero pressure
  const threatened = ourTowers.filter((tower) => {
    const enemyOnTower = enemyHeroes.some((e) => e.zone === tower.zone)
    if (!enemyOnTower) return false
    // Is any ally already defending?
    const allyDefending = allies.some((a) => a.zone === tower.zone)
    return !allyDefending
  })
  if (threatened.length === 0) return null
  // Move to the nearest threatened tower
  let closest: TowerState | null = null
  let minDist = Infinity
  for (const tower of threatened) {
    const dist = getDistance(bot.zone, tower.zone, hasZone)
    if (dist < minDist) {
      minDist = dist
      closest = tower
    }
  }
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
  if (!config.runeAwareness) return null
  const runesInZone = getRunesInZone(state, bot.zone)
  if (runesInZone.length > 0) {
    return { type: 'rune' }
  }
  const closestRuneZone = getClosestRuneZone(bot, state, hasZone)
  if (closestRuneZone && getDistance(bot.zone, closestRuneZone, hasZone) <= 2) {
    const path = findPath(bot.zone, closestRuneZone, hasZone)
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
  hasZone?: (id: string) => boolean,
): Command | null {
  if (!config.jungleFarming) return null
  const neutralsHere = getNeutralsInZone(state, bot.zone)
  if (neutralsHere.length > 0) {
    const target = neutralsHere.reduce((a, b) => (a.hp < b.hp ? a : b))
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

/** Attack the enemy Ancient when in the enemy base and it is vulnerable. */
function tryAttackAncient(state: GameState, bot: PlayerState): Command | null {
  const enemyTeam: TeamId = bot.team === 'radiant' ? 'dire' : 'radiant'
  if (bot.zone !== ANCIENT_ZONES[enemyTeam]) return null
  // Optional chaining guards old snapshots/fixtures created before Ancients existed
  const ancient = state.ancients?.[enemyTeam]
  if (!ancient || !ancient.alive || !ancient.vulnerable) return null
  return { type: 'attack', target: { kind: 'ancient' } }
}

/**
 * Pick a talent when the bot has reached a tier but not chosen yet. Deterministic
 * (no RNG, for replayable sims): prefer a concrete power talent (stat / damage
 * boost) over a situational one, else take the first option. select_talent is an
 * out-of-band special action, but decideBotAction returns one command per tick,
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
 * a fight. One use per tick, naturally rate-limited by each item's cooldown.
 *
 * Gated on `threatAssessment` so naive (easy) bots stay naive while medium+ bots
 * stop sitting on their items — the most visible "bots ignore their inventory"
 * gap. Every `use` returned here resolves: self-cast actives have no target, and
 * the targeted ones aim at an enemy already confirmed alive + in-zone.
 *
 *  - Defensive (BKB magic-immunity, Blade Mail reflect) only when actually under
 *    pressure — hurt or outnumbered — not burned on a trivial skirmish.
 *  - Setup/control/burst on the kill target (lowest-HP enemy): Veil (zone magic-
 *    vuln) → Ethereal (physical-immune + 40% magic-vuln) → Hex (hard disable,
 *    still killable) → Dagon (300 magic nuke). Ethereal/Dagon are held if that
 *    target is magic-immune (they'd fizzle).
 *  - Cyclone (Eul's) is aimed at a SECONDARY enemy, never the kill target: it
 *    makes its victim invulnerable, so it removes a second threat rather than
 *    shielding the one we're trying to kill. Skipped in a 1v1.
 *  - Stack Overflow (double next ability) only when an ability is ready to spend
 *    the charge next tick, so it's never wasted on a pure right-click.
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

  // Offensive setup → control → burst, aimed at the kill target (lowest HP).
  const killTarget = enemiesInZone.reduce((a, b) => (a.hp < b.hp ? a : b))
  const killRef: TargetRef = { kind: 'hero', name: killTarget.id }
  const killImmune = isMagicImmuneTarget(killTarget)

  if (itemOffCooldown(bot, 'veil_of_discord')) {
    return { type: 'use', item: 'veil_of_discord' }
  }
  if (!killImmune && itemOffCooldown(bot, 'ethereal_blade')) {
    return { type: 'use', item: 'ethereal_blade', target: killRef }
  }
  if (itemOffCooldown(bot, 'scythe_of_vyse')) {
    return { type: 'use', item: 'scythe_of_vyse', target: killRef }
  }
  // Cyclone a SECONDARY enemy (healthiest other threat) — never the kill target.
  if (enemiesInZone.length >= 2 && itemOffCooldown(bot, 'euls_scepter')) {
    const secondary = enemiesInZone
      .filter((e) => e.id !== killTarget.id)
      .reduce((a, b) => (a.hp > b.hp ? a : b))
    return { type: 'use', item: 'euls_scepter', target: { kind: 'hero', name: secondary.id } }
  }
  if (!killImmune && itemOffCooldown(bot, 'dagon')) {
    return { type: 'use', item: 'dagon', target: killRef }
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
 * A defensive panic item (BKB / Blade Mail) for a chased, RETREATING bot. The
 * retreat branch returns before the combat block, so without this a low-HP bot
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
    // Buyback when the game needs us (Ancient threatened or allies teamfighting)
    const buybackCmd = tryBuyback(state, bot, hasZone)
    if (buybackCmd) return buybackCmd
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
        bot.gold + Math.floor(itemCost(sellItem) * SELL_REFUND_RATIO) >= itemCost(nextCore)
      ) {
        return { type: 'sell', item: sellItem }
      }
    }
    if (getHpPercent(bot) >= 95 && getMpPercent(bot) >= 95) {
      const nextZone = getNextLaneZone(bot, assignedLane, hasZone)
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
      getDistance(bot.zone, fountain, hasZone) > TP_RETREAT_MIN_DISTANCE
    ) {
      return { type: 'use', item: 'town_portal_scroll' }
    }
    // Being chased (can't TP through combat): pop a survival item so the bot
    // doesn't flee to its death with BKB/Blade Mail unused.
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
      // Force Staff, which auto-shoves toward our own fountain (same direction).
      // Unimpaired, a normal move is free — don't waste an item cooldown.
      const movementImpaired = bot.buffs.some((b) => b.id.includes('root') || b.id.includes('slow'))
      if (
        movementImpaired &&
        itemOffCooldown(bot, 'blink_module') &&
        areAdjacent(bot.zone, path[1]!)
      ) {
        return { type: 'use', item: 'blink_module', target: path[1]! }
      }
      if (movementImpaired && itemOffCooldown(bot, 'force_staff')) {
        return { type: 'use', item: 'force_staff' }
      }
      return { type: 'move', zone: path[1]! }
    }
    return null
  }
  // Spend a calm tick (no enemy hero in zone) banking an unlocked talent so bots
  // aren't permanently down 1–4 talents on human players, then dropping a ward
  // on a strategic spot for team vision.
  if (enemyHeroes.length === 0) {
    // Glyph to save a critically low tower from an enemy push (team-wide, any zone)
    const glyphCmd = tryGlyph(state, bot)
    if (glyphCmd) return glyphCmd
    const talentCmd = tryPickTalent(bot)
    if (talentCmd) return talentCmd
    const wardCmd = tryPlaceWard(state, bot)
    if (wardCmd) return wardCmd
    // Place sentry wards for true-sight against invisible enemies
    const sentryWardCmd = tryPlaceSentryWard(state, bot)
    if (sentryWardCmd) return sentryWardCmd
    // Defend an undefended tower under enemy pressure
    const defendCmd = tryDefendTower(state, bot, hasZone)
    if (defendCmd) return defendCmd
    // Contest Roshan when alive and low HP (carry/initiator only, with allies)
    const roshanCmd = tryRoshan(state, bot, config, hasZone)
    if (roshanCmd) return roshanCmd
    // Once Roshan is dead, grab the Aegis drop from the pit
    const aegisCmd = tryAegis(state, bot, config, hasZone)
    if (aegisCmd) return aegisCmd
  }
  const enemyCreeps = getEnemyCreepsInZone(state, bot)
  if (enemyHeroes.length > 0) {
    // Pop a combat item (BKB/Blade Mail to survive, Stack Overflow/Veil to amp)
    // before committing to a combo or right-click. One use per tick, naturally
    // rate-limited by each item's cooldown, so this can't starve the bot's
    // damage — it falls through to the combo/ability/attack below once items
    // are spent or on cooldown.
    const itemCmd = tryUseCombatItem(bot, enemyHeroes, getAlliedHeroesInZone(state, bot), config)
    if (itemCmd) return itemCmd
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
      const path = findPath(bot.zone, baseZone, hasZone)
      if (path.length > 1) return { type: 'move', zone: path[1]! }
    }
  }

  // Aggressive siege (test mode only): topple the enemy tower in this zone, else
  // march toward the enemy base. Sits ABOVE creep farming so test games converge
  // quickly; production bots fall through to the game-state-driven push below.
  if (aggressivePush) {
    const towerHere = getEnemyTowerInZone(state, bot)
    if (towerHere) return { type: 'attack', target: { kind: 'tower', zone: towerHere.zone } }
    const advanceZone = getNextLaneZone(bot, assignedLane, hasZone)
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
  const runeCmd = tryPickupRune(state, bot, config, hasZone)
  if (runeCmd) return runeCmd
  if (assignedLane === 'jungle' || (config.jungleFarming && getHpPercent(bot) > 60)) {
    const jungleCmd = tryFarmJungle(state, bot, config, hasZone)
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
  const nextZone = getNextLaneZone(bot, assignedLane, hasZone)
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
