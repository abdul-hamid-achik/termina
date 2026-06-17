import type { HeroRole } from '~~/shared/types/hero'

/**
 * Canonical "what to build per role" item lists — the SINGLE source shared by
 * the bot AI (which buys them) and the shop UI (which recommends them to a human
 * player). Each list is cost-ascending: the bot buys the first affordable item
 * and STOPS, saving for the next core item, so order = priority. Every entry
 * grants an engine-consumed stat (attack/defense/hp/mp/magicResist) — no dead
 * moveSpeed-only items like boots_of_speed.
 */

/** Fallback when a hero has no role-specific list — solid right-click + utility cores. */
const CORE_BUILD_ORDER = [
  'blades_of_attack',
  'null_pointer',
  'garbage_collector',
  'blink_module',
  'stack_overflow',
  'segfault_blade',
]

/** Role-tilted build orders so each hero itemises like its archetype. */
const ROLE_BUILD_ORDERS: Record<HeroRole, string[]> = {
  // Right-click damage + a survivability spike (BKB) mid-build.
  carry: [
    'blades_of_attack',
    'null_pointer',
    'maelstrom',
    'black_king_bar',
    'daedalus',
    'segfault_blade',
  ],
  // Burst + pickoff tools (crit, blink, bash).
  assassin: [
    'blades_of_attack',
    'crystalys',
    'blink_module',
    'skull_basher',
    'black_king_bar',
    'daedalus',
  ],
  // Max HP / armor to soak for the team.
  tank: [
    'ring_of_health',
    'garbage_collector',
    'blade_mail',
    'vanguard',
    'assault_cuirass',
    'heart_of_tarrasque',
  ],
  // Durable initiator: blink in, blademail, then tanky cores.
  offlaner: [
    'ring_of_health',
    'blink_module',
    'blade_mail',
    'black_king_bar',
    'assault_cuirass',
    'heart_of_tarrasque',
  ],
  // Mana + magic resist + the spell-amp/control cores.
  mage: [
    'aether_lens',
    'veil_of_discord',
    'mystical_staff',
    'black_king_bar',
    'ethereal_blade',
    'scythe_of_vyse',
  ],
  // Cheap utility first, then team-saving items.
  support: [
    'sobi_mask',
    'ring_of_health',
    'force_staff',
    'veil_of_discord',
    'euls_scepter',
    'lotus_orb',
  ],
}

/** The recommended item list for a hero's role (falls back to the core build). */
export function recommendedItemsForRole(role: HeroRole | undefined): string[] {
  return (role && ROLE_BUILD_ORDERS[role]) || CORE_BUILD_ORDER
}
