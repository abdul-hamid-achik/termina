import type { HeroRole } from '~~/shared/types/hero'

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
