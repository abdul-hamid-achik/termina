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
      const zone = getZone('chaff-base')
      expect(zone).toBeDefined()
      expect(zone!.id).toBe('chaff-base')
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
    it('returns adjacent zones for chaff-base', () => {
      const adj = getAdjacentZones('chaff-base')
      expect(adj).toContain('chaff-fountain')
      expect(adj).toContain('top-t3-chaff')
      expect(adj).toContain('mid-t3-chaff')
      expect(adj).toContain('bot-t3-chaff')
    })

    it('returns empty array for unknown zone', () => {
      expect(getAdjacentZones('nonexistent')).toEqual([])
    })

    it('returns exactly 1 neighbor for fountain zones', () => {
      expect(getAdjacentZones('chaff-fountain')).toEqual(['chaff-base'])
      expect(getAdjacentZones('audit-fountain')).toEqual(['audit-base'])
    })
  })

  describe('areAdjacent', () => {
    it('returns true for adjacent zones', () => {
      expect(areAdjacent('chaff-base', 'chaff-fountain')).toBe(true)
      expect(areAdjacent('top-t1-chaff', 'top-river')).toBe(true)
    })

    it('returns false for non-adjacent zones', () => {
      expect(areAdjacent('chaff-fountain', 'audit-fountain')).toBe(false)
      expect(areAdjacent('top-t1-chaff', 'bot-t1-chaff')).toBe(false)
    })

    it('returns false when either zone does not exist', () => {
      expect(areAdjacent('nonexistent', 'chaff-base')).toBe(false)
      expect(areAdjacent('chaff-base', 'nonexistent')).toBe(false)
    })
  })

  describe('findPath', () => {
    it('returns single-element path when from === to', () => {
      expect(findPath('chaff-base', 'chaff-base')).toEqual(['chaff-base'])
    })

    it('returns empty array when either zone does not exist', () => {
      expect(findPath('nonexistent', 'chaff-base')).toEqual([])
      expect(findPath('chaff-base', 'nonexistent')).toEqual([])
    })

    it('finds a direct path between adjacent zones', () => {
      const path = findPath('chaff-fountain', 'chaff-base')
      expect(path).toEqual(['chaff-fountain', 'chaff-base'])
    })

    it('finds shortest path along mid lane', () => {
      const path = findPath('mid-t3-chaff', 'mid-river')
      expect(path).toEqual(['mid-t3-chaff', 'mid-t2-chaff', 'mid-t1-chaff', 'mid-river'])
    })

    it('includes both endpoints in path', () => {
      const path = findPath('chaff-fountain', 'audit-fountain')
      expect(path[0]).toBe('chaff-fountain')
      expect(path[path.length - 1]).toBe('audit-fountain')
    })

    it('finds a path from chaff to audit fountain', () => {
      const path = findPath('chaff-fountain', 'audit-fountain')
      expect(path.length).toBeGreaterThan(2)
      // Verify each step is adjacent to the next
      for (let i = 0; i < path.length - 1; i++) {
        expect(areAdjacent(path[i]!, path[i + 1]!)).toBe(true)
      }
    })

    it('finds a path through jungle', () => {
      const path = findPath('silt-chaff-top', 'silt-audit-top')
      expect(path.length).toBeGreaterThan(0)
      for (let i = 0; i < path.length - 1; i++) {
        expect(areAdjacent(path[i]!, path[i + 1]!)).toBe(true)
      }
    })
  })

  describe('getDistance', () => {
    it('returns 0 for same zone', () => {
      expect(getDistance('chaff-base', 'chaff-base')).toBe(0)
    })

    it('returns 1 for adjacent zones', () => {
      expect(getDistance('chaff-fountain', 'chaff-base')).toBe(1)
    })

    it('returns -1 for unreachable zones', () => {
      expect(getDistance('nonexistent', 'chaff-base')).toBe(-1)
    })

    it('returns correct distance along mid lane', () => {
      // mid-t3-chaff -> mid-t2-chaff -> mid-t1-chaff -> mid-river = 3 edges
      expect(getDistance('mid-t3-chaff', 'mid-river')).toBe(3)
    })
  })

  describe('getZonesByType', () => {
    it('returns all fountain zones', () => {
      const fountains = getZonesByType('fountain')
      expect(fountains).toHaveLength(2)
      const ids = fountains.map((z) => z.id)
      expect(ids).toContain('chaff-fountain')
      expect(ids).toContain('audit-fountain')
    })

    it('returns all base zones', () => {
      const bases = getZonesByType('base')
      expect(bases).toHaveLength(2)
    })

    it('returns lane zones', () => {
      const lanes = getZonesByType('lane')
      // 3 lanes * 3 tiers * 2 teams = 18
      expect(lanes).toHaveLength(18)
    })

    it('returns jungle zones', () => {
      const jungles = getZonesByType('jungle')
      expect(jungles).toHaveLength(4)
    })

    it('returns river zones', () => {
      const rivers = getZonesByType('river')
      // top-river, mid-river, bot-river, cache-top, cache-bot = 5
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

  describe('lane structure', () => {
    for (const lane of ['top', 'mid', 'bot']) {
      describe(`${lane} lane`, () => {
        it('has 3 tower tiers per team', () => {
          for (const team of ['chaff', 'audit']) {
            for (const tier of [1, 2, 3]) {
              const id = `${lane}-t${tier}-${team}`
              expect(getZone(id)).toBeDefined()
              expect(getZone(id)!.tower).toBe(true)
            }
          }
        })

        it('has a river crossing', () => {
          const river = getZone(`${lane}-river`)
          expect(river).toBeDefined()
          expect(river!.type).toBe('river')
          expect(river!.team).toBe('neutral')
        })

        it('tower zones connect in correct order (T3 → T2 → T1 → river → T1 → T2 → T3)', () => {
          // Chaff side: t3 -> t2 -> t1 -> river
          expect(areAdjacent(`${lane}-t3-chaff`, `${lane}-t2-chaff`)).toBe(true)
          expect(areAdjacent(`${lane}-t2-chaff`, `${lane}-t1-chaff`)).toBe(true)
          expect(areAdjacent(`${lane}-t1-chaff`, `${lane}-river`)).toBe(true)
          // Audit side: river -> t1 -> t2 -> t3
          expect(areAdjacent(`${lane}-river`, `${lane}-t1-audit`)).toBe(true)
          expect(areAdjacent(`${lane}-t1-audit`, `${lane}-t2-audit`)).toBe(true)
          expect(areAdjacent(`${lane}-t2-audit`, `${lane}-t3-audit`)).toBe(true)
        })

        it('T3 connects to its base', () => {
          expect(areAdjacent(`${lane}-t3-chaff`, 'chaff-base')).toBe(true)
          expect(areAdjacent(`${lane}-t3-audit`, 'audit-base')).toBe(true)
        })
      })
    }
  })

  describe('jungle connectivity', () => {
    it('chaff top jungle connects to top lane and mid lane', () => {
      const adj = getAdjacentZones('silt-chaff-top')
      expect(adj).toContain('top-t2-chaff')
      expect(adj).toContain('top-t1-chaff')
      expect(adj).toContain('mid-t2-chaff')
      expect(adj).toContain('cache-top')
    })

    it('chaff bot jungle connects to bot lane and mid lane', () => {
      const adj = getAdjacentZones('silt-chaff-bot')
      expect(adj).toContain('bot-t2-chaff')
      expect(adj).toContain('bot-t1-chaff')
      expect(adj).toContain('mid-t2-chaff')
      expect(adj).toContain('cache-bot')
    })

    it('audit top jungle connects to top lane and mid lane', () => {
      const adj = getAdjacentZones('silt-audit-top')
      expect(adj).toContain('top-t1-audit')
      expect(adj).toContain('top-t2-audit')
      expect(adj).toContain('mid-t2-audit')
      expect(adj).toContain('cache-top')
    })

    it('audit bot jungle connects to bot lane and mid lane', () => {
      const adj = getAdjacentZones('silt-audit-bot')
      expect(adj).toContain('bot-t1-audit')
      expect(adj).toContain('bot-t2-audit')
      expect(adj).toContain('mid-t2-audit')
      expect(adj).toContain('cache-bot')
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

    it('all zones are reachable from chaff-fountain', () => {
      for (const zone of ZONES) {
        const dist = getDistance('chaff-fountain', zone.id)
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

    it('is exactly the 11 mid-lane zones (no side lanes, jungle, or runes)', () => {
      expect(oneLane).toHaveLength(11)
      for (const id of ['chaff-fountain', 'mid-river', 'audit-fountain']) {
        expect(ids.has(id), `expected ${id} in the one-lane map`).toBe(true)
      }
      for (const id of ['top-river', 'bot-river', 'cache-top', 'silt-chaff-top']) {
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

    it('forms one connected chain — every zone reachable from chaff-fountain', () => {
      const seen = new Set<string>(['chaff-fountain'])
      const queue: string[] = ['chaff-fountain']
      while (queue.length > 0) {
        const cur = queue.shift()!
        for (const n of byId.get(cur)!.adjacentTo) {
          if (!seen.has(n)) {
            seen.add(n)
            queue.push(n)
          }
        }
      }
      expect(seen.has('audit-fountain')).toBe(true)
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

    it('is exactly 22 zones (bases + top + mid + top jungles + cache-top + roshan)', () => {
      expect(twoLane).toHaveLength(22)
    })

    it('keeps the top and mid lanes but drops the bot lane', () => {
      for (const id of ['top-t3-chaff', 'top-river', 'top-t3-audit', 'mid-river', 'mid-t1-audit']) {
        expect(ids.has(id), `expected ${id} in two_lane`).toBe(true)
      }
      for (const id of [
        'bot-t3-chaff',
        'bot-river',
        'bot-t3-audit',
        'silt-chaff-bot',
        'silt-audit-bot',
        'cache-bot',
      ]) {
        expect(ids.has(id), `${id} must NOT be in two_lane`).toBe(false)
      }
    })

    it('keeps the top-side river objectives (cache-top + roshan)', () => {
      expect(ids.has('cache-top')).toBe(true)
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

    it('forms one connected graph — every zone reachable from chaff-fountain', () => {
      const seen = new Set<string>(['chaff-fountain'])
      const queue: string[] = ['chaff-fountain']
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
      expect(seen.has('audit-fountain')).toBe(true)
    })

    it('preserves a full mid-lane chain chaff-base → audit-base', () => {
      const chain = [
        'mid-t3-chaff',
        'mid-t2-chaff',
        'mid-t1-chaff',
        'mid-river',
        'mid-t1-audit',
        'mid-t2-audit',
        'mid-t3-audit',
      ]
      for (let i = 0; i < chain.length - 1; i++) {
        expect(byId.get(chain[i]!)!.adjacentTo).toContain(chain[i + 1])
      }
    })

    it('preserves a full top-lane chain chaff-base → audit-base', () => {
      const chain = [
        'top-t3-chaff',
        'top-t2-chaff',
        'top-t1-chaff',
        'top-river',
        'top-t1-audit',
        'top-t2-audit',
        'top-t3-audit',
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
