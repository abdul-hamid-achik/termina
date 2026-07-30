/**
 * Unified effective combat stats — the single authority for what a player's
 * attack / plate / ice are worth once hero growth, items, talents,
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
import { getTalentTree, type Talent, type CastEffect } from '~~/shared/constants/talents'

// Mirrors mutex.ts DEADLOCK_* constants
const DEADLOCK_ATTACK_PER_STACK = 3
const DEADLOCK_PLATE_PER_STACK = 1
// Mirrors cipher.ts ENCRYPTION_KEY_PLATE_REDUCTION (plate shred per stack)
const ENCRYPTION_KEY_PLATE_REDUCTION = 2
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
    plate: 0,
    ice: 0,
  }
  for (const itemId of items) {
    if (!itemId) continue
    const item = ITEMS[itemId]
    if (!item) continue
    totals.hp += item.stats.hp ?? 0
    totals.mp += item.stats.mp ?? 0
    totals.attack += item.stats.attack ?? 0
    totals.plate += item.stats.plate ?? 0
    totals.ice += item.stats.ice ?? 0
  }
  return totals
}

/** The talents a player has actually selected, resolved against their tree. */
function getSelectedTalents(player: PlayerState): Talent[] {
  if (!player.heroId) return []
  const tree = getTalentTree(player.heroId)
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
  stat: 'hp' | 'mp' | 'attack' | 'plate' | 'ice' | 'attackSpeed',
): number {
  let total = 0
  for (const talent of getSelectedTalents(player)) {
    if (talent.statBonus?.stat === stat) total += talent.statBonus.value
  }
  return total
}

/**
 * Whether the player has selected a talent granting a mechanical cast effect
 * (a tier-25 "exotic" upgrade). If `abilityId` is given, only talents bound to
 * that ability slot match — so a double-cast talent on Q only double-casts Q.
 */
export function hasTalentCastEffect(
  player: PlayerState,
  effect: CastEffect,
  abilityId?: 'q' | 'w' | 'e' | 'r',
): boolean {
  return getSelectedTalents(player).some(
    (t) => t.castEffect === effect && (abilityId === undefined || t.abilityId === abilityId),
  )
}

function getBuffStacks(player: PlayerState, buffId: string): number {
  return player.buffs.find((b) => b.id === buffId)?.stacks ?? 0
}

/**
 * Effective attack: hero base + growth, plus item attack, plus talent attack,
 * plus additive attack buffs (mutex Deadlock, thread Fork, cron Uptime, malloc
 * Heap Growth + Allocate — both malloc attack buffs were created but never read
 * here, so Malloc's gold-scaling passive and Q were each giving +0 attack — Power
 * Treads attack mode, and Hurricane Pike's post-thrust attack steroid).
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
    getBuffStacks(player, 'allocate') +
    getBuffStacks(player, 'gait_rig_attack') +
    getBuffStacks(player, 'kickback_splice_attacks')
  const attack = baseAttack + itemBonus + talentBonus + buffBonus
  // ping Timeout (attackReduction) is a % reduction stored in the buff stacks.
  const reductionPct = Math.min(100, getBuffStacks(player, 'attackReduction'))
  return Math.round(attack * (1 - reductionPct / 100))
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
  // Double Damage cache: 2x basic-attack damage (the 'dd' buff was applied but
  // consumed nowhere).
  const doubleDamage = player.buffs.some((b) => b.id === 'dd') ? 2 : 1
  return fullTrace * hopCount * resonance * doubleDamage
}

/**
 * Effective plate: hero base + growth, plus item plate, plus talent
 * plate, plus defensive buffs (sentry Fortify + Overwatch aura, mutex Critical
 * Section / Deadlock, cron Uptime), minus cipher Encryption Key plate shred
 * (floored at 0).
 */
export function getEffectivePlate(player: PlayerState, itemStats?: ItemStats): number {
  const hero = player.heroId ? HEROES[player.heroId] : null
  const base = hero
    ? hero.baseStats.plate + (hero.growthPerLevel.plate ?? 0) * (player.level - 1)
    : player.plate
  const itemBonus = itemStats?.plate ?? getItemStatBonuses(player.items).plate ?? 0
  const talentBonus = getTalentStatBonus(player, 'plate')
  const buffBonus =
    getBuffStacks(player, 'defenseBuff') +
    getBuffStacks(player, 'criticalSectionDefense') +
    getBuffStacks(player, 'deadlock') * DEADLOCK_PLATE_PER_STACK +
    getBuffStacks(player, 'uptimeDef') +
    getBuffStacks(player, 'overwatch') // sentry Overwatch ally-plate aura
  // cipher Encryption Key shreds armor (per-stack), floored at 0.
  const shred = getBuffStacks(player, 'encryptionKey') * ENCRYPTION_KEY_PLATE_REDUCTION
  return Math.max(0, base + itemBonus + talentBonus + buffBonus - shred)
}

/**
 * Effective ice: hero base + growth, plus item MR, plus talent MR,
 * minus null_ref's MR shred (floored at 0).
 */
export function getEffectiveIce(player: PlayerState, itemStats?: ItemStats): number {
  const hero = player.heroId ? HEROES[player.heroId] : null
  const base = hero
    ? hero.baseStats.ice + (hero.growthPerLevel.ice ?? 0) * (player.level - 1)
    : player.ice
  const itemBonus = itemStats?.ice ?? getItemStatBonuses(player.items).ice ?? 0
  const talentBonus = getTalentStatBonus(player, 'ice')
  const shred = getBuffStacks(player, 'mrShred')
  return Math.max(0, base + itemBonus + talentBonus - shred)
}
