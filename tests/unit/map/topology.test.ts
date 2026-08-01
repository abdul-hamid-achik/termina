import { describe, it, expect } from 'vitest'
import {
  getZone,
  getAdjacentZones,
  areAdjacent,
  findPath,
  getDistance,
  getZonesByType,
  getTeamZones,
} from '~~/server/game/map/topology'
import { ZONES, ZONE_MAP, ZONE_IDS } from '~~/shared/constants/zones'
import { zonesForMap } from '~~/shared/constants/maps'
import type { Zone } from '~~/shared/types/map'

describe('Topology', () => {
  describe('getZone', () => {
    it('returns a zone by its ID', () => {
      const zone = getZone('rookery-terminal')
      expect(zone).toBeDefined()
      expect(zone!.id).toBe('rookery-terminal')
      expect(zone!.name).toBe('Rookery Terminal')
    })

    it('returns undefined for an unknown zone ID', () => {
      expect(getZone('nonexistent')).toBeUndefined()
    })

    it('returns correct zone for all defined zone IDs', () => {
      for (const id of ZONE_IDS) {
        const zone = getZone(id)
        expect(zone).toBeDefined()
        expect(zone!.id).toBe(id)
      }
    })
  })

  describe('getAdjacentZones', () => {
    it('returns adjacent zones for rookery-terminal', () => {
      const adj = getAdjacentZones('rookery-terminal')
      expect(adj).toContain('rookery-anchor')
      expect(adj).toContain('seawall-t3-chaff')
      expect(adj).toContain('coldstore-t3-chaff')
      expect(adj).toContain('shallows-t3-chaff')
    })

    it('returns empty array for unknown zone', () => {
      expect(getAdjacentZones('nonexistent')).toEqual([])
    })

    it('returns exactly 1 neighbor for fountain zones', () => {
      expect(getAdjacentZones('rookery-anchor')).toEqual(['rookery-terminal'])
      expect(getAdjacentZones('landing-anchor')).toEqual(['landing-terminal'])
    })
  })

  describe('areAdjacent', () => {
    it('returns true for adjacent zones', () => {
      expect(areAdjacent('rookery-terminal', 'rookery-anchor')).toBe(true)
      expect(areAdjacent('seawall-t1-chaff', 'seawall-cross')).toBe(true)
    })

    it('returns false for non-adjacent zones', () => {
      expect(areAdjacent('rookery-anchor', 'landing-anchor')).toBe(false)
      expect(areAdjacent('seawall-t1-chaff', 'shallows-t1-chaff')).toBe(false)
    })

    it('returns false when either zone does not exist', () => {
      expect(areAdjacent('nonexistent', 'rookery-terminal')).toBe(false)
      expect(areAdjacent('rookery-terminal', 'nonexistent')).toBe(false)
    })
  })

  describe('findPath', () => {
    it('returns single-element path when from === to', () => {
      expect(findPath('rookery-terminal', 'rookery-terminal')).toEqual(['rookery-terminal'])
    })

    it('returns empty array when either zone does not exist', () => {
      expect(findPath('nonexistent', 'rookery-terminal')).toEqual([])
      expect(findPath('rookery-terminal', 'nonexistent')).toEqual([])
    })

    it('finds a direct path between adjacent zones', () => {
      const path = findPath('rookery-anchor', 'rookery-terminal')
      expect(path).toEqual(['rookery-anchor', 'rookery-terminal'])
    })

    it('finds shortest path along mid lane', () => {
      const path = findPath('coldstore-t3-chaff', 'coldstore-cross')
      expect(path).toEqual([
        'coldstore-t3-chaff',
        'coldstore-t2-chaff',
        'coldstore-t1-chaff',
        'coldstore-cross',
      ])
    })

    it('includes both endpoints in path', () => {
      const path = findPath('rookery-anchor', 'landing-anchor')
      expect(path[0]).toBe('rookery-anchor')
      expect(path[path.length - 1]).toBe('landing-anchor')
    })

    it('finds a path from chaff to audit fountain', () => {
      const path = findPath('rookery-anchor', 'landing-anchor')
      expect(path.length).toBeGreaterThan(2)
      // Verify each step is adjacent to the next
      for (let i = 0; i < path.length - 1; i++) {
        expect(areAdjacent(path[i]!, path[i + 1]!)).toBe(true)
      }
    })

    it('finds a path through jungle', () => {
      const path = findPath('silt-chaff-upper', 'silt-audit-upper')
      expect(path.length).toBeGreaterThan(0)
      for (let i = 0; i < path.length - 1; i++) {
        expect(areAdjacent(path[i]!, path[i + 1]!)).toBe(true)
      }
    })
  })

  describe('getDistance', () => {
    it('returns 0 for same zone', () => {
      expect(getDistance('rookery-terminal', 'rookery-terminal')).toBe(0)
    })

    it('returns 1 for adjacent zones', () => {
      expect(getDistance('rookery-anchor', 'rookery-terminal')).toBe(1)
    })

    it('returns -1 for unreachable zones', () => {
      expect(getDistance('nonexistent', 'rookery-terminal')).toBe(-1)
    })

    it('returns correct distance along mid lane', () => {
      // coldstore-t3-chaff -> coldstore-t2-chaff -> coldstore-t1-chaff -> coldstore-cross = 3 edges
      expect(getDistance('coldstore-t3-chaff', 'coldstore-cross')).toBe(3)
    })
  })

  describe('getZonesByType', () => {
    it('returns all fountain zones', () => {
      const fountains = getZonesByType('anchor')
      expect(fountains).toHaveLength(2)
      const ids = fountains.map((z) => z.id)
      expect(ids).toContain('rookery-anchor')
      expect(ids).toContain('landing-anchor')
    })

    it('returns all base zones', () => {
      const bases = getZonesByType('base')
      expect(bases).toHaveLength(2)
    })

    it('returns lane zones', () => {
      const lanes = getZonesByType('route')
      // 3 lanes * 3 tiers * 2 teams = 18
      expect(lanes).toHaveLength(18)
    })

    it('returns silt zones', () => {
      const silts = getZonesByType('silt')
      expect(silts).toHaveLength(4)
    })

    it('returns river zones', () => {
      const rivers = getZonesByType('cross')
      // seawall-cross, coldstore-cross, shallows-cross, cache-seawall, cache-shallows = 5
      expect(rivers).toHaveLength(5)
    })

    it('returns objective zones', () => {
      const objectives = getZonesByType('objective')
      expect(objectives).toHaveLength(1)
      expect(objectives[0]!.id).toBe('hollow')
    })
  })

  describe('getTeamZones', () => {
    it('returns chaff zones', () => {
      const chaffZones = getTeamZones('chaff')
      expect(chaffZones.length).toBeGreaterThan(0)
      for (const z of chaffZones) {
        expect(z.team).toBe('chaff')
      }
    })

    it('returns audit zones', () => {
      const auditZones = getTeamZones('audit')
      expect(auditZones.length).toBeGreaterThan(0)
      for (const z of auditZones) {
        expect(z.team).toBe('audit')
      }
    })

    it('chaff and audit have equal number of zones', () => {
      const chaff = getTeamZones('chaff')
      const audit = getTeamZones('audit')
      expect(chaff.length).toBe(audit.length)
    })
  })

  /**
   * These used to assemble every id they checked (`` `${lane}-t${tier}-${team}` ``),
   * which is the coupling `tests/unit/map/zoneIdCoupling.test.ts` forbids in
   * source — so a zone-id rename broke fourteen assertions that were describing
   * the map's SHAPE, not its naming. Everything below is now derived from the
   * zone records: find the route's zones by their fields, then assert the chain.
   */
  describe('route structure', () => {
    const routes = [...new Set(ZONES.filter((z) => z.lane).map((z) => z.lane!))]

    it('has exactly three routes', () => {
      expect(routes).toHaveLength(3)
    })

    for (const lane of routes) {
      const on = (pred: (z: (typeof ZONES)[number]) => boolean) =>
        ZONES.filter((z) => z.lane === lane && pred(z))
      const tierZone = (tier: number, team: string) =>
        on((z) => z.tier === tier && z.team === team)[0]

      describe(`${lane} route`, () => {
        it('has 3 ice tiers per team', () => {
          for (const team of ['chaff', 'audit']) {
            for (const tier of [1, 2, 3]) {
              const zone = tierZone(tier, team)
              expect(zone, `${lane} T${tier} (${team}) missing`).toBeDefined()
              expect(getZone(zone!.id)!.ice).toBe(true)
            }
          }
        })

        it('has a neutral crossing', () => {
          const crossings = on((z) => z.type === 'cross')
          expect(crossings).toHaveLength(1)
          expect(crossings[0]!.team).toBe('neutral')
        })

        it('ice zones connect in order (T3 → T2 → T1 → crossing → T1 → T2 → T3)', () => {
          const cross = on((z) => z.type === 'cross')[0]!
          expect(areAdjacent(tierZone(3, 'chaff')!.id, tierZone(2, 'chaff')!.id)).toBe(true)
          expect(areAdjacent(tierZone(2, 'chaff')!.id, tierZone(1, 'chaff')!.id)).toBe(true)
          expect(areAdjacent(tierZone(1, 'chaff')!.id, cross.id)).toBe(true)
          expect(areAdjacent(cross.id, tierZone(1, 'audit')!.id)).toBe(true)
          expect(areAdjacent(tierZone(1, 'audit')!.id, tierZone(2, 'audit')!.id)).toBe(true)
          expect(areAdjacent(tierZone(2, 'audit')!.id, tierZone(3, 'audit')!.id)).toBe(true)
        })

        it('T3 connects to its own base', () => {
          const base = (team: string) => ZONES.find((z) => z.type === 'base' && z.team === team)!.id
          expect(areAdjacent(tierZone(3, 'chaff')!.id, base('chaff'))).toBe(true)
          expect(areAdjacent(tierZone(3, 'audit')!.id, base('audit'))).toBe(true)
        })
      })
    }
  })

  describe('jungle connectivity', () => {
    it('chaff top jungle connects to top lane and mid lane', () => {
      const adj = getAdjacentZones('silt-chaff-upper')
      expect(adj).toContain('seawall-t2-chaff')
      expect(adj).toContain('seawall-t1-chaff')
      expect(adj).toContain('coldstore-t2-chaff')
      expect(adj).toContain('cache-seawall')
    })

    it('chaff bot jungle connects to bot lane and mid lane', () => {
      const adj = getAdjacentZones('silt-chaff-lower')
      expect(adj).toContain('shallows-t2-chaff')
      expect(adj).toContain('shallows-t1-chaff')
      expect(adj).toContain('coldstore-t2-chaff')
      expect(adj).toContain('cache-shallows')
    })

    it('audit top jungle connects to top lane and mid lane', () => {
      const adj = getAdjacentZones('silt-audit-upper')
      expect(adj).toContain('seawall-t1-audit')
      expect(adj).toContain('seawall-t2-audit')
      expect(adj).toContain('coldstore-t2-audit')
      expect(adj).toContain('cache-seawall')
    })

    it('audit bot jungle connects to bot lane and mid lane', () => {
      const adj = getAdjacentZones('silt-audit-lower')
      expect(adj).toContain('shallows-t1-audit')
      expect(adj).toContain('shallows-t2-audit')
      expect(adj).toContain('coldstore-t2-audit')
      expect(adj).toContain('cache-shallows')
    })
  })

  describe('zone graph symmetry', () => {
    it('adjacency is bidirectional for all zones', () => {
      for (const zone of ZONES) {
        for (const neighborId of zone.adjacentTo) {
          const neighbor = ZONE_MAP[neighborId]
          expect(neighbor).toBeDefined()
          expect(neighbor!.adjacentTo).toContain(zone.id)
        }
      }
    })

    it('all zones are reachable from rookery-anchor', () => {
      for (const zone of ZONES) {
        const dist = getDistance('rookery-anchor', zone.id)
        expect(dist).toBeGreaterThanOrEqual(0)
      }
    })
  })

  // The one-lane map is a pruned subgraph of the full graph (see maps.ts). These
  // guard its promised "strict, SELF-CONTAINED subgraph" invariant — a regression
  // (an escaping edge or a broken chain) would let players/bots walk off the map
  // or strand them, and the global ZONE_MAP still carries the full edges.
  describe('one-lane subgraph (zonesForMap "one_lane")', () => {
    const oneLane: readonly Zone[] = zonesForMap('one_lane')
    const ids = new Set(oneLane.map((z) => z.id))
    const byId = new Map<string, Zone>(oneLane.map((z) => [z.id, z]))

    it('is exactly the 11 mid-lane zones (no side lanes, jungle, or caches)', () => {
      expect(oneLane).toHaveLength(11)
      for (const id of ['rookery-anchor', 'coldstore-cross', 'landing-anchor']) {
        expect(ids.has(id), `expected ${id} in the one-lane map`).toBe(true)
      }
      for (const id of ['seawall-cross', 'shallows-cross', 'cache-seawall', 'silt-chaff-upper']) {
        expect(ids.has(id), `${id} must NOT be in the one-lane map`).toBe(false)
      }
    })

    it('is self-contained — no zone links outside the 11-zone subgraph', () => {
      for (const zone of oneLane) {
        for (const neighborId of zone.adjacentTo) {
          expect(
            ids.has(neighborId),
            `${zone.id} → ${neighborId} escapes the one-lane subgraph`,
          ).toBe(true)
        }
      }
    })

    it('keeps adjacency bidirectional within the subgraph', () => {
      for (const zone of oneLane) {
        for (const neighborId of zone.adjacentTo) {
          expect(byId.get(neighborId)!.adjacentTo).toContain(zone.id)
        }
      }
    })

    it('forms one connected chain — every zone reachable from rookery-anchor', () => {
      const seen = new Set<string>(['rookery-anchor'])
      const queue: string[] = ['rookery-anchor']
      while (queue.length > 0) {
        const cur = queue.shift()!
        for (const n of byId.get(cur)!.adjacentTo) {
          if (!seen.has(n)) {
            seen.add(n)
            queue.push(n)
          }
        }
      }
      expect(seen.has('landing-anchor')).toBe(true)
      expect(seen.size).toBe(11)
    })
  })

  // The two-lane map (3v3) is the same class of pruned subgraph as one-lane.
  // These guard its self-containment, bidirectionality, connectivity, and the
  // promised "top + mid only, no bot lane" shape.
  describe('two-lane subgraph (zonesForMap "two_lane")', () => {
    const twoLane: readonly Zone[] = zonesForMap('two_lane')
    const ids = new Set(twoLane.map((z) => z.id))
    const byId = new Map<string, Zone>(twoLane.map((z) => [z.id, z]))

    it('is exactly 22 zones (bases + top + mid + top jungles + cache-seawall + tenant)', () => {
      expect(twoLane).toHaveLength(22)
    })

    it('keeps the top and mid lanes but drops the bot lane', () => {
      for (const id of [
        'seawall-t3-chaff',
        'seawall-cross',
        'seawall-t3-audit',
        'coldstore-cross',
        'coldstore-t1-audit',
      ]) {
        expect(ids.has(id), `expected ${id} in two_lane`).toBe(true)
      }
      for (const id of [
        'shallows-t3-chaff',
        'shallows-cross',
        'shallows-t3-audit',
        'silt-chaff-lower',
        'silt-audit-lower',
        'cache-shallows',
      ]) {
        expect(ids.has(id), `${id} must NOT be in two_lane`).toBe(false)
      }
    })

    it('keeps the top-side river objectives (cache-seawall + tenant)', () => {
      expect(ids.has('cache-seawall')).toBe(true)
      expect(ids.has('hollow')).toBe(true)
    })

    it('is self-contained — no zone links outside the 22-zone subgraph', () => {
      for (const zone of twoLane) {
        for (const neighborId of zone.adjacentTo) {
          expect(
            ids.has(neighborId),
            `${zone.id} → ${neighborId} escapes the two-lane subgraph`,
          ).toBe(true)
        }
      }
    })

    it('keeps adjacency bidirectional within the subgraph', () => {
      for (const zone of twoLane) {
        for (const neighborId of zone.adjacentTo) {
          expect(byId.get(neighborId)!.adjacentTo).toContain(zone.id)
        }
      }
    })

    it('forms one connected graph — every zone reachable from rookery-anchor', () => {
      const seen = new Set<string>(['rookery-anchor'])
      const queue: string[] = ['rookery-anchor']
      while (queue.length > 0) {
        const cur = queue.shift()!
        for (const n of byId.get(cur)!.adjacentTo) {
          if (!seen.has(n)) {
            seen.add(n)
            queue.push(n)
          }
        }
      }
      expect(seen.size).toBe(twoLane.length)
      expect(seen.has('landing-anchor')).toBe(true)
    })

    it('preserves a full mid-lane chain rookery-terminal → landing-terminal', () => {
      const chain = [
        'coldstore-t3-chaff',
        'coldstore-t2-chaff',
        'coldstore-t1-chaff',
        'coldstore-cross',
        'coldstore-t1-audit',
        'coldstore-t2-audit',
        'coldstore-t3-audit',
      ]
      for (let i = 0; i < chain.length - 1; i++) {
        expect(byId.get(chain[i]!)!.adjacentTo).toContain(chain[i + 1])
      }
    })

    it('preserves a full top-lane chain rookery-terminal → landing-terminal', () => {
      const chain = [
        'seawall-t3-chaff',
        'seawall-t2-chaff',
        'seawall-t1-chaff',
        'seawall-cross',
        'seawall-t1-audit',
        'seawall-t2-audit',
        'seawall-t3-audit',
      ]
      for (let i = 0; i < chain.length - 1; i++) {
        expect(byId.get(chain[i]!)!.adjacentTo).toContain(chain[i + 1])
      }
    })
  })

  describe('zonesForMap fallbacks', () => {
    it('defaults to the full 5v5 map when mapId is undefined', () => {
      // undefined ?? DEFAULT_MAP_ID → the full map.
      expect(zonesForMap(undefined)).toHaveLength(ZONES.length)
      expect(zonesForMap(undefined)).toBe(zonesForMap('default_5v5'))
    })

    it('falls back to the full map for an unknown mapId rather than returning empty', () => {
      const zones = zonesForMap('not_a_real_map')
      expect(zones).toHaveLength(ZONES.length)
    })
  })
})
