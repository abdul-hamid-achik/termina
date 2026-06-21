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

/**
 * Two-lane map — top + mid lanes (no bot), for quick 3v3. Like one_lane it is a
 * strict, SELF-CONTAINED subgraph: same zone IDs as the full map, but each
 * zone's `adjacentTo` is pruned to only these (bases drop their bot-t3 edge,
 * mid-t2 drops its bot-jungle edge, mid-river drops rune-bot, etc.). Keeps the
 * top-side river objectives (rune-top + roshan-pit) so a 3v3 still has runes and
 * Roshan; rune-bot is dropped because it only reaches the removed bot lane.
 */
const TWO_LANE_IDS = new Set<string>([
  // Bases + fountains
  'radiant-base',
  'radiant-fountain',
  'dire-base',
  'dire-fountain',
  // Top lane (radiant → dire)
  'top-t3-rad',
  'top-t2-rad',
  'top-t1-rad',
  'top-river',
  'top-t1-dire',
  'top-t2-dire',
  'top-t3-dire',
  // Mid lane (radiant → dire)
  'mid-t3-rad',
  'mid-t2-rad',
  'mid-t1-rad',
  'mid-river',
  'mid-t1-dire',
  'mid-t2-dire',
  'mid-t3-dire',
  // Top-side jungles (serve both surviving lanes)
  'jungle-rad-top',
  'jungle-dire-top',
  // Top-side river objectives
  'rune-top',
  'roshan-pit',
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
