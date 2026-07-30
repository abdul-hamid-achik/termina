import type { PlayerState } from '~~/shared/types/game'
import type { DamageType } from '~~/shared/types/hero'

/**
 * Kinetic damage formula: attack * (100 / (100 + plate))
 * Plate reduces kinetic damage logarithmically.
 */
export function calculateKineticDamage(attack: number, plate: number): number {
  if (plate < 0) plate = 0
  return Math.round(attack * (100 / (100 + plate)))
}

/**
 * Code damage formula: damage * (100 / (100 + ice))
 * Same formula with ice.
 */
export function calculateCodeDamage(damage: number, ice: number): number {
  if (ice < 0) ice = 0
  return Math.round(damage * (100 / (100 + ice)))
}

/**
 * Black damage: no reduction at all.
 */
export function calculateBlackDamage(damage: number): number {
  return Math.round(damage)
}

/**
 * Calculate effective damage after reductions based on damage type.
 */
export function calculateEffectiveDamage(
  rawDamage: number,
  damageType: DamageType,
  target: { plate: number; ice: number },
): number {
  switch (damageType) {
    case 'kinetic':
      return calculateKineticDamage(rawDamage, target.plate)
    case 'code':
      return calculateCodeDamage(rawDamage, target.ice)
    case 'black':
      return calculateBlackDamage(rawDamage)
  }
}

// Target-side damage amplifiers. Each stores its percent in `stacks` and they
// stack ADDITIVELY (the MOBA amplification convention). magic-vuln debuffs only
// amplify CODE damage (regex Q +15%, Veil of Discord +25%, Ethereal Blade
// +40%); thread Yield amplifies ALL damage types (+25%). Shared so every hero
// damage path (dealDamage, DoTs, basic attacks) honors them consistently.
const MAGIC_VULN_BUFF_IDS = ['magicVulnerability', 'veil_discord', 'magic_vuln_40']
const ALL_DAMAGE_VULN_BUFF_IDS = ['yield']

/** Multiplier (>= 1) for incoming damage of `damageType` from the target's vuln debuffs. */
export function getIncomingDamageMultiplier(target: PlayerState, damageType: DamageType): number {
  let pct = 0
  for (const b of target.buffs) {
    if (ALL_DAMAGE_VULN_BUFF_IDS.includes(b.id)) pct += b.stacks
    else if (damageType === 'code' && MAGIC_VULN_BUFF_IDS.includes(b.id)) pct += b.stacks
  }
  return 1 + pct / 100
}

/**
 * True when `target` ignores an incoming hit of `damageType` outright — used as
 * an early-skip so no HP is lost. invulnerable (Proxy R / Eul's Cyclone) blocks
 * everything; Hardshell's airgap blocks code; ethereal (Ethereal
 * Blade) and ghost_form (Ghost Scepter) block kinetic.
 */
export function isDamageImmune(target: PlayerState, damageType: DamageType): boolean {
  const buffs = target.buffs
  if (buffs.some((b) => b.id === 'invulnerable')) return true
  if (damageType === 'code' && buffs.some((b) => b.id === 'airgap')) return true
  if (damageType === 'kinetic' && buffs.some((b) => b.id === 'ethereal' || b.id === 'ghost_form'))
    return true
  return false
}

/**
 * Apply pre-calculated damage directly to a player.
 * Pure function, no Effect wrapper.
 */
export function applyRawDamage(target: PlayerState, damage: number): PlayerState {
  const newInteg = Math.max(0, target.integ - damage)
  const alive = newInteg > 0
  return {
    ...target,
    integ: newInteg,
    alive,
  }
}

/**
 * Heal a player. HP cannot exceed maxInteg.
 */
export function applyHeal(target: PlayerState, amount: number): PlayerState {
  return {
    ...target,
    integ: Math.min(target.maxInteg, target.integ + amount),
  }
}

/**
 * Calculate hero stats at a given level using base stats + growth.
 */
export function getHeroStatsAtLevel(
  base: { hp: number; mp: number; attack: number; plate: number; ice: number },
  growth: Partial<{ hp: number; mp: number; attack: number; plate: number; ice: number }>,
  level: number,
): { hp: number; mp: number; attack: number; plate: number; ice: number } {
  // Keys stay hp/mp until R4-06 renames HeroBaseStats/ItemStats bonuses to integ/bw.
  const levelsGained = level - 1
  return {
    hp: base.hp + (growth.hp ?? 0) * levelsGained,
    mp: base.mp + (growth.mp ?? 0) * levelsGained,
    attack: base.attack + (growth.attack ?? 0) * levelsGained,
    plate: base.plate + (growth.plate ?? 0) * levelsGained,
    ice: base.ice + (growth.ice ?? 0) * levelsGained,
  }
}
