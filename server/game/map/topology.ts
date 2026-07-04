import type { Zone, ZoneType } from '~~/shared/types/map'
import type { TeamId } from '~~/shared/types/game'
import { ZONES, ZONE_MAP } from '~~/shared/constants/zones'
import { findPath } from '~~/shared/pathfinding'

/** Look up a zone by ID. */
export function getZone(id: string): Zone | undefined {
  return ZONE_MAP[id]
}

/** Return IDs of all zones adjacent to the given zone. */
export function getAdjacentZones(zoneId: string): string[] {
  const zone = ZONE_MAP[zoneId]
  return zone ? [...zone.adjacentTo] : []
}

/** Check whether two zones are directly adjacent. */
export function areAdjacent(a: string, b: string): boolean {
  const zone = ZONE_MAP[a]
  return zone ? zone.adjacentTo.includes(b) : false
}

/** BFS shortest path from `from` to `to`. Returns the zone IDs including both endpoints.
 *  Pass `hasZone` to restrict traversal to a subset map's zones (e.g. one-lane,
 *  two-lane). Without it, the full 32-zone global graph is used.
 *  The BFS itself lives in shared/pathfinding so the client can mirror the
 *  server's reachability rule for auto-path move validation. */
export { findPath }

/** Shortest path length (number of edges) between two zones. Returns -1 if unreachable.
 *  Pass `hasZone` to restrict traversal to a subset map's zones. */
export function getDistance(from: string, to: string, hasZone?: (id: string) => boolean): number {
  const path = findPath(from, to, hasZone)
  return path.length > 0 ? path.length - 1 : -1
}

/** Return all zones of a given type. */
export function getZonesByType(type: ZoneType): Zone[] {
  return ZONES.filter((z) => z.type === type)
}

/** Return all zones belonging to a team. */
export function getTeamZones(team: TeamId): Zone[] {
  return ZONES.filter((z) => z.team === team)
}
