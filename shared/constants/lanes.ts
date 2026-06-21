import type { TeamId } from '~~/shared/types/game'

/**
 * Lane routes: ordered zone sequences from each base toward the enemy base.
 *
 * This is the SINGLE source of truth for lane topology used by:
 *  - `BotAI.ts` — bot lane movement and advancing
 *  - `CreepAI.ts` — creep wave pathing
 *
 * Each route starts at the team's T3 tower and ends at the enemy base.
 * The `full` variant (used by BotAI) prepends the team's fountain + base so a
 * bot leaving the fountain can path all the way to the lane start. The `core`
 * variant (used by CreepAI) starts at T3 because creeps spawn at T3.
 */

/** Core lane routes: T3 → T2 → T1 → river → enemy T1 → T2 → T3 → enemy base. */
export const LANE_ROUTES_CORE: Record<string, Record<TeamId, string[]>> = {
  top: {
    radiant: [
      'top-t3-rad',
      'top-t2-rad',
      'top-t1-rad',
      'top-river',
      'top-t1-dire',
      'top-t2-dire',
      'top-t3-dire',
      'dire-base',
    ],
    dire: [
      'top-t3-dire',
      'top-t2-dire',
      'top-t1-dire',
      'top-river',
      'top-t1-rad',
      'top-t2-rad',
      'top-t3-rad',
      'radiant-base',
    ],
  },
  mid: {
    radiant: [
      'mid-t3-rad',
      'mid-t2-rad',
      'mid-t1-rad',
      'mid-river',
      'mid-t1-dire',
      'mid-t2-dire',
      'mid-t3-dire',
      'dire-base',
    ],
    dire: [
      'mid-t3-dire',
      'mid-t2-dire',
      'mid-t1-dire',
      'mid-river',
      'mid-t1-rad',
      'mid-t2-rad',
      'mid-t3-rad',
      'radiant-base',
    ],
  },
  bot: {
    radiant: [
      'bot-t3-rad',
      'bot-t2-rad',
      'bot-t1-rad',
      'bot-river',
      'bot-t1-dire',
      'bot-t2-dire',
      'bot-t3-dire',
      'dire-base',
    ],
    dire: [
      'bot-t3-dire',
      'bot-t2-dire',
      'bot-t1-dire',
      'bot-river',
      'bot-t1-rad',
      'bot-t2-rad',
      'bot-t3-rad',
      'radiant-base',
    ],
  },
}

/** Full lane routes: fountain + base prepended to the core route (for bots). */
const _core = LANE_ROUTES_CORE
export const LANE_ROUTES: Record<string, Record<TeamId, string[]>> = {
  top: {
    radiant: ['radiant-fountain', 'radiant-base', ..._core.top!.radiant],
    dire: ['dire-fountain', 'dire-base', ..._core.top!.dire],
  },
  mid: {
    radiant: ['radiant-fountain', 'radiant-base', ..._core.mid!.radiant],
    dire: ['dire-fountain', 'dire-base', ..._core.mid!.dire],
  },
  bot: {
    radiant: ['radiant-fountain', 'radiant-base', ..._core.bot!.radiant],
    dire: ['dire-fountain', 'dire-base', ..._core.bot!.dire],
  },
  jungle: {
    radiant: ['radiant-fountain', 'radiant-base', 'jungle-rad-top', 'jungle-rad-bot'],
    dire: ['dire-fountain', 'dire-base', 'jungle-dire-top', 'jungle-dire-bot'],
  },
}
