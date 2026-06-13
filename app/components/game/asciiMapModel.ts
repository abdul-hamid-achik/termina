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

export const COL_HEADERS = ['TOP LANE', 'RADIANT JUNGLE', 'MID LANE', 'DIRE JUNGLE', 'BOT LANE']

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

/** Short HP readout for an Ancient: '83%' while alive, '☠' once destroyed. */
export function ancientLabel(ancient: AncientState | null | undefined): string | null {
  if (!ancient) return null
  if (!ancient.alive) return '☠'
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

  return indicators.length > 0 ? `${name} ${indicators.join(' ')}` : name
}

/** Screen-reader label for a zone cell/card. */
export function zoneAriaLabel(zone: ZoneDisplay, ancient?: AncientState | null): string {
  const parts: string[] = [zone.name]

  if (zone.playerHere) parts.push('you are here')
  if (zone.allies.length > 0) parts.push(`${zone.allies.length} allies`)
  if (zone.enemyCount > 0) parts.push(`${zone.enemyCount} enemies`)
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

  if (out.length === 0) {
    out.push({ text: 'clear', cls: 'text-text-dim' })
  }

  return out
}
