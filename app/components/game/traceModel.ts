import { LANE_ROUTES_CORE } from '~~/shared/constants/lanes'
import { ZONE_MAP } from '~~/shared/constants/zones'
import type { AncientState, TeamId } from '~~/shared/types/game'

/**
 * The trace model (C1a / R3-07): your route as hop depth, one summary line
 * per other route, contacts, and both terminals. Pure — no component, no
 * substring parsing. A zone's side comes from the ZONE_MAP record, NEVER
 * from the id string (the old includes('rad') parsers inverted silently on
 * the rename; this model must have no `.includes('rad')` in it).
 */

export type RouteId = 'top' | 'mid' | 'bot'

export interface TraceContact {
  id: string
  name: string
  zone: string
  zoneName: string
  hostile: boolean
}

export interface RouteLine {
  route: RouteId
  /** Display name of the route (Seawall / Coldstore / Shallows). */
  name: string
  /** Hops the player has made along THIS route (0 = not on it). */
  depth: number
  /** Total hops in the route. */
  total: number
  /** Hostile contacts visible anywhere on the route. */
  hostiles: number
  /** True when this is the player's current route. */
  active: boolean
}

export interface TerminalState {
  team: TeamId
  alive: boolean
  vulnerable: boolean
  hp: number
  maxHp: number
}

export interface TraceModel {
  /** The player's current route, or null when off all three (Silt/Hollow/base). */
  currentRoute: RouteId | null
  /** Hop index along the current route (0-based). -1 when off-route. */
  hopIndex: number
  /** One summary line per route, the player's first. */
  routes: RouteLine[]
  /** Visible hero contacts (hostile and friendly), in vision. */
  contacts: TraceContact[]
  /** Both terminals' states. */
  terminals: TerminalState[]
}

const ROUTE_IDS: RouteId[] = ['top', 'mid', 'bot']

/** Display name of a route, from its river zone's record (never the id). */
function routeName(route: RouteId, team: TeamId): string {
  const riverZone = LANE_ROUTES_CORE[route]![team]!.find((z) => ZONE_MAP[z]?.type === 'river')
  return riverZone ? (ZONE_MAP[riverZone]!.name.replace(' Crossing', '') ?? route) : route
}

/** Which route (if any) a zone belongs to for the given team. */
export function routeOfZone(zoneId: string, team: TeamId): RouteId | null {
  for (const route of ROUTE_IDS) {
    if (LANE_ROUTES_CORE[route]?.[team]?.includes(zoneId)) return route
  }
  return null
}

/** Hop index of a zone along its route (0-based), or -1 when off-route. */
export function hopIndexOf(zoneId: string, team: TeamId): number {
  const route = routeOfZone(zoneId, team)
  if (!route) return -1
  return LANE_ROUTES_CORE[route]![team]!.indexOf(zoneId)
}

export function buildTrace(input: {
  playerZone: string
  playerTeam: TeamId
  contacts: Array<{
    id: string
    name: string
    zone: string
    team: TeamId
    alive: boolean
    fogged?: boolean
  }>
  ancients: Record<TeamId, AncientState>
}): TraceModel {
  const { playerZone, playerTeam, ancients } = input
  const currentRoute = routeOfZone(playerZone, playerTeam)
  const hopIndex = hopIndexOf(playerZone, playerTeam)

  const contacts: TraceContact[] = input.contacts
    .filter((c) => c.alive && !c.fogged)
    .map((c) => ({
      id: c.id,
      name: c.name,
      zone: c.zone,
      zoneName: ZONE_MAP[c.zone]?.name ?? c.zone,
      hostile: c.team !== playerTeam,
    }))

  // The player's own route first, then the other two.
  const orderedRoutes: RouteId[] = currentRoute
    ? [currentRoute, ...ROUTE_IDS.filter((r) => r !== currentRoute)]
    : ROUTE_IDS

  const routes: RouteLine[] = orderedRoutes.map((route) => {
    const path = LANE_ROUTES_CORE[route]![playerTeam]!
    const hostiles = contacts.filter((c) => c.hostile && path.includes(c.zone)).length
    return {
      route,
      name: routeName(route, playerTeam),
      depth: route === currentRoute ? hopIndex : 0,
      total: path.length,
      hostiles,
      active: route === currentRoute,
    }
  })

  const terminals: TerminalState[] = (['chaff', 'audit'] as TeamId[]).map((team) => {
    const a = ancients[team]!
    return {
      team,
      alive: a.alive,
      vulnerable: a.vulnerable,
      hp: a.hp,
      maxHp: a.maxHp,
    }
  })

  return { currentRoute, hopIndex, routes, contacts, terminals }
}

/** Per-zone display payload (was asciiMapModel's ZoneDisplay — kept because the
 *  move picker and the stories still describe zones this way). */
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
  waveCount?: number
  waveTypes?: string[]
  neutralCount?: number
  /** Names of visible enemy heroes in the zone. */
  enemyNames?: string[]
  /** Own-team wards giving vision in this zone. */
  wardCount?: number
  /** Type of a currently-live cache in this zone, if any. */
  cacheType?: string
  /** Tenant state, set only on the Hollow: up or dead + respawn. */
  tenant?: { alive: boolean; respawnIn: number }
}

/** Adjacent zone displays in topology order (was asciiMapModel's helper). */
export function buildAdjacentZones(playerZone: string, zones: ZoneDisplay[]): ZoneDisplay[] {
  const byId = new Map(zones.map((z) => [z.id, z]))
  const adjIds = ZONE_MAP[playerZone]?.adjacentTo ?? []
  return adjIds.map((id) => byId.get(id)).filter((z): z is ZoneDisplay => !!z)
}
