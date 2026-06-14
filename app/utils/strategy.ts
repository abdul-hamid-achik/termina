/**
 * Strategic-legibility helpers — pure functions that turn the game state the
 * store already holds (team gold, items, roshan/runes/aegis, vision) into the
 * glanceable macro readouts a MOBA player needs: net worth, gold lead,
 * objective timers, vision coverage, day/night meaning, and sparkline trends.
 *
 * Everything here is pure and unit-tested; the War Room components are thin
 * renderers over these.
 */
import { ITEMS } from '~~/shared/constants/items'
import { ZONES } from '~~/shared/constants/zones'
import {
  ROSHAN_RESPAWN_TICKS,
  RUNE_DURATION_TICKS,
  RUNE_INTERVAL_TICKS,
} from '~~/shared/constants/balance'
import type { RoshanState, RuneState, TeamId } from '~~/shared/types/game'

/** Minimal shape needed to value a player — works for PlayerState and fogged players. */
export interface NetWorthInput {
  gold?: number
  items?: (string | null)[]
  fogged?: boolean
}

/** True net worth = liquid gold + the buy cost of every item carried. */
export function playerNetWorth(p: NetWorthInput): number {
  if (p.fogged) return 0
  let nw = p.gold ?? 0
  for (const id of p.items ?? []) {
    if (id) nw += ITEMS[id]?.cost ?? 0
  }
  return nw
}

/** Sum of net worth across a team's players (fogged players contribute 0). */
export function teamNetWorth(
  players: Array<NetWorthInput & { team: TeamId | string }>,
  team: TeamId,
): number {
  return players.filter((p) => p.team === team).reduce((sum, p) => sum + playerNetWorth(p), 0)
}

export interface GoldLead {
  leader: TeamId | null
  amount: number
}

/** Who's ahead on net worth and by how much (leader=null on a dead tie). */
export function goldLead(radiantNetWorth: number, direNetWorth: number): GoldLead {
  const diff = radiantNetWorth - direNetWorth
  if (diff === 0) return { leader: null, amount: 0 }
  return diff > 0 ? { leader: 'radiant', amount: diff } : { leader: 'dire', amount: -diff }
}

/** Compact gold: 4200 -> "4.2k", 950 -> "950". */
export function formatGoldShort(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(Math.round(n))
}

