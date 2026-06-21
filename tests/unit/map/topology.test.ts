import { describe, it, expect } from 'vitest'
import {
  getZone,
  getAdjacentZones,
  areAdjacent,
  findPath,
  getDistance,
  getZonesByType,
  getTeamZones,
} from '../../../server/game/map/topology'
import { ZONES, ZONE_MAP, ZONE_IDS } from '../../../shared/constants/zones'
import { zonesForMap } from '../../../shared/constants/maps'
import type { Zone } from '../../../shared/types/map'

describe('Topology', () => {
  describe('getZone', () => {
    it('returns a zone by its ID', () => {
      const zone = getZone('radiant-base')
      expect(zone).toBeDefined()
      expect(zone!.id).toBe('radiant-base')
      expect(zone!.name).toBe('Radiant Base')
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
    it('returns adjacent zones for radiant-base', () => {
      const adj = getAdjacentZones('radiant-base')
      expect(adj).toContain('radiant-fountain')
      expect(adj).toContain('top-t3-rad')
      expect(adj).toContain('mid-t3-rad')
      expect(adj).toContain('bot-t3-rad')
    })

    it('returns empty array for unknown zone', () => {
      expect(getAdjacentZones('nonexistent')).toEqual([])
    })

    it('returns exactly 1 neighbor for fountain zones', () => {
      expect(getAdjacentZones('radiant-fountain')).toEqual(['radiant-base'])
      expect(getAdjacentZones('dire-fountain')).toEqual(['dire-base'])
    })
  })

  describe('areAdjacent', () => {
    it('returns true for adjacent zones', () => {
      expect(areAdjacent('radiant-base', 'radiant-fountain')).toBe(true)
      expect(areAdjacent('top-t1-rad', 'top-river')).toBe(true)
    })

    it('returns false for non-adjacent zones', () => {
      expect(areAdjacent('radiant-fountain', 'dire-fountain')).toBe(false)
      expect(areAdjacent('top-t1-rad', 'bot-t1-rad')).toBe(false)
    })

    it('returns false when either zone does not exist', () => {
      expect(areAdjacent('nonexistent', 'radiant-base')).toBe(false)
      expect(areAdjacent('radiant-base', 'nonexistent')).toBe(false)
    })
  })

  describe('findPath', () => {
    it('returns single-element path when from === to', () => {
      expect(findPath('radiant-base', 'radiant-base')).toEqual(['radiant-base'])
    })

    it('returns empty array when either zone does not exist', () => {
      expect(findPath('nonexistent', 'radiant-base')).toEqual([])
      expect(findPath('radiant-base', 'nonexistent')).toEqual([])
    })

    it('finds a direct path between adjacent zones', () => {
      const path = findPath('radiant-fountain', 'radiant-base')
      expect(path).toEqual(['radiant-fountain', 'radiant-base'])
    })

    it('finds shortest path along mid lane', () => {
      const path = findPath('mid-t3-rad', 'mid-river')
      expect(path).toEqual(['mid-t3-rad', 'mid-t2-rad', 'mid-t1-rad', 'mid-river'])
    })

    it('includes both endpoints in path', () => {
      const path = findPath('radiant-fountain', 'dire-fountain')
      expect(path[0]).toBe('radiant-fountain')
      expect(path[path.length - 1]).toBe('dire-fountain')
    })

    it('finds a path from radiant to dire fountain', () => {
      const path = findPath('radiant-fountain', 'dire-fountain')
      expect(path.length).toBeGreaterThan(2)
      // Verify each step is adjacent to the next
      for (let i = 0; i < path.length - 1; i++) {
        expect(areAdjacent(path[i]!, path[i + 1]!)).toBe(true)
      }
    })

    it('finds a path through jungle', () => {
      const path = findPath('jungle-rad-top', 'jungle-dire-top')
      expect(path.length).toBeGreaterThan(0)
      for (let i = 0; i < path.length - 1; i++) {
        expect(areAdjacent(path[i]!, path[i + 1]!)).toBe(true)
      }
    })
  })

  describe('getDistance', () => {
    it('returns 0 for same zone', () => {
      expect(getDistance('radiant-base', 'radiant-base')).toBe(0)
    })

    it('returns 1 for adjacent zones', () => {
      expect(getDistance('radiant-fountain', 'radiant-base')).toBe(1)
    })

    it('returns -1 for unreachable zones', () => {
      expect(getDistance('nonexistent', 'radiant-base')).toBe(-1)
    })

    it('returns correct distance along mid lane', () => {
      // mid-t3-rad -> mid-t2-rad -> mid-t1-rad -> mid-river = 3 edges
      expect(getDistance('mid-t3-rad', 'mid-river')).toBe(3)
    })
  })

  describe('getZonesByType', () => {
    it('returns all fountain zones', () => {
      const fountains = getZonesByType('fountain')
      expect(fountains).toHaveLength(2)
      const ids = fountains.map((z) => z.id)
      expect(ids).toContain('radiant-fountain')
      expect(ids).toContain('dire-fountain')
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
      // top-river, mid-river, bot-river, rune-top, rune-bot = 5
      expect(rivers).toHaveLength(5)
    })

    it('returns objective zones', () => {
      const objectives = getZonesByType('objective')
      expect(objectives).toHaveLength(1)
      expect(objectives[0]!.id).toBe('roshan-pit')
    })
  })

  describe('getTeamZones', () => {
    it('returns radiant zones', () => {
      const radiantZones = getTeamZones('radiant')
      expect(radiantZones.length).toBeGreaterThan(0)
      for (const z of radiantZones) {
        expect(z.team).toBe('radiant')
      }
    })

    it('returns dire zones', () => {
      const direZones = getTeamZones('dire')
      expect(direZones.length).toBeGreaterThan(0)
      for (const z of direZones) {
        expect(z.team).toBe('dire')
      }
    })

    it('radiant and dire have equal number of zones', () => {
      const radiant = getTeamZones('radiant')
      const dire = getTeamZones('dire')
      expect(radiant.length).toBe(dire.length)
    })
  })

  describe('lane structure', () => {
    for (const lane of ['top', 'mid', 'bot']) {
      describe(`${lane} lane`, () => {
        it('has 3 tower tiers per team', () => {
          for (const team of ['rad', 'dire']) {
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
          // Radiant side: t3 -> t2 -> t1 -> river
          expect(areAdjacent(`${lane}-t3-rad`, `${lane}-t2-rad`)).toBe(true)
          expect(areAdjacent(`${lane}-t2-rad`, `${lane}-t1-rad`)).toBe(true)
          expect(areAdjacent(`${lane}-t1-rad`, `${lane}-river`)).toBe(true)
          // Dire side: river -> t1 -> t2 -> t3
          expect(areAdjacent(`${lane}-river`, `${lane}-t1-dire`)).toBe(true)
          expect(areAdjacent(`${lane}-t1-dire`, `${lane}-t2-dire`)).toBe(true)
          expect(areAdjacent(`${lane}-t2-dire`, `${lane}-t3-dire`)).toBe(true)
        })

        it('T3 connects to its base', () => {
          expect(areAdjacent(`${lane}-t3-rad`, 'radiant-base')).toBe(true)
          expect(areAdjacent(`${lane}-t3-dire`, 'dire-base')).toBe(true)
        })
      })
    }
  })

  describe('jungle connectivity', () => {
    it('radiant top jungle connects to top lane and mid lane', () => {
      const adj = getAdjacentZones('jungle-rad-top')
      expect(adj).toContain('top-t2-rad')
      expect(adj).toContain('top-t1-rad')
      expect(adj).toContain('mid-t2-rad')
      expect(adj).toContain('rune-top')
    })

    it('radiant bot jungle connects to bot lane and mid lane', () => {
      const adj = getAdjacentZones('jungle-rad-bot')
      expect(adj).toContain('bot-t2-rad')
      expect(adj).toContain('bot-t1-rad')
      expect(adj).toContain('mid-t2-rad')
      expect(adj).toContain('rune-bot')
    })

    it('dire top jungle connects to top lane and mid lane', () => {
      const adj = getAdjacentZones('jungle-dire-top')
      expect(adj).toContain('top-t1-dire')
      expect(adj).toContain('top-t2-dire')
      expect(adj).toContain('mid-t2-dire')
      expect(adj).toContain('rune-top')
    })

    it('dire bot jungle connects to bot lane and mid lane', () => {
      const adj = getAdjacentZones('jungle-dire-bot')
      expect(adj).toContain('bot-t1-dire')
      expect(adj).toContain('bot-t2-dire')
      expect(adj).toContain('mid-t2-dire')
      expect(adj).toContain('rune-bot')
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

    it('all zones are reachable from radiant-fountain', () => {
      for (const zone of ZONES) {
        const dist = getDistance('radiant-fountain', zone.id)
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
      for (const id of ['radiant-fountain', 'mid-river', 'dire-fountain']) {
        expect(ids.has(id), `expected ${id} in the one-lane map`).toBe(true)
      }
      for (const id of ['top-river', 'bot-river', 'rune-top', 'jungle-rad-top']) {
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

    it('forms one connected chain — every zone reachable from radiant-fountain', () => {
      const seen = new Set<string>(['radiant-fountain'])
      const queue: string[] = ['radiant-fountain']
      while (queue.length > 0) {
        const cur = queue.shift()!
        for (const n of byId.get(cur)!.adjacentTo) {
          if (!seen.has(n)) {
            seen.add(n)
            queue.push(n)
          }
        }
      }
      expect(seen.has('dire-fountain')).toBe(true)
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

    it('is exactly 22 zones (bases + top + mid + top jungles + rune-top + roshan)', () => {
      expect(twoLane).toHaveLength(22)
    })

    it('keeps the top and mid lanes but drops the bot lane', () => {
      for (const id of ['top-t3-rad', 'top-river', 'top-t3-dire', 'mid-river', 'mid-t1-dire']) {
        expect(ids.has(id), `expected ${id} in two_lane`).toBe(true)
      }
      for (const id of [
        'bot-t3-rad',
        'bot-river',
        'bot-t3-dire',
        'jungle-rad-bot',
        'jungle-dire-bot',
        'rune-bot',
      ]) {
        expect(ids.has(id), `${id} must NOT be in two_lane`).toBe(false)
      }
    })

    it('keeps the top-side river objectives (rune-top + roshan)', () => {
      expect(ids.has('rune-top')).toBe(true)
      expect(ids.has('roshan-pit')).toBe(true)
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

    it('forms one connected graph — every zone reachable from radiant-fountain', () => {
      const seen = new Set<string>(['radiant-fountain'])
      const queue: string[] = ['radiant-fountain']
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
      expect(seen.has('dire-fountain')).toBe(true)
    })

    it('preserves a full mid-lane chain radiant-base → dire-base', () => {
      const chain = [
        'mid-t3-rad',
        'mid-t2-rad',
        'mid-t1-rad',
        'mid-river',
        'mid-t1-dire',
        'mid-t2-dire',
        'mid-t3-dire',
      ]
      for (let i = 0; i < chain.length - 1; i++) {
        expect(byId.get(chain[i]!)!.adjacentTo).toContain(chain[i + 1])
      }
    })

    it('preserves a full top-lane chain radiant-base → dire-base', () => {
      const chain = [
        'top-t3-rad',
        'top-t2-rad',
        'top-t1-rad',
        'top-river',
        'top-t1-dire',
        'top-t2-dire',
        'top-t3-dire',
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
