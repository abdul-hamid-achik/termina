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
})
