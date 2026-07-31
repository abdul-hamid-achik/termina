/**
 * Map pathfinding shared by the server engine and the client.
 *
 * The server resolves auto-path movement (one hop per cycle toward a queued
 * destination) and the client mirrors the same reachability rule for command
 * pre-flight validation and "N ticks away" previews — both must agree, so the
 * BFS lives here. Traversal walks the global 32-zone graph; pass `hasZone` to
 * restrict it to a subset map's zones (one-lane / two-lane), where the pruned
 * `adjacentTo` sets are exactly the global edges between the subset's zones.
 */
import { ZONE_MAP } from './constants/zones'

/** BFS shortest path from `from` to `to`, including both endpoints. Empty when unreachable. */
export function findPath(from: string, to: string, hasZone?: (id: string) => boolean): string[] {
  if (from === to) return [from]
  if (!ZONE_MAP[from] || !ZONE_MAP[to]) return []
  if (hasZone && (!hasZone(from) || !hasZone(to))) return []

  const visited = new Set<string>([from])
  const parent = new Map<string, string>()
  const queue: string[] = [from]

  while (queue.length > 0) {
    const current = queue.shift()!
    const zone = ZONE_MAP[current]
    if (!zone) continue

    for (const neighbor of zone.adjacentTo) {
      if (visited.has(neighbor)) continue
      if (hasZone && !hasZone(neighbor)) continue
      visited.add(neighbor)
      parent.set(neighbor, current)

      if (neighbor === to) {
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

  return []
}

/** Shortest path length in cycles/edges, or -1 when unreachable. */
export function pathDistance(from: string, to: string, hasZone?: (id: string) => boolean): number {
  const path = findPath(from, to, hasZone)
  return path.length > 0 ? path.length - 1 : -1
}
