import type { HeroId, HeroRole } from '~~/shared/types/hero'
import { HEROES } from '~~/shared/constants/heroes'

/**
 * Canonical "what to build per role" item lists — the SINGLE source shared by
 * the bot AI (which buys them) and the shop UI (which recommends them to a human
 * player). Each list is cost-ascending: the bot buys the first affordable item
 * and STOPS, saving for the next core item, so order = priority. Every entry
 * grants an engine-consumed stat (attack/plate/hp/mp/ice) — no dead
 */

/** Fallback when a hero has no role-specific list — solid right-click + utility cores. */
const CORE_BUILD_ORDER = [
  'edge_kit',
  'null_pointer',
  'garbage_collector',
  'jump_shunt',
  'stack_overflow',
  'segfault_blade',
]

/** Role-tilted build orders so each hero itemises like its archetype. */
const ROLE_BUILD_ORDERS: Record<HeroRole, string[]> = {
  // Right-click damage + a survivability spike (BKB) mid-build.
  carry: ['edge_kit', 'null_pointer', 'arc_coil', 'hardshell', 'killshot_coil', 'segfault_blade'],
  // Burst + pickoff tools (crit, blink, bash).
  assassin: [
    'edge_kit',
    'fracture_edge',
    'jump_shunt',
    'concussion_hammer',
    'hardshell',
    'killshot_coil',
  ],
  // Max INTEG / armor to soak for the team.
  tank: [
    'clot_ring',
    'garbage_collector',
    'spite_plate',
    'bulwark_plate',
    'siege_lattice',
    'bulk_lattice',
  ],
  // Durable initiator: blink in, blademail, then tanky cores.
  offlaner: [
    'clot_ring',
    'jump_shunt',
    'spite_plate',
    'hardshell',
    'siege_lattice',
    'bulk_lattice',
  ],
  // BW + ice + the spell-amp/control cores.
  mage: ['clock_lens', 'discord_routine', 'amp_stack', 'hardshell', 'phase_shim', 'lockout_shunt'],
  // Cheap utility first, then team-saving items.
  support: [
    'drip_mask',
    'clot_ring',
    'shove_splice',
    'discord_routine',
    'stasis_shunt',
    'mirror_shell',
  ],
}

/** The recommended item list for a hero's role (falls back to the core build). */
export function recommendedItemsForRole(role: HeroRole | undefined): string[] {
  return (role && ROLE_BUILD_ORDERS[role]) || CORE_BUILD_ORDER
}

/**
 * What a team's damage is made of.
 *
 * `codeShare` is the fraction of its mitigable damage that ice reduces rather
 * than plate — 1 means everything it throws is code, 0 means everything is
 * kinetic. Black damage is deliberately excluded: nothing you can buy reduces
 * it, so counting it would dilute a signal whose only purpose is choosing
 * between plate and ice.
 */
export interface DamageMix {
  kinetic: number
  code: number
  /** 0..1, or `null` when the team deals no mitigable damage at all. */
  codeShare: number | null
}

/**
 * The damage mix of a set of heroes, from their kits.
 *
 * Each hero contributes one point for its basic attack — which it throws every
 * cycle it is in range, so it is never a minor part of the profile — and one
 * point per damaging ability. That is coarse on purpose: the alternative is
 * weighting by ability damage numbers, which would swing the profile every
 * balance patch and encode "what hurts right now" rather than "what kind of
 * damage this draft is".
 */
export function damageMixForHeroes(heroIds: Array<string | null | undefined>): DamageMix {
  let kinetic = 0
  let code = 0
  for (const id of heroIds) {
    const hero = id ? HEROES[id as HeroId] : undefined
    if (!hero) continue
    if (hero.attackType === 'code') code++
    else kinetic++
    for (const ability of Object.values(hero.abilities)) {
      for (const effect of ability.effects ?? []) {
        if (effect.type !== 'damage') continue
        // An ability with no explicit type deals the hero's attack type.
        const dt = effect.damageType ?? hero.attackType
        if (dt === 'code') code++
        else if (dt === 'kinetic') kinetic++
      }
    }
  }
  const total = kinetic + code
  return { kinetic, code, codeShare: total === 0 ? null : code / total }
}

/**
 * How lopsided a draft must be before itemising against it.
 *
 * Below this the two mitigations are worth about the same and buying for the
 * matchup is just buying worse core items.
 */
export const COUNTER_SKEW_THRESHOLD = 0.62

/**
 * Counter items, cheapest first, for a team whose damage looks like `mix`.
 *
 * Returns `[]` when the draft is balanced — the caller should then stick to the
 * role build. Every entry grants the relevant mitigation stat; the lists stay
 * short because a bot that buys three counter items has stopped building a
 * hero.
 */
export function counterItemsFor(mix: DamageMix): string[] {
  if (mix.codeShare === null) return []
  // Ice, for a code-heavy enemy.
  if (mix.codeShare >= COUNTER_SKEW_THRESHOLD) {
    return ['discord_routine', 'intercept_shell', 'lockout_shunt']
  }
  // Plate, for a kinetic-heavy enemy.
  if (1 - mix.codeShare >= COUNTER_SKEW_THRESHOLD) {
    return ['bulwark_plate', 'ablative_shell', 'mirror_shell']
  }
  return []
}
