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
  mainframe: 'Mainframe',
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

export const WARD_LABELS = {
  observer: 'CAMTAP',
  sentry: 'SNIFFER',
} as const

export const ACTION_LABELS = {
  harden: 'HARDEN',
  burn: 'BURN',
} as const

/** Gold is SCRIP on every player-facing surface. */
export const CURRENCY = { label: 'scrip', short: 'sc' } as const

export type WaveRole = 'melee' | 'ranged' | 'siege'

/**
 * Wave units are asymmetric by crew: AUDIT fields corporate security
 * (guard / sweeper / auditor), CHAFF fields day-hire muscle
 * (mule / script / picket).
 */
export const WAVE_UNIT_LABELS: Record<TeamId, Record<WaveRole, string>> = {
  chaff: { melee: 'mule', ranged: 'script', siege: 'picket' },
  audit: { melee: 'guard', ranged: 'sweeper', siege: 'auditor' },
}

export type NeutralCamp =
  | 'kobold'
  | 'ogre_mage'
  | 'centaur'
  | 'ancient_dragon'
  | 'ancient_rock_golem'

/** The five neutral camps, renamed for the Silt. */
export const CAMP_LABELS: Record<NeutralCamp, string> = {
  kobold: 'STUB',
  ogre_mage: 'WATCHDOG',
  centaur: 'WARDEN',
  ancient_dragon: 'ORPHAN',
  ancient_rock_golem: 'ZOMBIE',
}
