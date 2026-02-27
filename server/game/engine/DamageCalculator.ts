import { Effect } from 'effect'
import type { PlayerState } from '~~/shared/types/game'
import type { DamageType } from '~~/shared/types/hero'

/**
 * Physical damage formula: attack * (100 / (100 + defense))
 * Defense reduces physical damage logarithmically.
 */
export function calculatePhysicalDamage(attack: number, defense: number): number {
  if (defense < 0) defense = 0
  return Math.round(attack * (100 / (100 + defense)))
}

/**
 * Magical damage formula: damage * (100 / (100 + magicResist))
 * Same formula with magic resist.
 */
export function calculateMagicalDamage(damage: number, magicResist: number): number {
  if (magicResist < 0) magicResist = 0
  return Math.round(damage * (100 / (100 + magicResist)))
}

/**
 * Pure damage: no reduction at all.
 */
export function calculatePureDamage(damage: number): number {
  return Math.round(damage)
}

/**
 * Calculate effective damage after reductions based on damage type.
 */
export function calculateEffectiveDamage(
  rawDamage: number,
  damageType: DamageType,
  target: { defense: number; magicResist: number },
): number {
  switch (damageType) {
    case 'physical':
      return calculatePhysicalDamage(rawDamage, target.defense)
    case 'magical':
      return calculateMagicalDamage(rawDamage, target.magicResist)
    case 'pure':
      return calculatePureDamage(rawDamage)
  }
}

/**
 * Apply damage to a player state. HP cannot go below 0.
 * If HP reaches 0, the player is marked as dead.
 * Returns the updated PlayerState as an Effect.
 */
export function applyDamage(
  target: PlayerState,
  damage: number,
  damageType: DamageType,
): Effect.Effect<PlayerState> {
  return Effect.sync(() => {
    const effectiveDamage = calculateEffectiveDamage(
      damage,
      damageType,
      { defense: target.defense ?? 0, magicResist: target.magicResist ?? 0 },
    )
    return applyRawDamage(target, effectiveDamage)
  })
}

/**
 * Apply pre-calculated damage directly to a player.
 * Pure function, no Effect wrapper.
 */
export function applyRawDamage(target: PlayerState, damage: number): PlayerState {
  const newHp = Math.max(0, target.hp - damage)
  const alive = newHp > 0
  return {
    ...target,
    hp: newHp,
    alive,
  }
}

/**
 * Heal a player. HP cannot exceed maxHp.
 */
export function applyHeal(target: PlayerState, amount: number): PlayerState {
  return {
    ...target,
    hp: Math.min(target.maxHp, target.hp + amount),
  }
}

/**
 * Calculate hero stats at a given level using base stats + growth.
 */
export function getHeroStatsAtLevel(
  base: { hp: number; mp: number; attack: number; defense: number; magicResist: number },
  growth: Partial<{ hp: number; mp: number; attack: number; defense: number; magicResist: number }>,
  level: number,
): { hp: number; mp: number; attack: number; defense: number; magicResist: number } {
  const levelsGained = level - 1
  return {
    hp: base.hp + (growth.hp ?? 0) * levelsGained,
    mp: base.mp + (growth.mp ?? 0) * levelsGained,
    attack: base.attack + (growth.attack ?? 0) * levelsGained,
    defense: base.defense + (growth.defense ?? 0) * levelsGained,
    magicResist: base.magicResist + (growth.magicResist ?? 0) * levelsGained,
  }
}
