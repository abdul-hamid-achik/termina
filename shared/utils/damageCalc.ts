import type { BuffState, PlayerState } from '~~/shared/types/game'
import type { DamageType } from '~~/shared/types/hero'
import { getEffectiveIce, getEffectivePlate } from './effectiveStats'

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
 * an early-skip so no INTEG is lost. invulnerable (Proxy R / Eul's Cyclone) blocks
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
 * Heal a player. INTEG cannot exceed maxInteg.
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
  base: { integ: number; bw: number; attack: number; plate: number; ice: number },
  growth: Partial<{ integ: number; bw: number; attack: number; plate: number; ice: number }>,
  level: number,
): { integ: number; bw: number; attack: number; plate: number; ice: number } {
  const levelsGained = level - 1
  return {
    integ: base.integ + (growth.integ ?? 0) * levelsGained,
    bw: base.bw + (growth.bw ?? 0) * levelsGained,
    attack: base.attack + (growth.attack ?? 0) * levelsGained,
    plate: base.plate + (growth.plate ?? 0) * levelsGained,
    ice: base.ice + (growth.ice ?? 0) * levelsGained,
  }
}

/**
 * True when the hero is open to code damage / hard control. Friendly fire does
 * not exist — only the breaching crew can damage a breached hero, so this needs
 * no attacker-team parameter (invariant guarded by tests).
 */
export function isBreached(player: PlayerState): boolean {
  return player.buffs.some((b) => b.id === 'breached' && b.cyclesRemaining > 0)
}

/**
 * Run damage through a buff list's 'shield' buff (if any).
 * Returns the post-absorption buff list and the damage remaining.
 * Shared by ability damage (dealDamage) and the basic-attack path.
 */
export function absorbShield(
  buffs: BuffState[],
  damage: number,
): { buffs: BuffState[]; remaining: number } {
  if (damage <= 0 || !buffs.some((b) => b.id === 'shield' && b.stacks > 0)) {
    return { buffs, remaining: damage }
  }
  // Consume the shield POOL sequentially across every 'shield' buff (a hero can
  // hold more than one — e.g. an item shield + an ability shield). The old
  // find()-based code only sized off the FIRST shield: it then either subtracted
  // the damage from ALL shields (over-absorb) or deleted ALL shields (lost the
  // untouched ones). Sequential consumption drains each in turn, drops only
  // fully-spent shields, and is byte-for-byte identical in the single-shield case.
  let remaining = damage
  const out = buffs
    .map((b) => {
      if (b.id !== 'shield' || remaining <= 0 || b.stacks <= 0) return b
      const used = Math.min(b.stacks, remaining)
      remaining -= used
      return { ...b, stacks: b.stacks - used }
    })
    .filter((b) => !(b.id === 'shield' && b.stacks <= 0))
  return { buffs: out, remaining }
}

/**
 * One hit on a hero through the FULL mitigation chain, in order: immunity →
 * BREACH gate (code halved into a closed target) → effective plate / ice
 * (growth + items + talents + buffs) → Kernel 'hardened' → vuln amps → Echo
 * phaseShift dodge (consumed) → shields. The ONE implementation: the engine's
 * every damage path (_base.dealDamage, CombatResolver.resolveKineticHit) and
 * the danger prediction (hopDamage) all run it. Pure.
 */
export function applyIncomingHit(
  target: PlayerState,
  rawDamage: number,
  damageType: DamageType,
): PlayerState {
  // Immunity (Proxy R / Eul's invulnerable; BKB airgap; Ethereal/Ghost
  // kinetic) ignores the hit entirely — no INTEG lost, buff left for cycleBuffs to
  // expire (NOT consumed like phaseShift).
  if (isDamageImmune(target, damageType)) return target

  // BREACH access gate: code damage into a CLOSED target is halved. Kinetic and
  // black never need access. Order: AFTER isDamageImmune, BEFORE plate/ice
  // mitigation, so the half multiplies with vuln amps later in this chain
  // (0.5 × 1.4 ethereal = 0.7× raw before mitigation). No attacker-team param —
  // friendly fire does not exist (only the breaching crew can ever hit them).
  let incoming = rawDamage
  if (damageType === 'code' && !isBreached(target)) {
    incoming = Math.round(rawDamage * 0.5)
  }

  // Effective stats include items, talents, and engine-consumed buffs
  const effective = calculateEffectiveDamage(incoming, damageType, {
    plate: getEffectivePlate(target),
    ice: getEffectiveIce(target),
  })
  // Check for Kernel passive (hardened: 10% reduction)
  const hardenedReduction = target.buffs.some((b) => b.id === 'hardened') ? 0.9 : 1
  let remaining = Math.round(effective * hardenedReduction)

  // Target-side vuln debuffs amplify incoming damage (magic-vuln for code:
  // regex Q / Veil / Phase Shim; thread Yield for all types). Applied before
  // shield so the shield soaks the amplified amount ("takes more damage").
  remaining = Math.round(remaining * getIncomingDamageMultiplier(target, damageType))

  // Phase Shift (Echo W) dodges the hit ENTIRELY — check BEFORE shield so a
  // dodged hit doesn't spend the shield (matches the basic-attack path order in
  // ActionResolver and Phase Shift's "dodge the attack" contract).
  if (target.buffs.some((b) => b.id === 'phaseShift')) {
    return { ...target, buffs: target.buffs.filter((b) => b.id !== 'phaseShift') }
  }

  // Check for shield buff
  const shield = target.buffs.find((b) => b.id === 'shield')
  if (shield && shield.stacks > 0) {
    const absorbed = absorbShield(target.buffs, remaining)
    if (absorbed.remaining === 0) {
      return { ...target, buffs: absorbed.buffs }
    }
    remaining = absorbed.remaining
    target = { ...target, buffs: absorbed.buffs }
  }

  const newInteg = Math.max(0, target.integ - remaining)
  return { ...target, integ: newInteg, alive: newInteg > 0 }
}
