import type { TeamId } from '~~/shared/types/game'

/**
 * Lane routes: ordered zone sequences from each base toward the enemy base.
 *
 * This is the SINGLE source of truth for lane topology used by:
 *  - `BotAI.ts` — bot lane movement and advancing
 *  - `CreepAI.ts` — creep wave pathing
 *
 * Each route starts at the team's T3 ice and ends at the enemy base.
 * The `full` variant (used by BotAI) prepends the team's fountain + base so a
 * bot leaving the fountain can path all the way to the lane start. The `core`
 * variant (used by CreepAI) starts at T3 because creeps spawn at T3.
 */

/** Core lane routes: T3 → T2 → T1 → river → enemy T1 → T2 → T3 → enemy base. */
export const LANE_ROUTES_CORE: Record<string, Record<TeamId, string[]>> = {
  top: {
    chaff: [
      'top-t3-chaff',
      'top-t2-chaff',
      'top-t1-chaff',
      'top-river',
      'top-t1-audit',
      'top-t2-audit',
      'top-t3-audit',
      'audit-base',
    ],
    audit: [
      'top-t3-audit',
      'top-t2-audit',
      'top-t1-audit',
      'top-river',
      'top-t1-chaff',
      'top-t2-chaff',
      'top-t3-chaff',
      'chaff-base',
    ],
  },
  mid: {
    chaff: [
      'mid-t3-chaff',
      'mid-t2-chaff',
      'mid-t1-chaff',
      'mid-river',
      'mid-t1-audit',
      'mid-t2-audit',
      'mid-t3-audit',
      'audit-base',
    ],
    audit: [
      'mid-t3-audit',
      'mid-t2-audit',
      'mid-t1-audit',
      'mid-river',
      'mid-t1-chaff',
      'mid-t2-chaff',
      'mid-t3-chaff',
      'chaff-base',
    ],
  },
  bot: {
    chaff: [
      'bot-t3-chaff',
      'bot-t2-chaff',
      'bot-t1-chaff',
      'bot-river',
      'bot-t1-audit',
      'bot-t2-audit',
      'bot-t3-audit',
      'audit-base',
    ],
    audit: [
      'bot-t3-audit',
      'bot-t2-audit',
      'bot-t1-audit',
      'bot-river',
      'bot-t1-chaff',
      'bot-t2-chaff',
      'bot-t3-chaff',
      'chaff-base',
    ],
  },
}

/** Full lane routes: fountain + base prepended to the core route (for bots). */
const _core = LANE_ROUTES_CORE
export const LANE_ROUTES: Record<string, Record<TeamId, string[]>> = {
  top: {
    chaff: ['chaff-fountain', 'chaff-base', ..._core.top!.chaff],
    audit: ['audit-fountain', 'audit-base', ..._core.top!.audit],
  },
  mid: {
    chaff: ['chaff-fountain', 'chaff-base', ..._core.mid!.chaff],
    audit: ['audit-fountain', 'audit-base', ..._core.mid!.audit],
  },
  bot: {
    chaff: ['chaff-fountain', 'chaff-base', ..._core.bot!.chaff],
    audit: ['audit-fountain', 'audit-base', ..._core.bot!.audit],
  },
  jungle: {
    chaff: ['chaff-fountain', 'chaff-base', 'silt-chaff-top', 'silt-chaff-bot'],
    audit: ['audit-fountain', 'audit-base', 'silt-audit-top', 'silt-audit-bot'],
  },
}
