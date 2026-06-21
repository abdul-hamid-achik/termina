import { describe, it, expect } from 'vitest'
import {
  DEFAULT_MAP_ID,
  ONE_LANE_MAP_ID,
  TWO_LANE_MAP_ID,
  ONE_LANE_ZONES,
  TWO_LANE_ZONES,
  MAPS,
  zonesForMap,
  mapIdForMode,
} from '../../../shared/constants/maps'
import { ZONES, ZONE_MAP } from '../../../shared/constants/zones'
import type { Zone } from '../../../shared/types/map'

describe('maps', () => {
  describe('map registry', () => {
    it('registers exactly three maps', () => {
      expect(Object.keys(MAPS).sort()).toEqual(
        [DEFAULT_MAP_ID, ONE_LANE_MAP_ID, TWO_LANE_MAP_ID].sort(),
      )
    })

    it('the default map is the full zone set', () => {
      expect(MAPS[DEFAULT_MAP_ID]).toBe(ZONES)
    })

    it('one_lane and two_lane are pruned subsets of the full graph', () => {
      const oneIds = new Set(ONE_LANE_ZONES.map((z) => z.id))
      const twoIds = new Set(TWO_LANE_ZONES.map((z) => z.id))
      expect(oneIds.size).toBeLessThan(ZONES.length)
      expect(twoIds.size).toBeLessThan(ZONES.length)
      // Every zone in a subset exists in the full graph.
      for (const id of oneIds) expect(ZONE_MAP[id]).toBeDefined()
      for (const id of twoIds) expect(ZONE_MAP[id]).toBeDefined()
    })
  })

  describe('one_lane map', () => {
    const ids = new Set(ONE_LANE_ZONES.map((z) => z.id))
    const byId = new Map<string, Zone>(ONE_LANE_ZONES.map((z) => [z.id, z]))

    it('is exactly the 11 mid-lane zones', () => {
      expect(ONE_LANE_ZONES).toHaveLength(11)
      for (const id of [
        'radiant-fountain',
        'radiant-base',
        'mid-t3-rad',
        'mid-t2-rad',
        'mid-t1-rad',
        'mid-river',
        'mid-t1-dire',
        'mid-t2-dire',
        'mid-t3-dire',
        'dire-base',
        'dire-fountain',
      ]) {
        expect(ids.has(id), `expected ${id} in one_lane`).toBe(true)
      }
    })

    it('excludes side lanes, jungle, runes, and roshan', () => {
      for (const id of [
        'top-river',
        'bot-river',
        'rune-top',
        'rune-bot',
        'jungle-rad-top',
        'jungle-rad-bot',
        'jungle-dire-top',
        'jungle-dire-bot',
        'roshan-pit',
        'top-t3-rad',
        'bot-t3-rad',
      ]) {
        expect(ids.has(id), `${id} must NOT be in one_lane`).toBe(false)
      }
    })

    it('is self-contained — no edge escapes the subgraph', () => {
      for (const zone of ONE_LANE_ZONES) {
        for (const neighborId of zone.adjacentTo) {
          expect(ids.has(neighborId), `${zone.id} → ${neighborId} escapes one_lane`).toBe(true)
        }
      }
    })

    it('keeps adjacency bidirectional within the subgraph', () => {
      for (const zone of ONE_LANE_ZONES) {
        for (const neighborId of zone.adjacentTo) {
          expect(byId.get(neighborId)!.adjacentTo).toContain(zone.id)
        }
      }
    })
  })

  describe('two_lane map', () => {
    const ids = new Set(TWO_LANE_ZONES.map((z) => z.id))
    const byId = new Map<string, Zone>(TWO_LANE_ZONES.map((z) => [z.id, z]))

    it('contains exactly the top + mid lanes, their jungles, rune-top, and roshan', () => {
      // 4 bases/fountains + 7 top lane + 7 mid lane + 2 jungles + 2 objectives = 22
      expect(TWO_LANE_ZONES).toHaveLength(22)
      for (const id of [
        'radiant-fountain',
        'dire-fountain',
        'radiant-base',
        'dire-base',
        // Top lane chain
        'top-t3-rad',
        'top-t2-rad',
        'top-t1-rad',
        'top-river',
        'top-t1-dire',
        'top-t2-dire',
        'top-t3-dire',
        // Mid lane chain
        'mid-t3-rad',
        'mid-t2-rad',
        'mid-t1-rad',
        'mid-river',
        'mid-t1-dire',
        'mid-t2-dire',
        'mid-t3-dire',
        // Top-side jungle
        'jungle-rad-top',
        'jungle-dire-top',
        // Top-side river objectives
        'rune-top',
        'roshan-pit',
      ]) {
        expect(ids.has(id), `expected ${id} in two_lane`).toBe(true)
      }
    })

    it('excludes the entire bot lane and bot-side objectives', () => {
      for (const id of [
        'bot-t3-rad',
        'bot-t2-rad',
        'bot-t1-rad',
        'bot-river',
        'bot-t1-dire',
        'bot-t2-dire',
        'bot-t3-dire',
        'jungle-rad-bot',
        'jungle-dire-bot',
        'rune-bot',
      ]) {
        expect(ids.has(id), `${id} must NOT be in two_lane`).toBe(false)
      }
    })

    it('is self-contained — no edge escapes the subgraph', () => {
      for (const zone of TWO_LANE_ZONES) {
        for (const neighborId of zone.adjacentTo) {
          expect(ids.has(neighborId), `${zone.id} → ${neighborId} escapes two_lane`).toBe(true)
        }
      }
    })

    it('keeps adjacency bidirectional within the subgraph', () => {
      for (const zone of TWO_LANE_ZONES) {
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
      expect(seen.size).toBe(TWO_LANE_ZONES.length)
      expect(seen.has('dire-fountain')).toBe(true)
    })

    it('still allows a full mid-lane path from radiant-base to dire-base', () => {
      const mid = [
        'mid-t3-rad',
        'mid-t2-rad',
        'mid-t1-rad',
        'mid-river',
        'mid-t1-dire',
        'mid-t2-dire',
        'mid-t3-dire',
      ]
      for (let i = 0; i < mid.length - 1; i++) {
        expect(byId.get(mid[i]!)!.adjacentTo).toContain(mid[i + 1])
      }
    })

    it('still allows a full top-lane path from radiant-base to dire-base', () => {
      const top = [
        'top-t3-rad',
        'top-t2-rad',
        'top-t1-rad',
        'top-river',
        'top-t1-dire',
        'top-t2-dire',
        'top-t3-dire',
      ]
      for (let i = 0; i < top.length - 1; i++) {
        expect(byId.get(top[i]!)!.adjacentTo).toContain(top[i + 1])
      }
    })
  })

  describe('zonesForMap', () => {
    it('resolves the full map for the default id', () => {
      expect(zonesForMap(DEFAULT_MAP_ID)).toBe(ZONES)
    })

    it('resolves one_lane for the one-lane id', () => {
      expect(zonesForMap(ONE_LANE_MAP_ID)).toBe(ONE_LANE_ZONES)
    })

    it('resolves two_lane for the two-lane id', () => {
      expect(zonesForMap(TWO_LANE_MAP_ID)).toBe(TWO_LANE_ZONES)
    })

    it('defaults to the full map for undefined', () => {
      expect(zonesForMap(undefined)).toBe(ZONES)
    })

    it('falls back to the full map for an unknown id', () => {
      expect(zonesForMap('not_a_real_map')).toBe(ZONES)
    })
  })

  describe('mapIdForMode', () => {
    it('maps ranked_5v5 to the full 3-lane map', () => {
      expect(mapIdForMode('ranked_5v5')).toBe(DEFAULT_MAP_ID)
    })

    it('maps quick_3v3 to the two-lane map', () => {
      expect(mapIdForMode('quick_3v3')).toBe(TWO_LANE_MAP_ID)
    })

    it('maps 1v1 to the one-lane map', () => {
      expect(mapIdForMode('1v1')).toBe(ONE_LANE_MAP_ID)
    })

    it('falls back to the full map for undefined / unknown modes', () => {
      expect(mapIdForMode(undefined)).toBe(DEFAULT_MAP_ID)
      expect(mapIdForMode('unknown')).toBe(DEFAULT_MAP_ID)
    })
  })
})
