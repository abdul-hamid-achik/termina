import { describe, it, expect } from 'vitest'
import { ZONES, ZONE_MAP, ZONE_IDS, isShopZoneFor } from '~~/shared/constants/zones'

describe('Zone Constants', () => {
  describe('zone count and structure', () => {
    it('has the expected total number of zones', () => {
      // 2 bases + 2 fountains + 18 lane + 4 silt + 5 river + 1 objective = 32
      expect(ZONES.length).toBe(32)
    })

    it('ZONE_IDS matches ZONES length', () => {
      expect(ZONE_IDS.length).toBe(ZONES.length)
    })

    it('ZONE_MAP has entry for every zone', () => {
      expect(Object.keys(ZONE_MAP).length).toBe(ZONES.length)
      for (const zone of ZONES) {
        expect(ZONE_MAP[zone.id]).toBeDefined()
        expect(ZONE_MAP[zone.id]!.id).toBe(zone.id)
      }
    })

    it('all zone IDs are unique', () => {
      const ids = ZONES.map((z) => z.id)
      expect(new Set(ids).size).toBe(ids.length)
    })
  })

  describe('zone types', () => {
    it('has exactly 2 fountain zones', () => {
      const fountains = ZONES.filter((z) => z.type === 'anchor')
      expect(fountains).toHaveLength(2)
    })

    it('has exactly 2 base zones', () => {
      const bases = ZONES.filter((z) => z.type === 'base')
      expect(bases).toHaveLength(2)
    })

    it('has exactly 18 lane zones (3 lanes * 3 tiers * 2 teams)', () => {
      const lanes = ZONES.filter((z) => z.type === 'route')
      expect(lanes).toHaveLength(18)
    })

    it('has exactly 4 silt zones', () => {
      const silts = ZONES.filter((z) => z.type === 'silt')
      expect(silts).toHaveLength(4)
    })

    it('has exactly 5 river zones', () => {
      const rivers = ZONES.filter((z) => z.type === 'cross')
      expect(rivers).toHaveLength(5)
    })

    it('has exactly 1 objective zone (hollow)', () => {
      const objectives = ZONES.filter((z) => z.type === 'objective')
      expect(objectives).toHaveLength(1)
      expect(objectives[0]!.id).toBe('hollow')
    })
  })

  describe('team assignment', () => {
    it('each base belongs to a team', () => {
      const chaffBase = ZONE_MAP['rookery-terminal']
      const auditBase = ZONE_MAP['landing-terminal']
      expect(chaffBase!.team).toBe('chaff')
      expect(auditBase!.team).toBe('audit')
    })

    it('each fountain belongs to a team', () => {
      expect(ZONE_MAP['rookery-anchor']!.team).toBe('chaff')
      expect(ZONE_MAP['landing-anchor']!.team).toBe('audit')
    })

    it('river zones are neutral', () => {
      const rivers = ZONES.filter((z) => z.type === 'cross')
      for (const r of rivers) {
        expect(r.team).toBe('neutral')
      }
    })

    it('objective zones are neutral', () => {
      const objectives = ZONES.filter((z) => z.type === 'objective')
      for (const o of objectives) {
        expect(o.team).toBe('neutral')
      }
    })

    it('lane zones belong to correct team based on suffix', () => {
      const lanes = ZONES.filter((z) => z.type === 'route')
      for (const l of lanes) {
        if (l.id.endsWith('-chaff')) expect(l.team).toBe('chaff')
        else if (l.id.endsWith('-audit')) expect(l.team).toBe('audit')
      }
    })

    it('chaff and audit have same number of team zones', () => {
      const chaffCount = ZONES.filter((z) => z.team === 'chaff').length
      const auditCount = ZONES.filter((z) => z.team === 'audit').length
      expect(chaffCount).toBe(auditCount)
    })
  })

  describe('shop zones', () => {
    it('only bases and fountains have shops', () => {
      const shops = ZONES.filter((z) => z.shop)
      expect(shops).toHaveLength(4)
      // Order-independent: the list is sorted, so it must be compared sorted.
      expect(shops.map((s) => s.id).sort()).toEqual(
        ['landing-terminal', 'landing-anchor', 'rookery-terminal', 'rookery-anchor'].sort(),
      )
    })

    it('both teams can shop without leaving their base', () => {
      for (const id of ['rookery-terminal', 'landing-terminal']) {
        expect(ZONES.find((z) => z.id === id)?.shop).toBe(true)
      }
    })
  })

  describe('ice zones', () => {
    it('all lane zones have ice', () => {
      const lanes = ZONES.filter((z) => z.type === 'route')
      for (const l of lanes) {
        expect(l.ice).toBe(true)
      }
    })

    it('non-lane zones do not have ice', () => {
      const nonLanes = ZONES.filter((z) => z.type !== 'route')
      for (const z of nonLanes) {
        expect(z.ice).toBe(false)
      }
    })
  })

  describe('adjacency integrity', () => {
    it('all adjacentTo references point to existing zones', () => {
      for (const zone of ZONES) {
        for (const adjId of zone.adjacentTo) {
          expect(ZONE_MAP[adjId]).toBeDefined()
        }
      }
    })

    it('adjacency is bidirectional', () => {
      for (const zone of ZONES) {
        for (const adjId of zone.adjacentTo) {
          const adj = ZONE_MAP[adjId]!
          expect(adj.adjacentTo).toContain(zone.id)
        }
      }
    })

    it('no zone is adjacent to itself', () => {
      for (const zone of ZONES) {
        expect(zone.adjacentTo).not.toContain(zone.id)
      }
    })

    it('no duplicate adjacencies', () => {
      for (const zone of ZONES) {
        expect(new Set(zone.adjacentTo).size).toBe(zone.adjacentTo.length)
      }
    })
  })

  describe('map layout validation', () => {
    it('tenant pit is reachable only from cache-seawall', () => {
      const rosh = ZONE_MAP['hollow']!
      expect(rosh.adjacentTo).toEqual(['cache-seawall'])
    })

    it('cache spots connect to river crossings and silts', () => {
      const cacheTop = ZONE_MAP['cache-seawall']!
      expect(cacheTop.adjacentTo).toContain('seawall-cross')
      expect(cacheTop.adjacentTo).toContain('coldstore-cross')
      expect(cacheTop.adjacentTo).toContain('silt-chaff-upper')
      expect(cacheTop.adjacentTo).toContain('silt-audit-upper')

      const cacheBot = ZONE_MAP['cache-shallows']!
      expect(cacheBot.adjacentTo).toContain('shallows-cross')
      expect(cacheBot.adjacentTo).toContain('coldstore-cross')
      expect(cacheBot.adjacentTo).toContain('silt-chaff-lower')
      expect(cacheBot.adjacentTo).toContain('silt-audit-lower')
    })

    it('fountains connect only to their base', () => {
      expect(ZONE_MAP['rookery-anchor']!.adjacentTo).toEqual(['rookery-terminal'])
      expect(ZONE_MAP['landing-anchor']!.adjacentTo).toEqual(['landing-terminal'])
    })

    it('bases connect to fountain and all three T3 zones', () => {
      const radBase = ZONE_MAP['rookery-terminal']!
      expect(radBase.adjacentTo).toContain('rookery-anchor')
      expect(radBase.adjacentTo).toContain('seawall-t3-chaff')
      expect(radBase.adjacentTo).toContain('coldstore-t3-chaff')
      expect(radBase.adjacentTo).toContain('shallows-t3-chaff')
      expect(radBase.adjacentTo).toHaveLength(4)

      const auditBase = ZONE_MAP['landing-terminal']!
      expect(auditBase.adjacentTo).toContain('landing-anchor')
      expect(auditBase.adjacentTo).toContain('seawall-t3-audit')
      expect(auditBase.adjacentTo).toContain('coldstore-t3-audit')
      expect(auditBase.adjacentTo).toContain('shallows-t3-audit')
      expect(auditBase.adjacentTo).toHaveLength(4)
    })
  })

  // A bot-vs-bot game (same AI both sides) should trend ~50/50 only if the two
  // halves of the map are structurally identical. Lock that fairness invariant —
  // a missing ice, extra silt, or lop-sided connection on one side would show
  // up as a real side bias in the simulator, so guard it deterministically here.
  describe('chaff/audit structural symmetry (fairness)', () => {
    const teamZones = (team: 'chaff' | 'audit') => ZONES.filter((z) => z.team === team)

    it('each side has the same per-type zone counts', () => {
      const byType = (team: 'chaff' | 'audit') => {
        const counts: Record<string, number> = {}
        for (const z of teamZones(team)) counts[z.type] = (counts[z.type] ?? 0) + 1
        return counts
      }
      expect(byType('chaff')).toEqual(byType('audit'))
    })

    it('the two halves have a mirrored adjacency-degree distribution', () => {
      const degrees = (team: 'chaff' | 'audit') =>
        teamZones(team)
          .map((z) => z.adjacentTo.length)
          .sort((a, b) => a - b)
      expect(degrees('chaff')).toEqual(degrees('audit'))
    })

    it('every chaff zone has a same-(type, degree) mirror on the audit side', () => {
      const sig = (z: (typeof ZONES)[number]) => `${z.type}:${z.adjacentTo.length}`
      expect(teamZones('chaff').map(sig).sort()).toEqual(teamZones('audit').map(sig).sort())
    })
  })
})

describe('shop zones are team-gated', () => {
  // REGRESSION: both bases became shops so a 430sc purchase stops costing ~9
  // near-inputless ticks — but a base is exactly where a breach happens, and a
  // bare `zone.shop` test let the attacker restock from the DEFENDER's shop
  // mid-fight.
  it('lets a team shop in its own base and fountain', () => {
    expect(isShopZoneFor('rookery-terminal', 'chaff')).toBe(true)
    expect(isShopZoneFor('rookery-anchor', 'chaff')).toBe(true)
    expect(isShopZoneFor('landing-terminal', 'audit')).toBe(true)
  })

  it('refuses the enemy shop', () => {
    expect(isShopZoneFor('landing-terminal', 'chaff')).toBe(false)
    expect(isShopZoneFor('rookery-terminal', 'audit')).toBe(false)
    expect(isShopZoneFor('landing-anchor', 'chaff')).toBe(false)
  })

  it('refuses a zone that is not a shop at all', () => {
    expect(isShopZoneFor('coldstore-cross', 'chaff')).toBe(false)
  })
})
