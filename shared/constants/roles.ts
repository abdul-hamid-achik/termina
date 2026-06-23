import type { HeroRole } from '~~/shared/types/hero'

/**
 * Display metadata for each hero role — a plural label and a one-line teaching
 * blurb (what the role does / how it's played). Single source of truth so the
 * lore roster and the /heroes role filter never drift apart.
 */
export const ROLE_META: Record<HeroRole, { label: string; blurb: string }> = {
  carry: {
    label: 'Carries',
    blurb: 'Fragile early, unstoppable if fed — they scale into late-game wreckers.',
  },
  mage: {
    label: 'Mages',
    blurb: 'Burst casters who delete targets with ability combos.',
  },
  assassin: {
    label: 'Assassins',
    blurb: 'Pick off isolated targets from stealth and reposition before the answer lands.',
  },
  tank: {
    label: 'Tanks',
    blurb: 'Front-line cores that soak punishment and start the fights.',
  },
  support: {
    label: 'Supports',
    blurb: 'Enable the team — heals, shields, vision, and utility.',
  },
  offlaner: {
    label: 'Offlaners',
    blurb: 'Durable disruptors who thrive in contested space.',
  },
}

/** Stable display order for role groupings (carry → support → … ). */
export const ROLE_ORDER: HeroRole[] = ['carry', 'mage', 'assassin', 'tank', 'support', 'offlaner']
