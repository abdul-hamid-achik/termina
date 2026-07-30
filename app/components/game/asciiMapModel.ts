import type { AncientState } from '~~/shared/types/game'
import { ZONE_MAP } from '~~/shared/constants/zones'
import { findPath } from '~~/shared/pathfinding'

/** Per-zone display payload computed by GameScreen and rendered by AsciiMap. */
export interface ZoneDisplay {
  id: string
  name: string
  playerHere: boolean
  allies: string[]
  enemyCount: number
  ice?: {
    team: 'chaff' | 'audit'
    alive: boolean
    tier: number
    hp?: number
    maxHp?: number
  }
  fogged: boolean
  creepCount?: number
  creepTypes?: string[]
  neutralCount?: number
  /** Names of visible enemy heroes in the zone (shown on compact cards). */
  enemyNames?: string[]
  /** Own-team wards giving vision in this zone (spatial vision-coverage cue). */
  wardCount?: number
  /** Type of a currently-live rune in this zone (e.g. 'haste'), if any. */
  runeType?: string
  /** Roshan state, set only on the pit zone: up (killable) or dead + respawn. */
  roshan?: { alive: boolean; respawnIn: number }
}

export interface AncientsDisplay {
  chaff: AncientState
  audit: AncientState
}

/** Indicator chip rendered on the compact (mobile) zone cards. */
interface CompactIndicator {
  text: string
  cls: string
}

/** Static 5-column row layout of the map (also drives the mini overview). */
export const MAP_ROWS: (string | null)[][] = [
  [null, 'chaff-fountain', null, 'chaff-base', null],
  ['top-t3-chaff', null, 'mid-t3-chaff', null, 'bot-t3-chaff'],
  ['top-t2-chaff', 'silt-chaff-top', 'mid-t2-chaff', 'silt-chaff-bot', 'bot-t2-chaff'],
  ['top-t1-chaff', null, 'mid-t1-chaff', null, 'bot-t1-chaff'],
  ['top-river', 'cache-top', 'hollow', 'cache-bot', 'bot-river'],
  [null, null, 'mid-river', null, null],
  ['top-t1-audit', null, 'mid-t1-audit', null, 'bot-t1-audit'],
  ['top-t2-audit', 'silt-audit-top', 'mid-t2-audit', 'silt-audit-bot', 'bot-t2-audit'],
  ['top-t3-audit', null, 'mid-t3-audit', null, 'bot-t3-audit'],
  [null, 'audit-base', null, 'audit-fountain', null],
]

const COL_HEADERS = ['SEAWALL', 'CHAFF SILT', 'COLDSTORE', 'AUDIT SILT', 'SHALLOWS']

/** One-lane map layout — a single mid-lane column (chaff fountain at top, audit
 *  at the bottom). Mirrors shared/constants/maps `ONE_LANE_ZONES`. */
export const ONE_LANE_MAP_ROWS: (string | null)[][] = [
  ['chaff-fountain'],
  ['chaff-base'],
  ['mid-t3-chaff'],
  ['mid-t2-chaff'],
  ['mid-t1-chaff'],
  ['mid-river'],
  ['mid-t1-audit'],
  ['mid-t2-audit'],
  ['mid-t3-audit'],
  ['audit-base'],
  ['audit-fountain'],
]
const ONE_LANE_COL_HEADERS = ['COLDSTORE']

/** Two-lane map layout — top + mid lanes with top-side jungle, top rune, and
 *  Roshan pit. Mirrors shared/constants/maps `TWO_LANE_ZONES` (3v3 map). */
export const TWO_LANE_MAP_ROWS: (string | null)[][] = [
  [null, null, 'chaff-fountain', null],
  [null, null, 'chaff-base', null],
  ['top-t3-chaff', null, 'mid-t3-chaff', null],
  ['top-t2-chaff', 'silt-chaff-top', 'mid-t2-chaff', null],
  ['top-t1-chaff', null, 'mid-t1-chaff', null],
  ['top-river', 'cache-top', 'mid-river', 'hollow'],
  ['top-t1-audit', null, 'mid-t1-audit', null],
  ['top-t2-audit', null, 'mid-t2-audit', 'silt-audit-top'],
  ['top-t3-audit', null, 'mid-t3-audit', null],
  [null, null, 'audit-base', null],
  [null, null, 'audit-fountain', null],
]
const TWO_LANE_COL_HEADERS = ['SEAWALL', 'CHAFF SILT', 'COLDSTORE', 'AUDIT SILT']

