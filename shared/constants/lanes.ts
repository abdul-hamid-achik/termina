import type { TeamId } from '~~/shared/types/game'

/**
 * Lane routes: ordered zone sequences from each base toward the enemy base.
 *
 * This is the SINGLE source of truth for lane topology used by:
 *  - `BotAI.ts` — bot lane movement and advancing
 *  - `WaveAI.ts` — wave pathing
 *
 * Each route starts at the team's T3 ice and ends at the enemy base.
 * The `full` variant (used by BotAI) prepends the team's fountain + base so a
 * bot leaving the fountain can path all the way to the lane start. The `core`
 * variant (used by WaveAI) starts at T3 because waves spawn at T3.
 */

/** Core lane routes: T3 → T2 → T1 → river → enemy T1 → T2 → T3 → enemy base. */
export const LANE_ROUTES_CORE: Record<string, Record<TeamId, string[]>> = {
  seawall: {
    chaff: [
      'seawall-t3-chaff',
      'seawall-t2-chaff',
      'seawall-t1-chaff',
      'seawall-cross',
      'seawall-t1-audit',
      'seawall-t2-audit',
      'seawall-t3-audit',
      'landing-terminal',
    ],
    audit: [
      'seawall-t3-audit',
      'seawall-t2-audit',
      'seawall-t1-audit',
      'seawall-cross',
      'seawall-t1-chaff',
      'seawall-t2-chaff',
      'seawall-t3-chaff',
      'rookery-terminal',
    ],
  },
  coldstore: {
    chaff: [
      'coldstore-t3-chaff',
      'coldstore-t2-chaff',
      'coldstore-t1-chaff',
      'coldstore-cross',
      'coldstore-t1-audit',
      'coldstore-t2-audit',
      'coldstore-t3-audit',
      'landing-terminal',
    ],
    audit: [
      'coldstore-t3-audit',
      'coldstore-t2-audit',
      'coldstore-t1-audit',
      'coldstore-cross',
      'coldstore-t1-chaff',
      'coldstore-t2-chaff',
      'coldstore-t3-chaff',
      'rookery-terminal',
    ],
  },
  shallows: {
    chaff: [
      'shallows-t3-chaff',
      'shallows-t2-chaff',
      'shallows-t1-chaff',
      'shallows-cross',
      'shallows-t1-audit',
      'shallows-t2-audit',
      'shallows-t3-audit',
      'landing-terminal',
    ],
    audit: [
      'shallows-t3-audit',
      'shallows-t2-audit',
      'shallows-t1-audit',
      'shallows-cross',
      'shallows-t1-chaff',
      'shallows-t2-chaff',
      'shallows-t3-chaff',
      'rookery-terminal',
    ],
  },
}

/** Full lane routes: fountain + base prepended to the core route (for bots). */
const _core = LANE_ROUTES_CORE
export const LANE_ROUTES: Record<string, Record<TeamId, string[]>> = {
  seawall: {
    chaff: ['rookery-anchor', 'rookery-terminal', ..._core.seawall!.chaff],
    audit: ['landing-anchor', 'landing-terminal', ..._core.seawall!.audit],
  },
  coldstore: {
    chaff: ['rookery-anchor', 'rookery-terminal', ..._core.coldstore!.chaff],
    audit: ['landing-anchor', 'landing-terminal', ..._core.coldstore!.audit],
  },
  shallows: {
    chaff: ['rookery-anchor', 'rookery-terminal', ..._core.shallows!.chaff],
    audit: ['landing-anchor', 'landing-terminal', ..._core.shallows!.audit],
  },
  silt: {
    chaff: ['rookery-anchor', 'rookery-terminal', 'silt-chaff-upper', 'silt-chaff-lower'],
    audit: ['landing-anchor', 'landing-terminal', 'silt-audit-upper', 'silt-audit-lower'],
  },
}
