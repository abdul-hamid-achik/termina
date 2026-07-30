import type { HeroRole } from '~~/shared/types/hero'

/**
 * Display metadata for each hero role — a plural label and a one-line teaching
 * blurb (what the role does / how it's played). Single source of truth so the
 * lore roster and the /heroes role filter never drift apart.
 */
export const ROLE_META: Record<HeroRole, { label: string; blurb: string }> = {
  carry: {
    label: 'Carries',
    blurb: 'Squishy on the first cycles, unstoppable if funded — they scale into closers.',
  },
  mage: {
    label: 'Mages',
    blurb: 'Burst casters who burn targets down with ability combos.',
  },
  assassin: {
    label: 'Assassins',
    blurb: 'Strike isolated operators from stealth and are gone before the response lands.',
  },
  tank: {
    label: 'Tanks',
    blurb: 'Front-line shells that soak the damage and start the fights.',
  },
  support: {
    label: 'Supports',
    blurb: 'Keep the crew running — heals, shields, vision, and utility.',
  },
  offlaner: {
    label: 'Offlaners',
    blurb: 'Durable disruptors who thrive in contested ground.',
  },
}

/** Stable display order for role groupings (carry → support → … ). */
export const ROLE_ORDER: HeroRole[] = ['carry', 'mage', 'assassin', 'tank', 'support', 'offlaner']