/** Pick the grid layout + column headers for a game's map (full 5v5 by default). */
export function mapRowsFor(mapId?: string): (string | null)[][] {
  if (mapId === 'one_lane') return ONE_LANE_MAP_ROWS
  if (mapId === 'two_lane') return TWO_LANE_MAP_ROWS
  return MAP_ROWS
}
export function colHeadersFor(mapId?: string): string[] {
  if (mapId === 'one_lane') return ONE_LANE_COL_HEADERS
  if (mapId === 'two_lane') return TWO_LANE_COL_HEADERS
  return COL_HEADERS
}

/** Short column headers for the compact mini overview, derived from the active
 *  map's full headers so every layout (5v5 / two_lane / one_lane) stays aligned:
 *  'SEAWALL' → 'SEA', 'CHAFF SILT'/'AUDIT SILT' → 'SILT', 'COLDSTORE' → 'COLD',
 *  'SHALLOWS' → 'SHA'. */
export function shortColHeadersFor(mapId?: string): string[] {
  return colHeadersFor(mapId).map((h) => {
    const u = h.toUpperCase()
    if (u.includes('SILT')) return 'SILT'
    if (u === 'COLDSTORE') return 'COLD'
    if (u === 'SEAWALL') return 'SEA'
    if (u === 'SHALLOWS') return 'SHA'
    return u.split(' ')[0]!
  })
}

/** Tailwind grid-cols class for a layout's column count. Static class strings so
 *  Tailwind's scanner emits the utilities (a dynamic `grid-cols-${n}` would not
 *  be generated). The map layouts use 1 (one-lane), 4 (two-lane) or 5 (full). */
export function gridColsClass(rows: (string | null)[][]): string {
  switch (rows[0]?.length ?? 5) {
    case 1:
      return 'grid-cols-1'
    case 2:
      return 'grid-cols-2'
    case 3:
      return 'grid-cols-3'
    case 4:
      return 'grid-cols-4'
    default:
      return 'grid-cols-5'
  }
}

/** Row indices AFTER which the desktop view draws a river-divider border —
 *  derived from the actual river rows so every layout (5v5 / two_lane / one_lane)
 *  frames its river correctly. For the 5v5 grid this reproduces the original
 *  {3, 5}. */
export function riverDividerRows(rows: (string | null)[][]): Set<number> {
  const riverIdx = rows
    .map((row, i) => (row.some((z) => z?.includes('-river')) ? i : -1))
    .filter((i) => i >= 0)
  if (riverIdx.length === 0) return new Set<number>()
  return new Set<number>([riverIdx[0]! - 1, riverIdx[riverIdx.length - 1]!])
}

/** Row after which the compact overview draws its single river divider (the
 *  first river row). Reproduces the original ri===4 for the 5v5 grid. */
export function compactRiverDividerRow(rows: (string | null)[][]): number {
  const idx = rows.findIndex((row) => row.some((z) => z?.includes('-river')))
  return idx >= 0 ? idx : 4
}

/** Territory owner of a zone (drives color-coding in the mini overview). */
export function zoneTeam(zoneId: string): 'chaff' | 'audit' | 'neutral' {
  return ZONE_MAP[zoneId]?.team ?? 'neutral'
}

/** 2-3 char zone code for the mini overview grid. */
export function zoneShortCode(zoneId: string): string {
  if (zoneId === 'chaff-fountain') return 'RF'
  if (zoneId === 'chaff-base') return 'RB'
  if (zoneId === 'audit-fountain') return 'DF'
  if (zoneId === 'audit-base') return 'DB'
  if (zoneId === 'hollow') return 'HLW'
  if (zoneId.startsWith('cache-')) return 'RN'
  if (zoneId.startsWith('silt-')) return 'JG'
  const lane = /^(top|mid|bot)-(t[123]|river)/.exec(zoneId)
  if (lane) {
    const laneChar = lane[1]!.charAt(0).toUpperCase()
    return lane[2] === 'river' ? `${laneChar}R` : `${laneChar}${lane[2]!.charAt(1)}`
  }
  return zoneId.slice(0, 3).toUpperCase()
}

/** Per-cell model for the compact mini-overview grid: the ►-prefixed short code,
 *  an optional team-colored ice-state glyph, trailing markers (razed mainframe,
 *  enemy presence), and the cell's classes. Pure — unit-testable without a mount. */
export interface MiniOverviewCell {
  /** Zone short code, ►-prefixed when the player is here. */
  code: string
  /** Ice-state glyph (▲ standing / ✗ razed) + its color class, if the zone has a ice. */
  ice: { glyph: string; cls: string } | null
  /** Trailing markers: '◈✗' razed mainframe, '!' enemies present. */
  marks: string
  /** Classes for the whole cell (territory color, player highlight, fog). */
  classes: string[]
}