/** Ticks -> "m:ss" clock (1 tick = 4s). Clamps negatives to 0. */
export function ticksToClock(ticks: number): string {
  const seconds = Math.max(0, ticks) * 4
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// ── Roshan ──────────────────────────────────────────────────────────

export type RoshanStatus = 'up' | 'dead' | 'unknown'

export interface RoshanReadout {
  status: RoshanStatus
  /** Ticks until respawn when dead, else 0. */
  respawnIn: number
  label: string
  hpPct: number | null
}

export function formatRoshan(
  roshan: RoshanState | null | undefined,
  currentTick: number,
): RoshanReadout {
  if (!roshan) return { status: 'unknown', respawnIn: 0, label: 'ROSHAN ?', hpPct: null }
  if (roshan.alive) {
    const hpPct = roshan.maxHp > 0 ? Math.round((roshan.hp / roshan.maxHp) * 100) : 100
    return { status: 'up', respawnIn: 0, label: 'ROSHAN up', hpPct }
  }
  const respawnIn =
    roshan.deathTick != null
      ? Math.max(0, roshan.deathTick + ROSHAN_RESPAWN_TICKS - currentTick)
      : 0
  return {
    status: 'dead',
    respawnIn,
    label: respawnIn > 0 ? `ROSHAN dead ${respawnIn}t` : 'ROSHAN respawning',
    hpPct: null,
  }
}

// ── Runes ───────────────────────────────────────────────────────────

export interface RuneReadout {
  /** Currently-live runes with ticks until they expire. */
  live: Array<{ zone: string; type: string; expiresIn: number }>
  /** Ticks until the next rune spawn window. */
  nextIn: number
  label: string
}

export function formatRunes(runes: RuneState[] | undefined, currentTick: number): RuneReadout {
  const live = (runes ?? [])
    .map((r) => ({
      zone: r.zone,
      type: r.type,
      expiresIn: Math.max(0, r.tick + RUNE_DURATION_TICKS - currentTick),
    }))
    .filter((r) => r.expiresIn > 0)

  // Next spawn is the next multiple of RUNE_INTERVAL_TICKS from now. At an exact
  // multiple (incl. tick 0) the next spawn is a full interval away — not 0.
  const sinceLast = currentTick % RUNE_INTERVAL_TICKS
  const nextIn = sinceLast === 0 ? RUNE_INTERVAL_TICKS : RUNE_INTERVAL_TICKS - sinceLast

  let label: string
  if (live.length > 0) {
    const r = live[0]!
    label = `RUNE ${r.type} @ ${shortZone(r.zone)} ${r.expiresIn}t`
  } else {
    label = `RUNE next ${nextIn}t`
  }
  return { live, nextIn, label }
}

// ── Aegis ───────────────────────────────────────────────────────────

export interface AegisReadout {
  held: boolean
  /** Aegis is dropped and waiting in the Roshan pit (not yet picked up). */
  inPit: boolean
  holderName: string | null
  expiresIn: number
  label: string
}

/**
 * The engine never sets `aegis.holderId` to a player — it clears the ground
 * aegis to `null` on pickup and gives the holder an `'aegis'` buff. So the
 * carried aegis is detected from that buff (passed in as `holder`), while a
 * non-null `aegis` object means it's sitting in the pit, available.
 */
export function formatAegis(
  aegis: { zone: string; tick: number; holderId: string | null } | null | undefined,
  holder?: { name: string; ticksRemaining: number } | null,
): AegisReadout {
  if (holder) {
    const expiresIn = Math.max(0, holder.ticksRemaining)
    return {
      held: true,
      inPit: false,
      holderName: holder.name,
      expiresIn,
      label: `AEGIS ${holder.name} ${expiresIn}t`,
    }
  }
  if (aegis) {
    return { held: false, inPit: true, holderName: null, expiresIn: 0, label: 'AEGIS in pit' }
  }
  return { held: false, inPit: false, holderName: null, expiresIn: 0, label: 'AEGIS —' }
}

// ── Vision ──────────────────────────────────────────────────────────

export interface VisionReadout {
  visible: number
  total: number
  pct: number
  wardsActive: number
  /** Ticks until the soonest ward expires, or null if no wards. */
  nextWardExpiry: number | null
}

export function visionSummary(
  visibleZoneIds: string[],
  wards: Array<{ expiryTick: number }>,
  currentTick: number,
): VisionReadout {
  const total = ZONES.length
  const visible = Math.min(visibleZoneIds.length, total)
  const pct = total > 0 ? Math.round((visible / total) * 100) : 0
  const expiries = wards.map((w) => w.expiryTick - currentTick).filter((t) => t > 0)
  return {
    visible,
    total,
    pct,
    wardsActive: expiries.length,
    nextWardExpiry: expiries.length ? Math.min(...expiries) : null,
  }
}

// ── Day / night ─────────────────────────────────────────────────────

export interface DayNightReadout {
  isNight: boolean
  label: string
  /** Short tactical meaning shown next to the timer. */
  meaning: string
}

export function dayNightReadout(timeOfDay: 'day' | 'night'): DayNightReadout {
  const isNight = timeOfDay === 'night'
  return {
    isNight,
    label: isNight ? 'NIGHT' : 'DAY',
    meaning: isNight ? 'vision reduced' : 'full vision',
  }
}

// ── Sparkline ───────────────────────────────────────────────────────

const SPARK_CHARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const

/**
 * Render a numeric series as a unicode sparkline. Scales to the series'
 * own min/max so flat series read flat. Empty/!finite input -> ''.
 */
export function sparkline(values: number[]): string {
  const clean = values.filter((v) => Number.isFinite(v))
  if (clean.length === 0) return ''
  const min = Math.min(...clean)
  const max = Math.max(...clean)
  const span = max - min
  if (span === 0) return SPARK_CHARS[0]!.repeat(clean.length)
  return clean
    .map((v) => {
      const idx = Math.round(((v - min) / span) * (SPARK_CHARS.length - 1))
      return SPARK_CHARS[idx]!
    })
    .join('')
}

// ── helpers ─────────────────────────────────────────────────────────

/** Short, human zone label: "mid-river" -> "mid-river"; trims long ids. */
export function shortZone(zoneId: string): string {
  return zoneId.replace(/-/g, ' ').replace(/\b(t1|t2|t3)\b/g, (m) => m.toUpperCase())
}
