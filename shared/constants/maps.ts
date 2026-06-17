import type { Zone } from '../types/map'
import { ZONES } from './zones'

/**
 * Selectable maps. A game stamps its `mapId` and the engine initializes zones +
 * towers from the resolved zone set, so a smaller map "just works" as long as it
 * reuses the full map's zone IDs (tower tier / lane / creep-route derivation all
 * key off the ID strings).
 */

/**
 * One-lane map — the mid lane only, for tutorials and fast games. It is a strict,
 * SELF-CONTAINED subgraph of the full 5v5 graph: same 11 zone IDs, but each
 * zone's `adjacentTo` is pruned to only these 11 (so e.g. mid-river no longer
 * links to the runes, and the bases no longer link to top/bot). Movement is
 * additionally gated on a game's actual zone set (see validateAction) because
 * the global ZONE_MAP still carries the full edges.
 */
const ONE_LANE_IDS = new Set<string>([
  'radiant-base',
  'radiant-fountain',
  'mid-t3-rad',
  'mid-t2-rad',
  'mid-t1-rad',
  'mid-river',
  'mid-t1-dire',
  'mid-t2-dire',
  'mid-t3-dire',
  'dire-base',
  'dire-fountain',
])

export const ONE_LANE_ZONES: readonly Zone[] = ZONES.filter((z) => ONE_LANE_IDS.has(z.id)).map(
  (z) => ({ ...z, adjacentTo: z.adjacentTo.filter((id) => ONE_LANE_IDS.has(id)) }),
)

export const DEFAULT_MAP_ID = 'default_5v5'

export const MAPS: Record<string, readonly Zone[]> = {
  [DEFAULT_MAP_ID]: ZONES,
  one_lane: ONE_LANE_ZONES,
}

/** Resolve a map's zone set, falling back to the full 5v5 map for unknown ids. */
export function zonesForMap(mapId: string | undefined): readonly Zone[] {
  return MAPS[mapId ?? DEFAULT_MAP_ID] ?? ZONES
}
