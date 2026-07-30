import { mapRowsFor } from '~/components/game/asciiMapModel'

export type ArrowDirection = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'

/** [row, col] step for each arrow, in ASCII-map grid coordinates. */
const VEC: Record<ArrowDirection, readonly [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
}

/** Grid coordinates of every zone drawn on a map's ASCII layout. */
function zonePositions(mapId?: string): Map<string, [number, number]> {
  const pos = new Map<string, [number, number]>()
  mapRowsFor(mapId).forEach((row, r) =>
    row.forEach((id, c) => {
      if (id) pos.set(id, [r, c])
    }),
  )
  return pos
}

/**
 * Pick the adjacent zone that lies in the pressed arrow direction, resolved
 * against the same grid the player is looking at (`mapRowsFor(mapId)`).
 *
 * This used to match zone-name substrings ('rad' = up, 'audit' = down, …), which
 * agreed with the drawn map only by coincidence: over the 32 zones x 4 arrows,
 * 37 presses moved correctly, 60 silently did nothing (a Chaff hero could not
 * walk down mid — every forward neighbour is named `-rad`) and 31 moved somewhere
 * other than forward, 9 of them straight backwards.
 *
 * A candidate must lie inside a 45° cone around the pressed axis (`perp <=
 * along`), so a press can never move backwards or sideways. Among candidates,
 * straight-ahead wins before nearest: ranking by distance first would answer
 * ArrowUp from `mid-river` with the diagonal `rune-top` instead of walking the
 * lane to `mid-t1-rad`.
 *
 * Returns null when nothing lies that way — the caller reports that rather than
 * shoving the hero into an arbitrary (often wrong) zone.
 *
 * Pure, so the mapping is unit-tested independently of GameScreen's key handling.
 */
export function arrowTargetZone(
  direction: ArrowDirection,
  from: string,
  adjacent: readonly string[],
  mapId?: string,
): string | null {
  const pos = zonePositions(mapId)
  const origin = pos.get(from)
  if (!origin) return null

  const [dr, dc] = VEC[direction]
  let best: { id: string; along: number; perp: number } | null = null

  for (const id of adjacent) {
    const target = pos.get(id)
    // Zones the active layout doesn't draw are unreachable by arrow: callers pass
    // the full topology's `adjacentTo`, which on a subset map (one_lane/two_lane)
    // still lists neighbours that map has pruned.
    if (!target) continue

    const ddr = target[0] - origin[0]
    const ddc = target[1] - origin[1]
    const along = ddr * dr + ddc * dc
    const perp = Math.abs(dr !== 0 ? ddc : ddr)
    if (along <= 0 || perp > along) continue

    if (!best || perp < best.perp || (perp === best.perp && along < best.along)) {
      best = { id, along, perp }
    }
  }

  return best?.id ?? null
}
