import { describe, it, expect } from 'vitest'
import { ZONES, ZONE_MAP, ZONE_IDS } from '../../../shared/constants/zones'

describe('Zone Constants', () => {
  describe('zone count and structure', () => {
    it('has the expected total number of zones', () => {
      // 2 bases + 2 fountains + 18 lane + 4 jungle + 5 river + 1 objective = 32
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
      const fountains = ZONES.filter((z) => z.type === 'fountain')
      expect(fountains).toHaveLength(2)
    })

    it('has exactly 2 base zones', () => {
      const bases = ZONES.filter((z) => z.type === 'base')
      expect(bases).toHaveLength(2)
    })

    it('has exactly 18 lane zones (3 lanes * 3 tiers * 2 teams)', () => {
      const lanes = ZONES.filter((z) => z.type === 'lane')
      expect(lanes).toHaveLength(18)
    })

    it('has exactly 4 jungle zones', () => {
      const jungles = ZONES.filter((z) => z.type === 'jungle')
      expect(jungles).toHaveLength(4)
    })

    it('has exactly 5 river zones', () => {
      const rivers = ZONES.filter((z) => z.type === 'river')
      expect(rivers).toHaveLength(5)
    })

    it('has exactly 1 objective zone (roshan-pit)', () => {
      const objectives = ZONES.filter((z) => z.type === 'objective')
      expect(objectives).toHaveLength(1)
      expect(objectives[0]!.id).toBe('roshan-pit')
    })
  })

  describe('team assignment', () => {
    it('each base belongs to a team', () => {
      const radiantBase = ZONE_MAP['radiant-base']
      const direBase = ZONE_MAP['dire-base']
      expect(radiantBase!.team).toBe('radiant')
      expect(direBase!.team).toBe('dire')
    })

    it('each fountain belongs to a team', () => {
      expect(ZONE_MAP['radiant-fountain']!.team).toBe('radiant')
      expect(ZONE_MAP['dire-fountain']!.team).toBe('dire')
    })

    it('river zones are neutral', () => {
      const rivers = ZONES.filter((z) => z.type === 'river')
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
      const lanes = ZONES.filter((z) => z.type === 'lane')
      for (const l of lanes) {
        if (l.id.endsWith('-rad')) expect(l.team).toBe('radiant')
        else if (l.id.endsWith('-dire')) expect(l.team).toBe('dire')
      }
    })

    it('radiant and dire have same number of team zones', () => {
      const radiantCount = ZONES.filter((z) => z.team === 'radiant').length
      const direCount = ZONES.filter((z) => z.team === 'dire').length
      expect(radiantCount).toBe(direCount)
    })
  })

  describe('shop zones', () => {
    it('only fountains have shops', () => {
      const shops = ZONES.filter((z) => z.shop)
      expect(shops).toHaveLength(2)
      expect(shops.map((s) => s.id).sort()).toEqual(['dire-fountain', 'radiant-fountain'])
    })
  })

  describe('tower zones', () => {
    it('all lane zones have towers', () => {
      const lanes = ZONES.filter((z) => z.type === 'lane')
      for (const l of lanes) {
        expect(l.tower).toBe(true)
      }
    })

    it('non-lane zones do not have towers', () => {
      const nonLanes = ZONES.filter((z) => z.type !== 'lane')
      for (const z of nonLanes) {
        expect(z.tower).toBe(false)
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
    it('roshan pit is reachable only from rune-top', () => {
      const rosh = ZONE_MAP['roshan-pit']!
      expect(rosh.adjacentTo).toEqual(['rune-top'])
    })

    it('rune spots connect to river crossings and jungles', () => {
      const runeTop = ZONE_MAP['rune-top']!
      expect(runeTop.adjacentTo).toContain('top-river')
      expect(runeTop.adjacentTo).toContain('mid-river')
      expect(runeTop.adjacentTo).toContain('jungle-rad-top')
      expect(runeTop.adjacentTo).toContain('jungle-dire-top')

      const runeBot = ZONE_MAP['rune-bot']!
      expect(runeBot.adjacentTo).toContain('bot-river')
      expect(runeBot.adjacentTo).toContain('mid-river')
      expect(runeBot.adjacentTo).toContain('jungle-rad-bot')
      expect(runeBot.adjacentTo).toContain('jungle-dire-bot')
    })

    it('fountains connect only to their base', () => {
      expect(ZONE_MAP['radiant-fountain']!.adjacentTo).toEqual(['radiant-base'])
      expect(ZONE_MAP['dire-fountain']!.adjacentTo).toEqual(['dire-base'])
    })

    it('bases connect to fountain and all three T3 zones', () => {
      const radBase = ZONE_MAP['radiant-base']!
      expect(radBase.adjacentTo).toContain('radiant-fountain')
      expect(radBase.adjacentTo).toContain('top-t3-rad')
      expect(radBase.adjacentTo).toContain('mid-t3-rad')
      expect(radBase.adjacentTo).toContain('bot-t3-rad')
      expect(radBase.adjacentTo).toHaveLength(4)

      const direBase = ZONE_MAP['dire-base']!
      expect(direBase.adjacentTo).toContain('dire-fountain')
      expect(direBase.adjacentTo).toContain('top-t3-dire')
      expect(direBase.adjacentTo).toContain('mid-t3-dire')
      expect(direBase.adjacentTo).toContain('bot-t3-dire')
      expect(direBase.adjacentTo).toHaveLength(4)
    })
  })
})
