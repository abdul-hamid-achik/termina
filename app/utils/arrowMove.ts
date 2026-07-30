import { LANE_ROUTES_CORE } from '~~/shared/constants/lanes'
import type { TeamId } from '~~/shared/types/game'
import { routeOfZone, hopIndexOf } from '~/components/game/traceModel'

export type ArrowDirection = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'

const ROUTE_IDS = ['top', 'mid', 'bot'] as const

/**
 * 1D arrow movement on the trace (R3-07): with a route-as-depth rail there is
 * no 2D grid to step through, so the arrows read as route operations —
 *
 *   ArrowUp    = one hop FORWARD along your route (toward the enemy base)
 *   ArrowDown  = one hop BACK along your route (toward your own base)
 *   ArrowLeft  = the same hop index on the route to the LEFT (top ← mid ← bot)
 *   ArrowRight = the same hop index on the route to the RIGHT
 *
 * Lateral moves clamp at the route edges and at the hop bounds (a river hop
 * exists on every route; a T3 hop does too — bases/fountains/Silt have no
 * lateral move and return null). Off-route zones return null — the caller
 * reports "no zone that way" rather than inventing a move.
 *
 * Pure, so the mapping is unit-tested independently of GameScreen's key handling.
 */
export function arrowTargetZone(
  direction: ArrowDirection,
  from: string,
  adjacent: readonly string[],
  team: TeamId,
): string | null {
  const route = routeOfZone(from, team)
  if (!route) return null
  const hop = hopIndexOf(from, team)
  if (hop < 0) return null
  const path = LANE_ROUTES_CORE[route]![team]!

  if (direction === 'ArrowUp' || direction === 'ArrowDown') {
    const next = direction === 'ArrowUp' ? hop + 1 : hop - 1
    if (next < 0 || next >= path.length) return null
    const target = path[next]!
    // The target must be legally adjacent (the route path is adjacency-ordered,
    // but a caller on a subset map prunes neighbours).
    return adjacent.includes(target) ? target : null
  }

  // Lateral: same hop index on the neighbouring route.
  const routeIdx = ROUTE_IDS.indexOf(route)
  const nextRouteIdx = direction === 'ArrowLeft' ? routeIdx - 1 : routeIdx + 1
  if (nextRouteIdx < 0 || nextRouteIdx >= ROUTE_IDS.length) return null
  const otherPath = LANE_ROUTES_CORE[ROUTE_IDS[nextRouteIdx]!]![team]!
  // Lateral hops exist only where BOTH routes share the same tier row —
  // rivers cross (hop 3) and same-tier towers touch (e.g. top-t1-chaff next to
  // mid-t1-chaff is NOT adjacent in this topology, so we only allow river).
  const candidate = otherPath[hop]
  if (!candidate) return null
  return adjacent.includes(candidate) ? candidate : null
}
