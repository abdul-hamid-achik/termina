import { describe, it, expect } from 'vitest'
import { arrowTargetZone } from '~~/app/utils/arrowMove'
import type { ArrowDirection } from '~~/app/utils/arrowMove'
import { mapRowsFor } from '~~/app/components/game/asciiMapModel'
import { ZONES, ZONE_MAP } from '~~/shared/constants/zones'
import { ONE_LANE_ZONES, TWO_LANE_ZONES } from '~~/shared/constants/maps'
import type { Zone } from '~~/shared/types/map'

const DIRECTIONS: ArrowDirection[] = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']

// Read off the drawn grid here rather than imported from the util, so the table
// below checks arrowTargetZone against an independent reading of the map.
const STEP: Record<ArrowDirection, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
}

function positions(mapId?: string): Map<string, [number, number]> {
  const pos = new Map<string, [number, number]>()
  mapRowsFor(mapId).forEach((row, r) =>
    row.forEach((id, c) => {
      if (id) pos.set(id, [r, c])
    }),
  )
  return pos
}

interface Layout {
  label: string
  mapId: string | undefined
  zones: readonly Zone[]
}

const LAYOUTS: Layout[] = [
  { label: 'default 5v5', mapId: undefined, zones: ZONES },
  { label: 'two_lane', mapId: 'two_lane', zones: TWO_LANE_ZONES },
  { label: 'one_lane', mapId: 'one_lane', zones: ONE_LANE_ZONES },
]

/** Follow one direction from a zone until it stops resolving. */
function walk(direction: ArrowDirection, start: string, layout: Layout): string[] {
  const byId = new Map(layout.zones.map((z) => [z.id, z]))
  const path: string[] = []
  let current = start
  while (path.length < 32) {
    const next = arrowTargetZone(
      direction,
      current,
      byId.get(current)?.adjacentTo ?? [],
      layout.mapId,
    )
    if (!next) break
    path.push(next)
    current = next
  }
  return path
}

describe.each(LAYOUTS)('arrowTargetZone geometry — $label', (layout) => {
  const pos = positions(layout.mapId)

  // The whole point of the geometric rewrite: the name-substring heuristic it
  // replaced answered 31 of the full map's 128 presses with a zone that was not
  // forward (9 of them straight backwards), and this table is what catches that.
  it('answers every zone x direction with null or a zone forward along the pressed axis', () => {
    const violations: string[] = []

    for (const zone of layout.zones) {
      for (const direction of DIRECTIONS) {
        const target = arrowTargetZone(direction, zone.id, zone.adjacentTo, layout.mapId)
        if (target === null) continue

        const label = `${zone.id} ${direction} -> ${target}`
        if (!zone.adjacentTo.includes(target)) {
          violations.push(`${label} (not adjacent)`)
          continue
        }
        const from = pos.get(zone.id)
        const to = pos.get(target)
        if (!from || !to) {
          violations.push(`${label} (not on the drawn grid)`)
          continue
        }

        const [dr, dc] = STEP[direction]
        const along = (to[0] - from[0]) * dr + (to[1] - from[1]) * dc
        const perp = Math.abs(dr !== 0 ? to[1] - from[1] : to[0] - from[0])
        if (along <= 0) violations.push(`${label} (${along} forward along the axis)`)
        else if (perp > along) violations.push(`${label} (${perp} sideways vs ${along} forward)`)
      }
    }

    expect(violations).toEqual([])
  })

  it('resolves at least one direction from every zone', () => {
    const stranded = layout.zones
      .filter((z) =>
        DIRECTIONS.every((d) => arrowTargetZone(d, z.id, z.adjacentTo, layout.mapId) === null),
      )
      .map((z) => z.id)

    expect(stranded).toEqual([])
  })
})

describe('arrowTargetZone walks lanes', () => {
  it('ArrowDown carries a Chaff hero from base to the Audit base down mid', () => {
    expect(walk('ArrowDown', 'chaff-base', LAYOUTS[0]!)).toEqual([
      'mid-t3-chaff',
      'mid-t2-chaff',
      'mid-t1-chaff',
      'mid-river',
      'mid-t1-audit',
      'mid-t2-audit',
      'mid-t3-audit',
      'audit-base',
    ])
  })

  // Started from the T3 rather than the base: the grid draws each base off-centre
  // between its top and mid ice, so from `audit-base` both are exactly the same
  // diagonal step and the lane a press picks there is genuinely ambiguous.
  it('ArrowUp carries a Audit hero from their mid T3 to the Chaff base', () => {
    expect(walk('ArrowUp', 'mid-t3-audit', LAYOUTS[0]!)).toEqual([
      'mid-t2-audit',
      'mid-t1-audit',
      'mid-river',
      'mid-t1-chaff',
      'mid-t2-chaff',
      'mid-t3-chaff',
      'chaff-base',
    ])
  })

  it('walks the whole one-lane tutorial map fountain to fountain', () => {
    const oneLane = LAYOUTS[2]!
    expect(walk('ArrowDown', 'chaff-fountain', oneLane)).toEqual([
      'chaff-base',
      'mid-t3-chaff',
      'mid-t2-chaff',
      'mid-t1-chaff',
      'mid-river',
      'mid-t1-audit',
      'mid-t2-audit',
      'mid-t3-audit',
      'audit-base',
      'audit-fountain',
    ])
    expect(walk('ArrowUp', 'audit-fountain', oneLane)).toHaveLength(10)
  })
})

