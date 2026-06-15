/**
 * Unified effective combat stats — the single authority for what a player's
 * attack / defense / magic resist are worth once hero growth, items, talents,
 * and engine-consumed buffs are accounted for.
 *
 * IMPORTANT: this module must NOT import hero modules or './_base' — _base
 * imports this file, so adding either would create an import cycle
 * (_base -> EffectiveStats -> hero -> _base).
 *
 * The per-stack constants mirror the helpers exported by the hero files
 * (mutex getDeadlock*, traceroute getHopCountMultiplier,
 * echo getResonanceMultiplier) which remain exported for tests but are not
 * consumed by the engine.
 */
import type { PlayerState } from '~~/shared/types/game'
import type { ItemStats } from '~~/shared/types/items'
import { HEROES } from '~~/shared/constants/heroes'
import { ITEMS } from '~~/shared/constants/items'
import { TALENT_TREES, type Talent } from '~~/shared/constants/talents'

// Mirrors mutex.ts DEADLOCK_* constants
const DEADLOCK_ATTACK_PER_STACK = 3
const DEADLOCK_DEFENSE_PER_STACK = 1
// Mirrors traceroute.ts HOP_COUNT_DAMAGE_PER_STACK
const HOP_COUNT_DAMAGE_PER_STACK = 0.2
// Mirrors echo.ts RESONANCE_BONUS_PER_STACK
const RESONANCE_BONUS_PER_STACK = 0.08

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

/** The talents a player has actually selected, resolved against their tree. */
function getSelectedTalents(player: PlayerState): Talent[] {
  if (!player.heroId) return []
  const tree = TALENT_TREES[player.heroId]
  if (!tree) return []
  const chosen = [
    player.talents?.tier10,
    player.talents?.tier15,
    player.talents?.tier20,
    player.talents?.tier25,
  ].filter((id): id is string => id !== null && id !== undefined)
  if (chosen.length === 0) return []
  const all = Object.values(tree.tiers).flat()
  return all.filter((t) => chosen.includes(t.id))
}

/** Sum the statBonus values of the player's selected talents for one stat. */
export function getTalentStatBonus(
  player: PlayerState,
  stat: 'hp' | 'mp' | 'attack' | 'defense' | 'magicResist' | 'moveSpeed' | 'attackSpeed',
): number {
  let total = 0
  for (const talent of getSelectedTalents(player)) {
    if (talent.statBonus?.stat === stat) total += talent.statBonus.value
  }
  return total
}

function getBuffStacks(player: PlayerState, buffId: string): number {
  return player.buffs.find((b) => b.id === buffId)?.stacks ?? 0
}

/**
 * Effective attack: hero base + growth, plus item attack, plus talent attack,
 * plus additive attack buffs (mutex Deadlock, thread Fork, cron Uptime, malloc
 * Heap Growth + Allocate — both malloc attack buffs were created but never read
 * here, so Malloc's gold-scaling passive and Q were each giving +0 attack).
 */
export function getEffectiveAttack(player: PlayerState, itemStats?: ItemStats): number {
  const hero = player.heroId ? HEROES[player.heroId] : null
  const baseAttack = hero
    ? hero.baseStats.attack + (hero.growthPerLevel.attack ?? 0) * (player.level - 1)
    : 50
  const itemBonus = itemStats?.attack ?? getItemStatBonuses(player.items).attack ?? 0
  const talentBonus = getTalentStatBonus(player, 'attack')
  const buffBonus =
    getBuffStacks(player, 'deadlock') * DEADLOCK_ATTACK_PER_STACK +
    getBuffStacks(player, 'forkAtk') +
    getBuffStacks(player, 'uptimeAtk') +
    getBuffStacks(player, 'heapGrowth') +
    getBuffStacks(player, 'allocate')
  return baseAttack + itemBonus + talentBonus + buffBonus
}

/**
 * Multiplicative basic-attack damage bonus from stacking passives/buffs:
 * traceroute Full Trace (% per stack) and Hop Count, echo Resonance.
 * Applied to basic attacks only — never to ability damage.
 */
export function getAttackMultiplier(player: PlayerState): number {
  const fullTrace = 1 + getBuffStacks(player, 'fullTraceDmg') / 100
  const hopCount = 1 + getBuffStacks(player, 'hopCount') * HOP_COUNT_DAMAGE_PER_STACK
  const resonance = 1 + getBuffStacks(player, 'resonance') * RESONANCE_BONUS_PER_STACK
  return fullTrace * hopCount * resonance
}

/**
 * Effective defense: hero base + growth, plus item defense, plus talent
 * defense, plus defensive buffs (sentry Fortify, mutex Critical Section /
 * Deadlock, cron Uptime).
 */
export function getEffectiveDefense(player: PlayerState, itemStats?: ItemStats): number {
  const hero = player.heroId ? HEROES[player.heroId] : null
  const base = hero
    ? hero.baseStats.defense + (hero.growthPerLevel.defense ?? 0) * (player.level - 1)
    : player.defense
  const itemBonus = itemStats?.defense ?? getItemStatBonuses(player.items).defense ?? 0
  const talentBonus = getTalentStatBonus(player, 'defense')
  const buffBonus =
    getBuffStacks(player, 'defenseBuff') +
    getBuffStacks(player, 'criticalSectionDefense') +
    getBuffStacks(player, 'deadlock') * DEADLOCK_DEFENSE_PER_STACK +
    getBuffStacks(player, 'uptimeDef')
  return base + itemBonus + talentBonus + buffBonus
}

/**
 * Effective magic resist: hero base + growth, plus item MR, plus talent MR,
 * minus null_ref's MR shred (floored at 0).
 */
export function getEffectiveMagicResist(player: PlayerState, itemStats?: ItemStats): number {
  const hero = player.heroId ? HEROES[player.heroId] : null
  const base = hero
    ? hero.baseStats.magicResist + (hero.growthPerLevel.magicResist ?? 0) * (player.level - 1)
    : player.magicResist
  const itemBonus = itemStats?.magicResist ?? getItemStatBonuses(player.items).magicResist ?? 0
  const talentBonus = getTalentStatBonus(player, 'magicResist')
  const shred = getBuffStacks(player, 'mrShred')
  return Math.max(0, base + itemBonus + talentBonus - shred)
}
