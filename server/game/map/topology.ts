import type { Zone, ZoneType } from '~~/shared/types/map'
import type { TeamId } from '~~/shared/types/game'
import { ZONES, ZONE_MAP } from '~~/shared/constants/zones'

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

/** BFS shortest path from `from` to `to`. Returns the zone IDs including both endpoints. */
export function findPath(from: string, to: string): string[] {
  if (from === to) return [from]
  if (!ZONE_MAP[from] || !ZONE_MAP[to]) return []

  const visited = new Set<string>([from])
  const parent = new Map<string, string>()
  const queue: string[] = [from]

  while (queue.length > 0) {
    const current = queue.shift()!
    const zone = ZONE_MAP[current]
    if (!zone) continue

    for (const neighbor of zone.adjacentTo) {
      if (visited.has(neighbor)) continue
      visited.add(neighbor)
      parent.set(neighbor, current)

      if (neighbor === to) {
        // Reconstruct path
        const path: string[] = [to]
        let node = to
        while (node !== from) {
          node = parent.get(node)!
          path.unshift(node)
        }
        return path
      }

      queue.push(neighbor)
    }
  }

  return [] // no path found
}

/** Shortest path length (number of edges) between two zones. Returns -1 if unreachable. */
export function getDistance(from: string, to: string): number {
  const path = findPath(from, to)
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