describe('arrowTargetZone regressions the name-substring heuristic got wrong', () => {
  const adj = (id: string) => ZONE_MAP[id]!.adjacentTo

  it('moves a Chaff hero forward down mid (every forward neighbour is named -rad)', () => {
    expect(arrowTargetZone('ArrowDown', 'mid-t3-chaff', adj('mid-t3-chaff'))).toBe('mid-t2-chaff')
    expect(arrowTargetZone('ArrowDown', 'mid-t2-chaff', adj('mid-t2-chaff'))).toBe('mid-t1-chaff')
  })

  it('moves a Audit hero toward their own base instead of backwards up the lane', () => {
    expect(arrowTargetZone('ArrowDown', 'mid-t3-audit', adj('mid-t3-audit'))).toBe('audit-base')
    expect(arrowTargetZone('ArrowDown', 'top-t2-audit', adj('top-t2-audit'))).toBe('top-t3-audit')
  })

  it('splits the two jungles a Audit mid zone touches by side, not by list order', () => {
    expect(arrowTargetZone('ArrowLeft', 'mid-t2-audit', adj('mid-t2-audit'))).toBe('silt-audit-top')
    expect(arrowTargetZone('ArrowRight', 'mid-t2-audit', adj('mid-t2-audit'))).toBe(
      'silt-audit-bot',
    )
  })

  it('gives the Roshan pit its one direction back', () => {
    expect(arrowTargetZone('ArrowLeft', 'hollow', adj('hollow'))).toBe('cache-top')
  })

  it('prefers the zone straight ahead over a nearer diagonal one', () => {
    // cache-top sits one row up and one column left of mid-river; mid-t1-chaff is
    // two rows up but dead ahead, and walking the lane is what Up means here.
    expect(arrowTargetZone('ArrowUp', 'mid-river', adj('mid-river'))).toBe('mid-t1-chaff')
    expect(arrowTargetZone('ArrowLeft', 'mid-river', adj('mid-river'))).toBe('cache-top')
  })
})

describe('arrowTargetZone declines to guess', () => {
  const adj = (id: string) => ZONE_MAP[id]!.adjacentTo

  it('returns null when nothing adjacent lies that way', () => {
    expect(arrowTargetZone('ArrowUp', 'chaff-fountain', adj('chaff-fountain'))).toBe(null)
    expect(arrowTargetZone('ArrowDown', 'hollow', adj('hollow'))).toBe(null)
    expect(arrowTargetZone('ArrowLeft', 'mid-t1-chaff', adj('mid-t1-chaff'))).toBe(null)
  })

  it('returns null for an empty adjacency list or an off-grid origin', () => {
    expect(arrowTargetZone('ArrowUp', 'mid-river', [])).toBe(null)
    // Every direction, since an origin defaulted to the grid's top-left corner
    // would still answer the downward ones.
    for (const direction of DIRECTIONS) {
      expect(arrowTargetZone(direction, 'not-a-zone', ['mid-t1-chaff', 'top-t2-audit'])).toBe(null)
    }
  })

  it('ignores neighbours the active map does not draw', () => {
    // Callers pass the full topology's adjacency; the one-lane map has no jungle.
    expect(arrowTargetZone('ArrowLeft', 'mid-t2-chaff', adj('mid-t2-chaff'), 'one_lane')).toBe(null)
    expect(arrowTargetZone('ArrowRight', 'mid-t2-chaff', adj('mid-t2-chaff'), 'one_lane')).toBe(
      null,
    )
    expect(arrowTargetZone('ArrowUp', 'mid-t2-chaff', adj('mid-t2-chaff'), 'one_lane')).toBe(
      'mid-t3-chaff',
    )
    // The two-lane map keeps the top-side jungle but drops the bot-side one.
    expect(arrowTargetZone('ArrowLeft', 'mid-t2-chaff', adj('mid-t2-chaff'), 'two_lane')).toBe(
      'silt-chaff-top',
    )
    expect(arrowTargetZone('ArrowRight', 'mid-t2-chaff', adj('mid-t2-chaff'), 'two_lane')).toBe(
      null,
    )
  })
})