export function miniOverviewCell(
  zoneId: string,
  zone: ZoneDisplay | undefined,
  ancient?: AncientState | null,
): MiniOverviewCell {
  const code = (zone?.playerHere ? '►' : '') + zoneShortCode(zoneId)

  // ICE are global info (like the desktop grid's ✓/✗) — shown through fog too.
  let ice: MiniOverviewCell['ice'] = null
  if (zone?.ice) {
    ice = zone.ice.alive
      ? { glyph: '▲', cls: zone.ice.team === 'chaff' ? 'text-chaff' : 'text-audit' }
      : { glyph: '✗', cls: 'text-text-dim' }
  }

  let marks = ''
  if (ancient && !ancient.alive) marks += '◈✗'
  if (zone && zone.enemyCount > 0) marks += '!'

  const team = zoneTeam(zoneId)
  const classes: string[] = [
    team === 'chaff' ? 'text-chaff' : team === 'audit' ? 'text-audit' : 'text-text-dim',
  ]
  if (zone?.playerHere) {
    classes.push('bg-self/30', 'font-bold')
  } else {
    classes.push('bg-bg-primary/60')
  }
  if (zone?.fogged) classes.push('opacity-40')

  return { code, ice, marks, classes }
}

/** The Ancient that lives in a given zone (base zones only). */
export function ancientForZone(
  zoneId: string,
  ancients: AncientsDisplay | null | undefined,
): AncientState | null {
  if (!ancients) return null
  if (zoneId === 'chaff-base') return ancients.chaff
  if (zoneId === 'audit-base') return ancients.audit
  return null
}

/**
 * Short HP readout for the Mainframe: '83%' while alive, '✗' once destroyed
 * (callers prepend the ◈ glyph → '◈✗'). Destroyed is ✗, NOT ☠ — ☠ is
 * reserved for the Roshan pit (see MapLegend), which previously collided.
 */
export function ancientLabel(ancient: AncientState | null | undefined): string | null {
  if (!ancient) return null
  if (!ancient.alive) return '✗'
  const pct = ancient.maxHp > 0 ? Math.round((ancient.hp / ancient.maxHp) * 100) : 0
  return `${pct}%`
}

/**
 * The Mainframe readout a map surface shows: the HP percentage prefixed by
 * whether the core can actually be attacked yet ('LOCKED' until one of that
 * team's T3 ice falls). Whether the core is exposed decides whether a push
 * can end the match, and it was previously carried only by a CSS pulse in the
 * top bar — nothing named the state.
 */
export function ancientStatusLabel(ancient: AncientState | null | undefined): string | null {
  const hp = ancientLabel(ancient)
  if (!ancient || hp === null) return null
  if (!ancient.alive) return hp
  return `${ancient.vulnerable ? 'EXPOSED' : 'LOCKED'} ${hp}`
}

/**
 * Ice state as three HP pips — '▲▲▲' full, '▲··' nearly down, '✗' razed.
 * ICE reach every client unfiltered (VisionCalculator), so this is the one
 * objective readout a player always has; a bare ✓ said "standing" but never
 * "one push from falling", which is the whole decision.
 */
export function icePips(ice: NonNullable<ZoneDisplay['ice']>): string {
  if (!ice.alive) return '✗'
  const { hp, maxHp } = ice
  if (hp == null || maxHp == null || maxHp <= 0) return '▲▲▲'
  const pips = Math.min(3, Math.max(1, Math.ceil((hp / maxHp) * 3)))
  return '▲'.repeat(pips) + '·'.repeat(3 - pips)
}

/**
 * Adjacent-zone cards for the compact (mobile) map, in topology order.
 * Zones missing from the display list are skipped.
 */
export function buildAdjacentZones(playerZone: string, zones: ZoneDisplay[]): ZoneDisplay[] {
  const zone = ZONE_MAP[playerZone]
  if (!zone) return []
  const byId = new Map(zones.map((z) => [z.id, z]))
  return zone.adjacentTo.flatMap((id) => {
    const display = byId.get(id)
    return display ? [display] : []
  })
}

/**
 * Per-zone markers for a queued auto-path walk: the destination carries ⌖ and
 * every zone before it its 1-based hop number. An order to a zone four hops
 * away used to leave no trace on the board at all — the only evidence the hero
 * was walking was a log line that scrolled away.
 *
 * `hasZone` restricts the BFS to the game's own zone set, mirroring the
 * server's route exactly (resolveMovementPhase paths over `zones`, not vision).
 */
