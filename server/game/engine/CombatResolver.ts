import type { PlayerState } from '~~/shared/types/game'
import { isDamageImmune } from './DamageCalculator'
import { dealDamage, hasBuff } from '../heroes/_base'

/**
 * Unified physical-hit resolution for NPC attackers (towers, creeps, Roshan).
 *
 * Heroes defend themselves with the SAME mitigation chain regardless of who
 * swings at them: immunity (Ghost/Ethereal/invulnerable) → effective defense
 * (items + talents + buffs) → Kernel 'hardened' 10% reduction → target-side
 * vuln amps (thread Yield) → shield absorption → Echo 'phaseShift' dodge.
 *
 * Before this helper, each NPC site reimplemented a *slice* of that chain —
 * towers used raw `target.defense` (ignoring items, cuirass, vuln, hardened,
 * shield, phaseShift), creeps skipped the multiplier + hardened + shield +
 * phaseShift, and the inline Roshan path in GameLoop skipped everything but
 * immunity. A hero with an armor item or a shield took more tower damage than
 * intended; a phaseShift hero couldn't dodge a tower shot.
 *
 * This wrapper routes every NPC→hero physical hit through `_base.dealDamage`
 * (the single canonical mitigation implementation, also used by hero
 * abilities/passives) and reports how much HP was actually lost so callers can
 * emit accurate damage events. `_base.dealDamage` remains the lower-level
 * target-only primitive; this is the NPC-facing convenience.
 */
export interface PhysicalHitResult {
  /** The post-hit player state (updated HP/alive/buffs). */
  player: PlayerState
  /** HP actually lost this hit (post-mitigation, post-shield). 0 if immune/dodged. */
  damageDealt: number
  /** True when the target's immunity (Ghost/Ethereal/invulnerable) ignored the hit. */
  immune: boolean
  /** True when Echo's phaseShift dodged the hit (buff consumed). */
  dodged: boolean
}

/**
 * Resolve a physical attack from an NPC against a hero, applying the full
 * shared mitigation chain. Callers should skip emitting a damage event when
 * `immune` or `damageDealt === 0`.
 */
export function resolvePhysicalHit(target: PlayerState, rawDamage: number): PhysicalHitResult {
  // Pre-check immunity/dodge so callers can skip event emission without
  // re-running the buff scan. dealDamage also checks these, but reporting
  // them here keeps the caller branch-free.
  const immune = isDamageImmune(target, 'physical')
  const dodged = !immune && hasBuff(target, 'phaseShift')

  const post = dealDamage(target, rawDamage, 'physical')
  const damageDealt = immune || dodged ? 0 : target.hp - post.hp

  return { player: post, damageDealt, immune, dodged }
}

/**
 * Compute the Blade Mail reflect amount for a hit.
 *
 * Blade Mail returns a fixed fraction of the POST-mitigation, post-shield
 * physical damage the holder took back at the attacker as PURE damage (pure
 * bypasses the attacker's armor). The same formula is used for both the
 * basic-attack reflect (ActionResolver attack phase) and the ability-cast
 * reflect (resolveHeroCast) so the two paths can never diverge.
 *
 * `damageDealt` is the HP the Blade Mail holder actually lost (from
 * `PhysicalHitResult.damageDealt` or the ability HP-delta). `fraction` defaults
 * to 1.0 (100% return, the live value for both paths).
 */
export function computeBladeMailReflect(damageDealt: number, fraction = 1): number {
  return Math.max(0, Math.round(damageDealt * fraction))
}
