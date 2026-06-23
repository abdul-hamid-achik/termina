import type { HeroDef, AbilityDef, AbilityEffectType } from '~~/shared/types/hero'

/** Descriptive kit-identity tags — how a hero plays, beyond its role label. */
export type PlaystyleTag = 'Burst' | 'Damage over time' | 'Control' | 'Sustain' | 'Mobility'

const CONTROL_TYPES: ReadonlySet<AbilityEffectType> = new Set([
  'stun',
  'silence',
  'root',
  'slow',
  'taunt',
  'fear',
])

// Canonical display order so the chips read primary → secondary consistently.
const TAG_ORDER: readonly PlaystyleTag[] = [
  'Burst',
  'Damage over time',
  'Control',
  'Sustain',
  'Mobility',
]

/**
 * Descriptive playstyle tags for a hero, derived from what its four active
 * abilities DO — a learn-the-roster aid so a newcomer can scan 18 heroes by how
 * their kit plays, not just by role.
 *
 * Classification counts abilities by effect TYPE (damage / dot / control /
 * heal+shield / teleport), never by effect VALUE: the engine resolves real
 * damage from its own constants, so hero `effects[].value` is a display
 * approximation — but the effect *types* a kit declares are reliable. A hero can
 * carry several tags (e.g. Burst + Control); never zero (falls back to its
 * dominant offensive shape).
 */
export function heroPlaystyleTags(hero: HeroDef): PlaystyleTag[] {
  const abilities: AbilityDef[] = [
    hero.abilities.q,
    hero.abilities.w,
    hero.abilities.e,
    hero.abilities.r,
  ]
  let burst = 0
  let dot = 0
  let control = 0
  let sustain = 0
  let mobility = 0
  for (const ab of abilities) {
    const types = new Set(ab.effects.map((e) => e.type))
    if (types.has('damage')) burst++
    if (types.has('dot')) dot++
    if (types.has('heal') || types.has('shield')) sustain++
    if (ab.effects.some((e) => CONTROL_TYPES.has(e.type))) control++
    if (types.has('teleport')) mobility++
  }

  const present: Record<PlaystyleTag, boolean> = {
    Burst: burst >= 2,
    'Damage over time': dot >= 2,
    Control: control >= 2,
    Sustain: sustain >= 1,
    Mobility: mobility >= 1,
  }
  const tags = TAG_ORDER.filter((t) => present[t])

  // Never blank — fall back to the kit's dominant offensive shape.
  if (tags.length === 0) tags.push(dot > burst ? 'Damage over time' : 'Burst')
  return tags
}