export function buildRouteMarkers(
  from: string,
  to: string | null | undefined,
  hasZone?: (id: string) => boolean,
): Map<string, string> {
  const markers = new Map<string, string>()
  if (!from || !to || from === to) return markers
  const path = findPath(from, to, hasZone)
  for (let i = 1; i < path.length; i++) {
    markers.set(path[i]!, i === path.length - 1 ? '⌖' : String(i))
  }
  return markers
}

/** The side glyph pair for a zone record: RAD on top (▲), AUDIT below (▼). */
function zoneSideGlyph(
  team: 'chaff' | 'audit' | 'neutral',
): { side: string; arrow: string } | null {
  if (team === 'chaff') return { side: 'RAD', arrow: '▲' }
  if (team === 'audit') return { side: 'AUDIT', arrow: '▼' }
  return null
}

/**
 * Label for a zone from its RECORD fields only — type/team/tier — never from
 * id substrings. Exported for the rename-guard regression test: a zone whose
 * id is nonsense must still label correctly when its record fields are right.
 */
export function zoneRecordLabel(z: {
  id: string
  type: string
  team: 'chaff' | 'audit' | 'neutral'
  ice?: boolean
  tier?: number
}): string {
  const g = zoneSideGlyph(z.team)
  if (z.type === 'fountain' || z.type === 'base') return `★ ${g?.side ?? '???'}`
  if (z.ice && z.tier !== undefined) {
    // The tier-3 layer is BLACK ICE — the one the lexicon names separately.
    const label = z.tier === 3 ? 'BLACK ICE' : `ICE T${z.tier}`
    return `${g?.arrow ?? '▼'} ${g?.side ?? '???'} ${label}`
  }
  // Objective/run spots outrank their zone type — rune spots are typed 'river'
  // in the data but must never render as the crossing.
  if (z.id === 'hollow') return '☠ HOLLOW'
  if (z.id.startsWith('cache-')) return '◆ CACHE'
  if (z.type === 'river') return '≈ RIVER ≈'
  if (z.type === 'jungle') return '☘ SILT'
  return z.id.slice(0, 8).toUpperCase()
}

/** Dense single-line cell text for the desktop 5x10 grid. */
export function cellText(zone: ZoneDisplay, ancient?: AncientState | null): string {
  // Labels come from the zone RECORD (type/team/tier), never from id
  // substrings — a renamed id must not change what renders (the old
  // includes('chaff') ladder fell through to AUDIT for every zone).
  const z = ZONE_MAP[zone.id]
  const name = z ? zoneRecordLabel(z) : zone.id.slice(0, 8).toUpperCase()

  // Ancients and ice are global info (the server sends both unfiltered), so
  // they are built BEFORE the fog return — this grid used to be the only one of
  // the three renderers that dropped the ice the moment a zone went dark,
  // hiding exactly the objective a player is deciding whether to push.
  const indicators: string[] = []

  const aLabel = ancientStatusLabel(ancient)
  if (aLabel) {
    indicators.push(`◈${aLabel}`)
  }

  if (zone.ice) {
    indicators.push(icePips(zone.ice))
  }

  if (zone.fogged) return [name, ...indicators, '?'].join(' ')

  if (zone.playerHere) {
    indicators.push('►YOU')
  }

  if (zone.allies.length > 0) {
    indicators.push(`+${zone.allies.length}A`)
  }

  if (zone.enemyCount > 0) {
    // Name the threats when few enough to fit the dense cell — "who is here"
    // beats "how many" (parity with the mobile compactIndicators). Fall back to
    // a count for larger groups so the single-line cell doesn't overflow.
    const names = zone.enemyNames ?? []
    if (names.length > 0 && names.length <= 2) {
      indicators.push(`!${names.join(',')}`)
    } else {
      indicators.push(`!${zone.enemyCount}E`)
    }
  }

  if (zone.creepCount && zone.creepCount > 0) {
    indicators.push(`c${zone.creepCount}`)
  }

  if (zone.neutralCount && zone.neutralCount > 0) {
    indicators.push(`☘ ${zone.neutralCount}`)
  }

  if (zone.wardCount && zone.wardCount > 0) {
    indicators.push('◉')
  }

  if (zone.runeType) {
    indicators.push(`✦${zone.runeType}`)
  }

  if (zone.roshan) {
    indicators.push(zone.roshan.alive ? 'UP' : `↻${zone.roshan.respawnIn}c`)
  }

  return indicators.length > 0 ? `${name} ${indicators.join(' ')}` : name
}

