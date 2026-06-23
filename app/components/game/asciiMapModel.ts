import type { AncientState } from '~~/shared/types/game'
import { ZONE_MAP } from '~~/shared/constants/zones'

/** Per-zone display payload computed by GameScreen and rendered by AsciiMap. */
export interface ZoneDisplay {
  id: string
  name: string
  playerHere: boolean
  allies: string[]
  enemyCount: number
  tower?: {
    team: 'radiant' | 'dire'
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
  radiant: AncientState
  dire: AncientState
}

/** Indicator chip rendered on the compact (mobile) zone cards. */
interface CompactIndicator {
  text: string
  cls: string
}

/** Static 5-column row layout of the map (also drives the mini overview). */
export const MAP_ROWS: (string | null)[][] = [
  [null, 'radiant-fountain', null, 'radiant-base', null],
  ['top-t3-rad', null, 'mid-t3-rad', null, 'bot-t3-rad'],
  ['top-t2-rad', 'jungle-rad-top', 'mid-t2-rad', 'jungle-rad-bot', 'bot-t2-rad'],
  ['top-t1-rad', null, 'mid-t1-rad', null, 'bot-t1-rad'],
  ['top-river', 'rune-top', 'roshan-pit', 'rune-bot', 'bot-river'],
  [null, null, 'mid-river', null, null],
  ['top-t1-dire', null, 'mid-t1-dire', null, 'bot-t1-dire'],
  ['top-t2-dire', 'jungle-dire-top', 'mid-t2-dire', 'jungle-dire-bot', 'bot-t2-dire'],
  ['top-t3-dire', null, 'mid-t3-dire', null, 'bot-t3-dire'],
  [null, 'dire-base', null, 'dire-fountain', null],
]

const COL_HEADERS = ['TOP LANE', 'RADIANT JUNGLE', 'MID LANE', 'DIRE JUNGLE', 'BOT LANE']

/** One-lane map layout — a single mid-lane column (radiant fountain at top, dire
 *  at the bottom). Mirrors shared/constants/maps `ONE_LANE_ZONES`. */
export const ONE_LANE_MAP_ROWS: (string | null)[][] = [
  ['radiant-fountain'],
  ['radiant-base'],
  ['mid-t3-rad'],
  ['mid-t2-rad'],
  ['mid-t1-rad'],
  ['mid-river'],
  ['mid-t1-dire'],
  ['mid-t2-dire'],
  ['mid-t3-dire'],
  ['dire-base'],
  ['dire-fountain'],
]
const ONE_LANE_COL_HEADERS = ['MID LANE']

/** Two-lane map layout — top + mid lanes with top-side jungle, top rune, and
 *  Roshan pit. Mirrors shared/constants/maps `TWO_LANE_ZONES` (3v3 map). */
export const TWO_LANE_MAP_ROWS: (string | null)[][] = [
  [null, null, 'radiant-fountain', null],
  [null, null, 'radiant-base', null],
  ['top-t3-rad', null, 'mid-t3-rad', null],
  ['top-t2-rad', 'jungle-rad-top', 'mid-t2-rad', null],
  ['top-t1-rad', null, 'mid-t1-rad', null],
  ['top-river', 'rune-top', 'mid-river', 'roshan-pit'],
  ['top-t1-dire', null, 'mid-t1-dire', null],
  ['top-t2-dire', null, 'mid-t2-dire', 'jungle-dire-top'],
  ['top-t3-dire', null, 'mid-t3-dire', null],
  [null, null, 'dire-base', null],
  [null, null, 'dire-fountain', null],
]
const TWO_LANE_COL_HEADERS = ['TOP LANE', 'RADIANT JUNGLE', 'MID LANE', 'DIRE JUNGLE']

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
export function zoneTeam(zoneId: string): 'radiant' | 'dire' | 'neutral' {
  return ZONE_MAP[zoneId]?.team ?? 'neutral'
}

/** 2-3 char zone code for the mini overview grid. */
export function zoneShortCode(zoneId: string): string {
  if (zoneId === 'radiant-fountain') return 'RF'
  if (zoneId === 'radiant-base') return 'RB'
  if (zoneId === 'dire-fountain') return 'DF'
  if (zoneId === 'dire-base') return 'DB'
  if (zoneId === 'roshan-pit') return 'ROS'
  if (zoneId.startsWith('rune-')) return 'RN'
  if (zoneId.includes('jungle')) return 'JG'
  const lane = /^(top|mid|bot)-(t[123]|river)/.exec(zoneId)
  if (lane) {
    const laneChar = lane[1]!.charAt(0).toUpperCase()
    return lane[2] === 'river' ? `${laneChar}R` : `${laneChar}${lane[2]!.charAt(1)}`
  }
  return zoneId.slice(0, 3).toUpperCase()
}

/** The Ancient that lives in a given zone (base zones only). */
export function ancientForZone(
  zoneId: string,
  ancients: AncientsDisplay | null | undefined,
): AncientState | null {
  if (!ancients) return null
  if (zoneId === 'radiant-base') return ancients.radiant
  if (zoneId === 'dire-base') return ancients.dire
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

/** Dense single-line cell text for the desktop 5x10 grid. */
export function cellText(zone: ZoneDisplay, ancient?: AncientState | null): string {
  let name = ''
  if (zone.id.includes('fountain') || zone.id.includes('base')) {
    name = zone.id.includes('radiant') ? '★ RAD' : '★ DIRE'
  } else if (zone.id.includes('t3')) {
    name = zone.id.includes('rad') ? '▲ RAD T3' : '▼ DIRE T3'
  } else if (zone.id.includes('t2')) {
    name = zone.id.includes('rad') ? '▲ RAD T2' : '▼ DIRE T2'
  } else if (zone.id.includes('t1')) {
    name = zone.id.includes('rad') ? '▲ RAD T1' : '▼ DIRE T1'
  } else if (zone.id.includes('river') || zone.id === 'mid-river') {
    name = '≈ RIVER ≈'
  } else if (zone.id.includes('roshan')) {
    name = '☠ ROSHAN'
  } else if (zone.id.includes('rune')) {
    name = '◆ RUNE'
  } else if (zone.id.includes('jungle')) {
    name = '☘ JUNGLE'
  } else {
    name = zone.id.slice(0, 8).toUpperCase()
  }

  // Ancients are global info (like towers), so they show through fog too.
  const aLabel = ancientLabel(ancient)

  if (zone.fogged) return aLabel ? `${name} ◈${aLabel} ?` : `${name} ?`

  const indicators: string[] = []

  if (aLabel) {
    indicators.push(`◈${aLabel}`)
  }

  if (zone.tower) {
    indicators.push(zone.tower.alive ? '✓' : '✗')
  }

  if (zone.playerHere) {
    indicators.push('►YOU')
  }

  if (zone.allies.length > 0) {
    indicators.push(`+${zone.allies.length}A`)
  }

  if (zone.enemyCount > 0) {
    indicators.push(`!${zone.enemyCount}E`)
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
    indicators.push(zone.roshan.alive ? 'UP' : `↻${zone.roshan.respawnIn}t`)
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
    parts.push(zone.roshan.alive ? 'Roshan alive' : `Roshan respawns in ${zone.roshan.respawnIn}t`)
  }
  if (ancient) {
    parts.push(ancient.alive ? `ancient at ${ancientLabel(ancient)}` : 'ancient destroyed')
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

  // Towers and Ancients are global info — shown even through fog.
  if (zone.tower) {
    if (zone.tower.alive) {
      const hp =
        zone.tower.hp != null && zone.tower.maxHp != null
          ? ` ${zone.tower.hp}/${zone.tower.maxHp}`
          : ''
      out.push({
        text: `${zone.tower.team === 'radiant' ? '▲' : '▼'} T${zone.tower.tier}${hp}`,
        cls: zone.tower.team === 'radiant' ? 'text-radiant' : 'text-dire',
      })
    } else {
      out.push({ text: `✗ T${zone.tower.tier} down`, cls: 'text-text-dim' })
    }
  }

  const aLabel = ancientLabel(ancient)
  if (ancient && aLabel) {
    out.push({
      text: `◈ CORE ${aLabel}`,
      cls: ancient.team === 'radiant' ? 'text-radiant' : 'text-dire',
    })
  }

  if (zone.fogged) {
    out.push({ text: '? no vision', cls: 'text-text-dim' })
    return out
  }

  if (zone.allies.length > 0) {
    out.push({
      text: `+${zone.allies.length} ${zone.allies.length === 1 ? 'ally' : 'allies'}`,
      cls: 'text-radiant',
    })
  }

  if (zone.enemyNames && zone.enemyNames.length > 0) {
    // Name the threats when we have them — "who is here" beats "how many".
    out.push({ text: `! ${zone.enemyNames.join(', ')}`, cls: 'text-dire' })
  } else if (zone.enemyCount > 0) {
    out.push({
      text: `!${zone.enemyCount} ${zone.enemyCount === 1 ? 'enemy' : 'enemies'}`,
      cls: 'text-dire',
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
        : { text: `☠ Roshan ↻ ${zone.roshan.respawnIn}t`, cls: 'text-text-dim' },
    )
  }

  if (out.length === 0) {
    out.push({ text: 'clear', cls: 'text-text-dim' })
  }

  return out
}
