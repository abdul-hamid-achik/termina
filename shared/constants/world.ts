import type { TeamId } from '~~/shared/types/game'

/**
 * World frame — the settled TERMINA canon (see CLAUDE.md "WORLD").
 * Single source of the frame strings so lore / index / learn / lobby
 * cannot drift. Copy here is player-facing prose, not identifiers.
 */
export const CITY = 'TERMINA'

export const DISTRICTS = ['LANDING', 'ROOKERY', 'COLDSTORE', 'SHALLOWS'] as const

export const ROUTES = ['SEAWALL', 'COLDSTORE', 'SHALLOWS'] as const

export const CREWS = { chaff: 'CHAFF', audit: 'AUDIT' } as const

export function cycleFrameLine(seconds: number): string {
  return `The city commits every instruction at once, ${seconds}s wide: one cycle.`
}

// ── The world lexicon ─────────────────────────────────────────────
// One Record per structured noun family, each typed exhaustively over its
// union so adding a member is a compile error. Player-facing labels live
// HERE, never spelled out ad hoc in components or the narrative layer.
//
// NOTE (R1 scope): the TeamId union still reads chaff/audit until R1-05
// sweeps it. FACTION_META is keyed on the union AS IT IS so callers move to
// the lexicon now and the id sweep later touches only this file.

export interface FactionMeta {
  /** Full display label (scoreboard, combat log). */
  label: string
  /** Compact label for tight HUD slots. */
  short: string
  /** One-line identity blurb (learn/lore surfaces). */
  blurb: string
}

export const FACTION_META: Record<TeamId, FactionMeta> = {
  chaff: {
    label: 'CHAFF',
    short: 'CHF',
    blurb: 'Came up off the street and stayed there.',
  },
  audit: {
    label: 'AUDIT',
    short: 'AUD',
    blurb: "Quorum's corporate response division.",
  },
}

/** ICE are ICE. The T3 guarding the base is BLACK ICE. */
export const STRUCTURE_LABELS = {
  ice: { 1: 'ICE', 2: 'ICE', 3: 'BLACK ICE' },
  terminal: 'Terminal',
} as const

/** The five cache types as cache drops, plus the pit objectives. */
export const OBJECTIVE_LABELS = {
  tenant: 'THE TENANT',
  backup: 'BACKUP',
  cache: {
    haste: 'overclock cache',
    dd: 'amplifier cache',
    regen: 'restore cache',
    arcane: 'surge cache',
    invis: 'ghost cache',
  },
} as const

/** Display labels for the two surveillance devices, keyed by the values the
 *  engine actually emits (`WardState.type` / `WardPlacedEvent.wardType`). These
 *  used to be keyed `observer`/`sentry` — the Dota ward names — so every lookup
 *  missed and the feed printed the raw id. */
export const WARD_LABELS = {
  camtap: 'CAMTAP',
  sniffer: 'SNIFFER',
} as const

export const ACTION_LABELS = {
  harden: 'HARDEN',
  burn: 'BURN',
} as const

/** Gold is SCRIP on every player-facing surface. */
export const CURRENCY = { label: 'scrip', short: 'sc' } as const

export type WaveRole = 'line' | 'sweep' | 'breach'

/**
 * Wave units are asymmetric by crew: AUDIT fields corporate security
 * (guard / sweeper / auditor), CHAFF fields day-hire muscle
 * (mule / script / picket).
 */
export const WAVE_UNIT_LABELS: Record<TeamId, Record<WaveRole, string>> = {
  chaff: { line: 'mule', sweep: 'script', breach: 'picket' },
  audit: { line: 'guard', sweep: 'sweeper', breach: 'auditor' },
}

export type NeutralCamp = 'stub' | 'watchdog' | 'warden' | 'orphan' | 'zombie'

/** The five neutral camps, renamed for the Silt. */
export const CAMP_LABELS: Record<NeutralCamp, string> = {
  stub: 'STUB',
  watchdog: 'WATCHDOG',
  warden: 'WARDEN',
  orphan: 'ORPHAN',
  zombie: 'ZOMBIE',
}

/**
 * Player-facing labels for the six internal `HeroRole` keys.
 *
 * `role` is machinery: BotManager's route priority and itemBuilds'
 * ROLE_BUILD_ORDERS consume it, which is the only reason it survives. It was
 * still reaching players as carry / mage / assassin / tank / support / offlaner
 * on the /items build tabs — six words from a different game, sitting above a
 * list of cyberware.
 *
 * POSTURE stays the axis a player picks on. These are only ever a *job* label on
 * a recommended build, in the street/deck register the items already use:
 *
 *   TRIGGER    you are the damage, and you need to live long enough to deal it
 *   NETRUNNER  code damage and spell amp — the deck build
 *   GHOST      in, kill, out; burst and mobility
 *   BRICK      you soak; plate, INTEG and the ground you stand on
 *   HANDLER    you keep the crew alive and lit
 *   MERC       you work alone on ground nobody is helping you hold
 *
 * Deliberately avoids FIXER and BREACHER: `fixer` is a rank tier and `breach` is
 * a posture, and a third vocabulary reusing either would be worse than the words
 * it replaced.
 */
export const ROLE_LABELS = {
  carry: 'TRIGGER',
  mage: 'NETRUNNER',
  assassin: 'GHOST',
  tank: 'BRICK',
  support: 'HANDLER',
  offlaner: 'MERC',
} as const

/**
 * What each cyberware class DOES to you, and when you want it.
 *
 * `ITEM_CATEGORIES[].blurb` says what a class contains ("carried weapons and
 * attachments"). That is a shelf label, and a player standing in the shop with
 * 1400sc is not asking what is on the shelf — they are asking *which shelf is
 * my problem on right now*. These answer that, and they are the only place the
 * five classes are explained as a decision rather than as a taxonomy.
 *
 * `where` is the fiction: chrome is implanted, hardware is carried, deck is
 * software, wetware is neural, street is whatever you can fence. That is what
 * makes the partition feel like a world instead of five tabs.
 */
export interface ItemClassPrimer {
  /** One line of fiction: what this actually is on a body. */
  where: string
  /** The problem it solves, in the player's terms. */
  buyWhen: string
}

export const ITEM_CLASS_PRIMERS: Record<string, ItemClassPrimer> = {
  street: {
    where: 'Bought off a fence, carried in a pocket, gone when you use it.',
    buyWhen: 'Always. Consumables and sight are what keep a lead from becoming a death.',
  },
  chrome: {
    where: 'Surgically integrated. You do not take it off, and it does not care what hits you.',
    buyWhen: 'You are dying faster than you are killing — INTEG, plate and mitigation.',
  },
  hardware: {
    where: 'Carried and attached. A rig, a driver, an edge — machinery you point at people.',
    buyWhen: 'Your basic attack is your damage and it is not landing hard enough.',
  },
  deck: {
    where: 'Software. It runs on the terminal, not on your body.',
    buyWhen:
      'Your abilities are your damage — code amp, cooldowns, and the burst that ends a fight.',
  },
  wetware: {
    where: 'Neural and reflex. It changes how fast you decide, not how hard you hit.',
    buyWhen: 'You need to be somewhere else, or you need someone else to stop moving.',
  },
} as const
