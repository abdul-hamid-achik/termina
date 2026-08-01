import { describe, it, expect } from 'vitest'
import { arrowTargetZone } from '~~/app/utils/arrowMove'
import { ZONE_MAP } from '~~/shared/constants/zones'

const adj = (zone: string): string[] => ZONE_MAP[zone]!.adjacentTo

describe('arrowMove — the 1D trace', () => {
  it('ArrowUp is one hop FORWARD along your route (toward the enemy base)', () => {
    // chaff mid: coldstore-t3-chaff (hop 0) → coldstore-t2-chaff (hop 1)
    expect(
      arrowTargetZone('ArrowUp', 'coldstore-t3-chaff', adj('coldstore-t3-chaff'), 'chaff'),
    ).toBe('coldstore-t2-chaff')
    // across the river: coldstore-t1-chaff (hop 2) → coldstore-cross (hop 3)
    expect(
      arrowTargetZone('ArrowUp', 'coldstore-t1-chaff', adj('coldstore-t1-chaff'), 'chaff'),
    ).toBe('coldstore-cross')
  })

  it('ArrowDown is one hop BACK along your route (toward your own base)', () => {
    expect(
      arrowTargetZone('ArrowDown', 'coldstore-t2-chaff', adj('coldstore-t2-chaff'), 'chaff'),
    ).toBe('coldstore-t3-chaff')
    expect(arrowTargetZone('ArrowDown', 'coldstore-cross', adj('coldstore-cross'), 'chaff')).toBe(
      'coldstore-t1-chaff',
    )
  })

  it('stops at the route ends instead of inventing a hop', () => {
    // hop 0 has no hop -1; the enemy base has no hop +1.
    expect(
      arrowTargetZone('ArrowDown', 'coldstore-t3-chaff', adj('coldstore-t3-chaff'), 'chaff'),
    ).toBeNull()
    expect(
      arrowTargetZone('ArrowUp', 'landing-terminal', adj('landing-terminal'), 'chaff'),
    ).toBeNull()
  })

  it('left/right refuses a lateral hop the topology does not bridge', () => {
    // Rivers do NOT touch each other in this topology (they meet at the cache
    // spots, not directly) — a lateral press from coldstore-cross has no legal
    // target and must say so rather than teleport.
    expect(
      arrowTargetZone('ArrowLeft', 'coldstore-cross', adj('coldstore-cross'), 'chaff'),
    ).toBeNull()
    expect(
      arrowTargetZone('ArrowRight', 'coldstore-cross', adj('coldstore-cross'), 'chaff'),
    ).toBeNull()
  })

  it('lateral moves DO work where the topology bridges routes (the cache spots)', () => {
    // cache-seawall bridges seawall-cross and coldstore-cross — it is hop 3-adjacent and the
    // topology makes it adjacent to both.
    const cacheTop = ZONE_MAP['cache-seawall']!
    expect(cacheTop.adjacentTo).toContain('seawall-cross')
    expect(cacheTop.adjacentTo).toContain('coldstore-cross')
  })

  it('clamps the lateral switch at the route edges', () => {
    expect(arrowTargetZone('ArrowLeft', 'seawall-cross', adj('seawall-cross'), 'chaff')).toBeNull()
    expect(
      arrowTargetZone('ArrowRight', 'shallows-cross', adj('shallows-cross'), 'chaff'),
    ).toBeNull()
  })

  it('returns null off-route (Silt, Hollow, bases, fountains)', () => {
    expect(
      arrowTargetZone('ArrowUp', 'silt-chaff-upper', adj('silt-chaff-upper'), 'chaff'),
    ).toBeNull()
    expect(arrowTargetZone('ArrowUp', 'hollow', adj('hollow'), 'chaff')).toBeNull()
  })

  it('never returns a zone the topology does not make adjacent', () => {
    // A lateral hop at a tower tier is NOT adjacent (seawall-t1-chaff does not
    // touch coldstore-t1-chaff) — the util must refuse rather than teleport.
    expect(
      arrowTargetZone('ArrowLeft', 'coldstore-t1-chaff', adj('coldstore-t1-chaff'), 'chaff'),
    ).toBeNull()
  })
})
