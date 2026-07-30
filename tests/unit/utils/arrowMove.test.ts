import { describe, it, expect } from 'vitest'
import { arrowTargetZone } from '~~/app/utils/arrowMove'
import { ZONE_MAP } from '~~/shared/constants/zones'

const adj = (zone: string): string[] => ZONE_MAP[zone]!.adjacentTo

describe('arrowMove — the 1D trace', () => {
  it('ArrowUp is one hop FORWARD along your route (toward the enemy base)', () => {
    // chaff mid: mid-t3-chaff (hop 0) → mid-t2-chaff (hop 1)
    expect(arrowTargetZone('ArrowUp', 'mid-t3-chaff', adj('mid-t3-chaff'), 'chaff')).toBe(
      'mid-t2-chaff',
    )
    // across the river: mid-t1-chaff (hop 2) → mid-river (hop 3)
    expect(arrowTargetZone('ArrowUp', 'mid-t1-chaff', adj('mid-t1-chaff'), 'chaff')).toBe(
      'mid-river',
    )
  })

  it('ArrowDown is one hop BACK along your route (toward your own base)', () => {
    expect(arrowTargetZone('ArrowDown', 'mid-t2-chaff', adj('mid-t2-chaff'), 'chaff')).toBe(
      'mid-t3-chaff',
    )
    expect(arrowTargetZone('ArrowDown', 'mid-river', adj('mid-river'), 'chaff')).toBe(
      'mid-t1-chaff',
    )
  })

  it('stops at the route ends instead of inventing a hop', () => {
    // hop 0 has no hop -1; the enemy base has no hop +1.
    expect(arrowTargetZone('ArrowDown', 'mid-t3-chaff', adj('mid-t3-chaff'), 'chaff')).toBeNull()
    expect(arrowTargetZone('ArrowUp', 'audit-base', adj('audit-base'), 'chaff')).toBeNull()
  })

  it('left/right refuses a lateral hop the topology does not bridge', () => {
    // Rivers do NOT touch each other in this topology (they meet at the cache
    // spots, not directly) — a lateral press from mid-river has no legal
    // target and must say so rather than teleport.
    expect(arrowTargetZone('ArrowLeft', 'mid-river', adj('mid-river'), 'chaff')).toBeNull()
    expect(arrowTargetZone('ArrowRight', 'mid-river', adj('mid-river'), 'chaff')).toBeNull()
  })

  it('lateral moves DO work where the topology bridges routes (the cache spots)', () => {
    // cache-top bridges top-river and mid-river — it is hop 3-adjacent and the
    // topology makes it adjacent to both.
    const cacheTop = ZONE_MAP['cache-top']!
    expect(cacheTop.adjacentTo).toContain('top-river')
    expect(cacheTop.adjacentTo).toContain('mid-river')
  })

  it('clamps the lateral switch at the route edges', () => {
    expect(arrowTargetZone('ArrowLeft', 'top-river', adj('top-river'), 'chaff')).toBeNull()
    expect(arrowTargetZone('ArrowRight', 'bot-river', adj('bot-river'), 'chaff')).toBeNull()
  })

  it('returns null off-route (Silt, Hollow, bases, fountains)', () => {
    expect(arrowTargetZone('ArrowUp', 'silt-chaff-top', adj('silt-chaff-top'), 'chaff')).toBeNull()
    expect(arrowTargetZone('ArrowUp', 'hollow', adj('hollow'), 'chaff')).toBeNull()
  })

  it('never returns a zone the topology does not make adjacent', () => {
    // A lateral hop at a tower tier is NOT adjacent (top-t1-chaff does not
    // touch mid-t1-chaff) — the util must refuse rather than teleport.
    expect(arrowTargetZone('ArrowLeft', 'mid-t1-chaff', adj('mid-t1-chaff'), 'chaff')).toBeNull()
  })
})