/** Screen-reader label for a zone cell/card. */
export function zoneAriaLabel(zone: ZoneDisplay, ancient?: AncientState | null): string {
  const parts: string[] = [zone.name]

  if (zone.playerHere) parts.push('you are here')
  if (zone.allies.length > 0) parts.push(`${zone.allies.length} allies`)
  if (zone.enemyCount > 0) parts.push(`${zone.enemyCount} enemies`)
  if (zone.wardCount && zone.wardCount > 0) parts.push('warded')
  if (zone.runeType) parts.push(`${zone.runeType} rune available`)
  if (zone.roshan) {
    parts.push(zone.roshan.alive ? 'Roshan alive' : `Roshan respawns in ${zone.roshan.respawnIn}c`)
  }
  if (ancient) {
    parts.push(
      ancient.alive
        ? `ancient ${ancient.vulnerable ? 'exposed' : 'locked'} at ${ancientLabel(ancient)}`
        : 'ancient destroyed',
    )
  }
  if (zone.ice) {
    parts.push(
      zone.ice.alive
        ? `tier ${zone.ice.tier} ice standing${
            zone.ice.hp != null && zone.ice.maxHp != null
              ? ` at ${Math.round((zone.ice.hp / zone.ice.maxHp) * 100)} percent`
              : ''
          }`
        : `tier ${zone.ice.tier} ice destroyed`,
    )
  }
  if (zone.fogged) parts.push('fogged')

  return parts.join(', ')
}

/** Readable indicator chips for the compact (mobile) zone cards. */
export function compactIndicators(
  zone: ZoneDisplay,
  ancient?: AncientState | null,
): CompactIndicator[] {
  const out: CompactIndicator[] = []

  // ICE and Ancients are global info — shown even through fog.
  if (zone.ice) {
    if (zone.ice.alive) {
      const hp =
        zone.ice.hp != null && zone.ice.maxHp != null ? ` ${zone.ice.hp}/${zone.ice.maxHp}` : ''
      out.push({
        text: `${zone.ice.team === 'chaff' ? '▲' : '▼'} T${zone.ice.tier}${hp}`,
        cls: zone.ice.team === 'chaff' ? 'text-chaff' : 'text-audit',
      })
    } else {
      out.push({ text: `✗ T${zone.ice.tier} down`, cls: 'text-text-dim' })
    }
  }

  const aLabel = ancientStatusLabel(ancient)
  if (ancient && aLabel) {
    out.push({
      text: `◈ CORE ${aLabel}`,
      cls: ancient.team === 'chaff' ? 'text-chaff' : 'text-audit',
    })
  }

  if (zone.fogged) {
    out.push({ text: '? no vision', cls: 'text-text-dim' })
    return out
  }

  if (zone.allies.length > 0) {
    out.push({
      text: `+${zone.allies.length} ${zone.allies.length === 1 ? 'ally' : 'allies'}`,
      cls: 'text-chaff',
    })
  }

  if (zone.enemyNames && zone.enemyNames.length > 0) {
    // Name the threats when we have them — "who is here" beats "how many".
    out.push({ text: `! ${zone.enemyNames.join(', ')}`, cls: 'text-audit' })
  } else if (zone.enemyCount > 0) {
    out.push({
      text: `!${zone.enemyCount} ${zone.enemyCount === 1 ? 'enemy' : 'enemies'}`,
      cls: 'text-audit',
    })
  }

  if (zone.creepCount && zone.creepCount > 0) {
    out.push({
      text: `${zone.creepCount} ${zone.creepCount === 1 ? 'creep' : 'creeps'}`,
      cls: 'text-text-dim',
    })
  }

  if (zone.neutralCount && zone.neutralCount > 0) {
    out.push({
      text: `☘ ${zone.neutralCount} ${zone.neutralCount === 1 ? 'neutral' : 'neutrals'}`,
      cls: 'text-text-dim',
    })
  }

  if (zone.wardCount && zone.wardCount > 0) {
    out.push({
      text: zone.wardCount === 1 ? '◉ warded' : `◉ ${zone.wardCount} wards`,
      cls: 'text-ability',
    })
  }

  if (zone.runeType) {
    out.push({ text: `✦ ${zone.runeType} rune`, cls: 'text-gold' })
  }

  if (zone.roshan) {
    out.push(
      zone.roshan.alive
        ? { text: '☠ Roshan UP', cls: 'text-warn' }
        : { text: `☠ Roshan ↻ ${zone.roshan.respawnIn}c`, cls: 'text-text-dim' },
    )
  }

  if (out.length === 0) {
    out.push({ text: 'clear', cls: 'text-text-dim' })
  }

  return out
}
