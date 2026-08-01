import type { Zone } from '../types/map'
import { ZONES } from './zones'

/**
 * Selectable maps. A game stamps its `mapId` and the engine initializes zones +
 * ice from the resolved zone set, so a smaller map "just works" as long as it
 * reuses the full map's zone IDs (ice tier / lane / wave-route derivation all
 * key off the ID strings).
 */

/**
 * One-lane map — the mid lane only, for tutorials and fast games. It is a strict,
 * SELF-CONTAINED subgraph of the full 5v5 graph: same 11 zone IDs, but each
 * zone's `adjacentTo` is pruned to only these 11 (so e.g. coldstore-cross no longer
 * links to the caches, and the bases no longer link to top/bot). Movement is
 * additionally gated on a game's actual zone set (see validateAction) because
 * the global ZONE_MAP still carries the full edges.
 */
const ONE_LANE_IDS = new Set<string>([
  'rookery-terminal',
  'rookery-anchor',
  'coldstore-t3-chaff',
  'coldstore-t2-chaff',
  'coldstore-t1-chaff',
  'coldstore-cross',
  'coldstore-t1-audit',
  'coldstore-t2-audit',
  'coldstore-t3-audit',
  'landing-terminal',
  'landing-anchor',
])

export const ONE_LANE_ZONES: readonly Zone[] = ZONES.filter((z) => ONE_LANE_IDS.has(z.id)).map(
  (z) => ({ ...z, adjacentTo: z.adjacentTo.filter((id) => ONE_LANE_IDS.has(id)) }),
)

/**
 * Two-lane map — top + mid lanes (no bot), for quick 3v3. Like one_lane it is a
 * strict, SELF-CONTAINED subgraph: same zone IDs as the full map, but each
 * zone's `adjacentTo` is pruned to only these (bases drop their bot-t3 edge,
 * mid-t2 drops its bot-silt edge, coldstore-cross drops cache-shallows, etc.). Keeps the
 * top-side river objectives (cache-seawall + hollow) so a 3v3 still has caches and
 * Tenant; cache-shallows is dropped because it only reaches the removed bot lane.
 */
const TWO_LANE_IDS = new Set<string>([
  // Bases + fountains
  'rookery-terminal',
  'rookery-anchor',
  'landing-terminal',
  'landing-anchor',
  // Top lane (chaff → audit)
  'seawall-t3-chaff',
  'seawall-t2-chaff',
  'seawall-t1-chaff',
  'seawall-cross',
  'seawall-t1-audit',
  'seawall-t2-audit',
  'seawall-t3-audit',
  // Mid lane (chaff → audit)
  'coldstore-t3-chaff',
  'coldstore-t2-chaff',
  'coldstore-t1-chaff',
  'coldstore-cross',
  'coldstore-t1-audit',
  'coldstore-t2-audit',
  'coldstore-t3-audit',
  // Top-side silts (serve both surviving lanes)
  'silt-chaff-upper',
  'silt-audit-upper',
  // Top-side river objectives
  'cache-seawall',
  'hollow',
])

export const TWO_LANE_ZONES: readonly Zone[] = ZONES.filter((z) => TWO_LANE_IDS.has(z.id)).map(
  (z) => ({ ...z, adjacentTo: z.adjacentTo.filter((id) => TWO_LANE_IDS.has(id)) }),
)

export const DEFAULT_MAP_ID = 'default_5v5'
export const ONE_LANE_MAP_ID = 'one_lane'
export const TWO_LANE_MAP_ID = 'two_lane'

export const MAPS: Record<string, readonly Zone[]> = {
  [DEFAULT_MAP_ID]: ZONES,
  [ONE_LANE_MAP_ID]: ONE_LANE_ZONES,
  [TWO_LANE_MAP_ID]: TWO_LANE_ZONES,
}

/** Resolve a map's zone set, falling back to the full 5v5 map for unknown ids. */
export function zonesForMap(mapId: string | undefined): readonly Zone[] {
  return MAPS[mapId ?? DEFAULT_MAP_ID] ?? ZONES
}

/**
 * Pick the map for a matchmaking queue mode. 5v5 uses the full 3-lane map,
 * 3v3 uses the two-lane map (top + mid), and 1v1 uses the single mid-lane map.
 * Exported so both the lobby (stamps `mode` onto the game_ready payload) and
 * game-server (resolves `mapId` for createGame / forceLane) share one source of
 * truth — a mode with no explicit map falls back to the full map.
 */
export function mapIdForMode(mode: string | undefined): string {
  if (mode === 'quick_3v3') return TWO_LANE_MAP_ID
  if (mode === '1v1') return ONE_LANE_MAP_ID
  return DEFAULT_MAP_ID
}
