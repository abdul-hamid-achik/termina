import type { HeroPosture } from '~~/shared/types/hero'

/**
 * Display metadata for each posture — the player-facing axis (B2a). What a
 * player picks ON. `role` stays in shared/types/hero.ts for BotManager and
 * itemBuilds; this is the label the draft, the /heroes console and the /lore
 * roster lead with.
 */
export const POSTURE_META: Record<HeroPosture, { label: string; blurb: string }> = {
  BREACH: {
    label: 'BREACH',
    blurb: 'You create the opening — mobility, stealth, silence, reveal, burst.',
  },
  HOLD: {
    label: 'HOLD',
    blurb: 'You keep what the crew already has — shields, heals, taunts, mitigation.',
  },
  ROAM: {
    label: 'ROAM',
    blurb: 'You are never where the fight was — links, swaps, teleports, map presence.',
  },
  HARDLINE: {
    label: 'HARDLINE',
    blurb: 'You win the long grind — sustain, scaling, and the hits that keep landing.',
  },
}

/** Stable display order for posture groupings. */
export const POSTURE_ORDER: HeroPosture[] = ['BREACH', 'HOLD', 'ROAM', 'HARDLINE']
