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

// Target-side damage amplifiers. Each stores its percent in `stacks` and they
// stack ADDITIVELY (the MOBA amplification convention). magic-vuln debuffs only
// amplify MAGICAL damage (regex Q +15%, Veil of Discord +25%, Ethereal Blade
// +40%); thread Yield amplifies ALL damage types (+25%). Shared so every hero
// damage path (dealDamage, DoTs, basic attacks) honors them consistently.
const MAGIC_VULN_BUFF_IDS = ['magicVulnerability', 'veil_discord', 'magic_vuln_40']
const ALL_DAMAGE_VULN_BUFF_IDS = ['yield']

/** Multiplier (>= 1) for incoming damage of `damageType` from the target's vuln debuffs. */
export function getIncomingDamageMultiplier(target: PlayerState, damageType: DamageType): number {
  let pct = 0
  for (const b of target.buffs) {
    if (ALL_DAMAGE_VULN_BUFF_IDS.includes(b.id)) pct += b.stacks
    else if (damageType === 'magical' && MAGIC_VULN_BUFF_IDS.includes(b.id)) pct += b.stacks
  }
  return 1 + pct / 100
}

/**
 * True when `target` ignores an incoming hit of `damageType` outright — used as
 * an early-skip so no HP is lost. invulnerable (Proxy R / Eul's Cyclone) blocks
 * everything; Black King Bar's magic_immune blocks magical; ethereal (Ethereal
 * Blade) and ghost_form (Ghost Scepter) block physical.
 */
export function isDamageImmune(target: PlayerState, damageType: DamageType): boolean {
  const buffs = target.buffs
  if (buffs.some((b) => b.id === 'invulnerable')) return true
  if (damageType === 'magical' && buffs.some((b) => b.id === 'magic_immune')) return true
  if (damageType === 'physical' && buffs.some((b) => b.id === 'ethereal' || b.id === 'ghost_form'))
    return true
  return false
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
