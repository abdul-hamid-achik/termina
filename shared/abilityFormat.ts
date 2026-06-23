import type { AbilityDef, AbilityEffect, AbilityEffectType } from '~~/shared/types/hero'

/**
 * Pure, human-readable formatting of ability data for the hero training console
 * (and anywhere else that surfaces a kit). Kept in shared/ so the page, the
 * component, and unit tests all use the same source of truth — no duplicated
 * effect-to-text logic drifting across the UI.
 */

/** Concise label for one ability effect, e.g. "40 magical dmg", "30% slow for 2t". */
export function formatEffect(e: AbilityEffect): string {
  const dur = e.duration ? ` ${e.duration}t` : ''
  switch (e.type) {
    case 'damage':
      return `${e.value} ${e.damageType ?? 'physical'} dmg`
    case 'heal':
      return `heal ${e.value}`
    case 'shield':
      return `shield ${e.value}`
    case 'dot':
      // `value` is the TOTAL damage dealt across the duration (the convention
      // the engine + hero data use), not per-tick.
      return `${e.value} dmg${e.duration ? ` over ${e.duration}t` : ''}`
    case 'slow':
      return `${e.value}% slow${e.duration ? ` for ${e.duration}t` : ''}`
    case 'stun':
      return `stun${dur || ' 1t'}`
    case 'silence':
      return `silence${dur}`
    case 'root':
      return `root${dur}`
    case 'taunt':
      return `taunt${dur}`
    case 'fear':
      return `fear${dur}`
    case 'execute':
      return `execute < ${e.value}% hp`
    case 'teleport':
      return 'teleport'
    case 'reveal':
      return 'reveal'
    case 'buff':
      return e.description?.trim() || `buff +${e.value}`
    case 'debuff':
      return e.description?.trim() || `debuff ${e.value}`
    default:
      return e.description?.trim() || e.type
  }
}

/** One-line summary of an ability's effects, joined with " · ". */
export function abilitySummary(a: AbilityDef): string {
  const parts = a.effects.map(formatEffect)
  return parts.length > 0 ? parts.join(' · ') : 'utility'
}

/** Cooldown in whole seconds, given the 4s scheduler tick. */
export function cooldownSeconds(a: AbilityDef, tickMs: number): number {
  return Math.round((a.cooldownTicks * tickMs) / 1000)
}

/**
 * Aggregated combat impact of an ability's declared effects, for the training
 * dummy. BASE values only — no resistances/armor/amp. It's a teaching view of
 * raw kit power (so a player can compare burst vs DoT vs sustain across heroes),
 * not a faithful combat simulation.
 */
export interface AbilityImpact {
  /** Immediate one-shot damage (sum of `damage` effects). */
  burst: number
  /** Approx damage each scheduler tick (each DoT's total spread over its duration). */
  dotPerTick: number
  /** Ticks the longest DoT lasts. */
  dotDuration: number
  /** Total damage over the ability's full duration (burst + every DoT's total). */
  total: number
  /** Healing granted to the caster/ally. */
  heal: number
  /** Shield granted. */
  shield: number
}

/** A control/disable an ability lands on its target, for the dummy status line. */
export interface AbilityControl {
  /** The underlying effect type (stun/slow/silence/root/taunt/fear). */
  kind: AbilityEffectType
  /** Short uppercase label, e.g. "STUNNED", "SLOW 30%". */
  label: string
  /** Ticks the control lasts on the dummy (always ≥ 1). */
  duration: number
}

const CONTROL_TYPES = new Set<AbilityEffectType>([
  'stun',
  'silence',
  'root',
  'slow',
  'taunt',
  'fear',
])

function controlLabel(e: AbilityEffect): string {
  switch (e.type) {
    case 'stun':
      return 'STUNNED'
    case 'silence':
      return 'SILENCED'
    case 'root':
      return 'ROOTED'
    case 'slow':
      return `SLOW ${e.value}%`
    case 'taunt':
      return 'TAUNTED'
    case 'fear':
      return 'FEARED'
    default:
      return e.type.toUpperCase()
  }
}

/**
 * Control/disable effects an ability applies to its target, for the training
 * console's dummy status line. `abilityImpact` covers damage/heal/shield; this
 * surfaces the disables (stun/slow/silence/root/taunt/fear) so a learner sees
 * what a control-heavy kit actually DOES — not just its damage — and can watch
 * each control decay on the 4-second scheduler. BASE durations from the hero
 * data; a teaching view, not a combat sim. A control with no/zero declared
 * duration defaults to 1 tick (the engine's minimum disable window).
 */
export function abilityControls(a: AbilityDef): AbilityControl[] {
  const out: AbilityControl[] = []
  for (const e of a.effects) {
    if (!CONTROL_TYPES.has(e.type)) continue
    out.push({
      kind: e.type,
      label: controlLabel(e),
      duration: e.duration && e.duration > 0 ? e.duration : 1,
    })
  }
  return out
}

export function abilityImpact(a: AbilityDef): AbilityImpact {
  let burst = 0
  let dotPerTick = 0
  let dotDuration = 0
  let dotTotal = 0
  let heal = 0
  let shield = 0
  for (const e of a.effects) {
    switch (e.type) {
      case 'damage':
        burst += e.value
        break
      case 'dot':
        // `value` is TOTAL damage over the duration; derive the per-tick rate.
        dotTotal += e.value
        dotPerTick += e.duration ? Math.round(e.value / e.duration) : e.value
        dotDuration = Math.max(dotDuration, e.duration ?? 0)
        break
      case 'heal':
        heal += e.value
        break
      case 'shield':
        shield += e.value
        break
    }
  }
  return { burst, dotPerTick, dotDuration, total: burst + dotTotal, heal, shield }
}
