import { describe, it, expect } from 'vitest'
import {
  initializeZoneStates,
  initializeIce,
  placeWard,
  removeExpiredWards,
  canAttackIce,
} from '~~/server/game/map/zones'
import { ZONES, ZONE_IDS } from '~~/shared/constants/zones'
import {
  ICE_HP_T1,
  ICE_HP_T2,
  ICE_HP_T3,
  CAMTAP_DURATION_CYCLES,
  WARD_LIMIT_PER_TEAM,
} from '~~/shared/constants/balance'

describe('Zones', () => {
  describe('zone display names (R1 world lexicon)', () => {
    it('all 32 names are unique, non-empty, and free of the old vocabulary', () => {
      const names = ZONES.map((z) => z.name)
      expect(new Set(names).size).toBe(ZONES.length)
      for (const name of names) {
        expect(name.length).toBeGreaterThan(0)
        // Ids keep the old faction words until the R1-08 sweep — names never do.
        expect(name).not.toMatch(/jungle|tenant|river crossing| lane t/i)
      }
    })

    it('names are drawn from the lexicon: districts, routes, the Silt, the Hollow', () => {
      const byId = Object.fromEntries(ZONES.map((z) => [z.id, z.name]))
      // Districts host the two base+fountain pairs.
      expect(byId['chaff-base']).toBe('Rookery Terminal')
      expect(byId['audit-base']).toBe('Landing Terminal')
      // The three routes.
      expect(byId['top-t1-chaff']).toBe('Seawall T1 (CHAFF)')
      expect(byId['mid-t1-audit']).toBe('Coldstore T1 (AUDIT)')
      expect(byId['bot-t1-chaff']).toBe('Shallows T1 (CHAFF)')
      // Jungle is the Silt; the pit is the Hollow; cache spots are cache drops.
      expect(byId['silt-chaff-top']).toBe('Chaff Upper Silt')
      expect(byId['hollow']).toBe('The Hollow')
      expect(byId['cache-top']).toBe('Seawall Cache Drop')
    })
  })

  describe('initializeZoneStates', () => {
    it('creates a runtime state for every defined zone', () => {
      const states = initializeZoneStates()
      for (const id of ZONE_IDS) {
        expect(states[id]).toBeDefined()
        expect(states[id]!.id).toBe(id)
      }
    })

    it('initializes zones with empty wards', () => {
      const states = initializeZoneStates()
      for (const state of Object.values(states)) {
        expect(state.wards).toEqual([])
      }
    })

    it('creates the correct number of zone states', () => {
      const states = initializeZoneStates()
      expect(Object.keys(states).length).toBe(ZONES.length)
    })
  })

  describe('initializeIce', () => {
    it('creates ice only for zones with ice: true', () => {
      const ice = initializeIce()
      const iceZones = ZONES.filter((z) => z.ice)
      expect(ice.length).toBe(iceZones.length)
    })

    it('creates 18 ice total (3 lanes * 3 tiers * 2 teams)', () => {
      const ice = initializeIce()
      expect(ice.length).toBe(18)
    })

    it('assigns correct INTEG by tier', () => {
      const ice = initializeIce()
      const zoneMap = Object.fromEntries(ZONES.map((z) => [z.id, z]))
      for (const t of ice) {
        const tier = zoneMap[t.zone]?.tier
        if (tier === 1) {
          expect(t.integ).toBe(ICE_HP_T1)
          expect(t.maxInteg).toBe(ICE_HP_T1)
        } else if (tier === 2) {
          expect(t.integ).toBe(ICE_HP_T2)
          expect(t.maxInteg).toBe(ICE_HP_T2)
        } else if (tier === 3) {
          expect(t.integ).toBe(ICE_HP_T3)
          expect(t.maxInteg).toBe(ICE_HP_T3)
        }
      }
    })

    it('all ice start alive', () => {
      const ice = initializeIce()
      for (const t of ice) {
        expect(t.alive).toBe(true)
      }
    })

    it('assigns correct team to each ice', () => {
      const ice = initializeIce()
      for (const t of ice) {
        if (t.zone.endsWith('-chaff')) expect(t.team).toBe('chaff')
        else if (t.zone.endsWith('-audit')) expect(t.team).toBe('audit')
      }
    })

    it('each team has 9 ice (3 lanes * 3 tiers)', () => {
      const ice = initializeIce()
      const chaff = ice.filter((t) => t.team === 'chaff')
      const audit = ice.filter((t) => t.team === 'audit')
      expect(chaff.length).toBe(9)
      expect(audit.length).toBe(9)
    })
  })

  describe('placeWard', () => {
    it('places a ward in a valid zone', () => {
      const zones = initializeZoneStates()
      const result = placeWard(zones, 'mid-river', 'chaff', 10)
      expect(result).toBe(true)
      expect(zones['mid-river']!.wards).toHaveLength(1)
      expect(zones['mid-river']!.wards[0]!.team).toBe('chaff')
      expect(zones['mid-river']!.wards[0]!.placedTick).toBe(10)
      expect(zones['mid-river']!.wards[0]!.expiryTick).toBe(10 + CAMTAP_DURATION_CYCLES)
    })

    it('returns false for unknown zone', () => {
      const zones = initializeZoneStates()
      expect(placeWard(zones, 'nonexistent', 'chaff', 10)).toBe(false)
    })

    it('enforces ward limit per team', () => {
      const zones = initializeZoneStates()
      for (let i = 0; i < WARD_LIMIT_PER_TEAM; i++) {
        expect(placeWard(zones, 'mid-river', 'chaff', 10)).toBe(true)
      }
      // Next ward should fail
      expect(placeWard(zones, 'top-river', 'chaff', 10)).toBe(false)
    })

    it('tracks ward limits independently per team', () => {
      const zones = initializeZoneStates()
      for (let i = 0; i < WARD_LIMIT_PER_TEAM; i++) {
        expect(placeWard(zones, 'mid-river', 'chaff', 10)).toBe(true)
      }
      // Audit should still be able to place wards
      expect(placeWard(zones, 'mid-river', 'audit', 10)).toBe(true)
    })
  })

  describe('removeExpiredWards', () => {
    it('removes wards that have expired', () => {
      const zones = initializeZoneStates()
      placeWard(zones, 'mid-river', 'chaff', 10)
      expect(zones['mid-river']!.wards).toHaveLength(1)

      const updated = removeExpiredWards(zones, 10 + CAMTAP_DURATION_CYCLES + 1)
      expect(updated['mid-river']!.wards).toHaveLength(0)
    })

    it('keeps wards that have not expired', () => {
      const zones = initializeZoneStates()
      placeWard(zones, 'mid-river', 'chaff', 10)

      const updated = removeExpiredWards(zones, 10 + CAMTAP_DURATION_CYCLES - 1)
      expect(updated['mid-river']!.wards).toHaveLength(1)
    })

    it('removes ward at exactly expiry tick', () => {
      const zones = initializeZoneStates()
      placeWard(zones, 'mid-river', 'chaff', 10)

      // expiryTick = 10 + CAMTAP_DURATION_CYCLES. Filter keeps w.expiryTick > currentCycle
      const updated = removeExpiredWards(zones, 10 + CAMTAP_DURATION_CYCLES)
      expect(updated['mid-river']!.wards).toHaveLength(0)
    })
  })

  describe('canAttackIce', () => {
    it('T1 ice can always be attacked', () => {
      const ice = initializeIce()
      expect(canAttackIce(ice, 'mid-t1-chaff')).toBe(true)
      expect(canAttackIce(ice, 'top-t1-audit')).toBe(true)
    })

    it('T2 cannot be attacked while T1 is alive', () => {
      const ice = initializeIce()
      expect(canAttackIce(ice, 'mid-t2-chaff')).toBe(false)
    })

    it('T2 can be attacked when T1 is destroyed', () => {
      const ice = initializeIce()
      const t1 = ice.find((t) => t.zone === 'mid-t1-chaff')!
      t1.alive = false
      t1.integ = 0
      expect(canAttackIce(ice, 'mid-t2-chaff')).toBe(true)
    })

    it('T3 cannot be attacked while T2 is alive', () => {
      const ice = initializeIce()
      // Destroy T1
      const t1 = ice.find((t) => t.zone === 'mid-t1-chaff')!
      t1.alive = false
      expect(canAttackIce(ice, 'mid-t3-chaff')).toBe(false)
    })

    it('T3 can be attacked when T2 is destroyed', () => {
      const ice = initializeIce()
      const t1 = ice.find((t) => t.zone === 'mid-t1-chaff')!
      const t2 = ice.find((t) => t.zone === 'mid-t2-chaff')!
      t1.alive = false
      t2.alive = false
      expect(canAttackIce(ice, 'mid-t3-chaff')).toBe(true)
    })

    it('returns false for a dead ice', () => {
      const ice = initializeIce()
      const t1 = ice.find((t) => t.zone === 'mid-t1-chaff')!
      t1.alive = false
      expect(canAttackIce(ice, 'mid-t1-chaff')).toBe(false)
    })

    it('returns false for zones without ice', () => {
      const ice = initializeIce()
      expect(canAttackIce(ice, 'mid-river')).toBe(false)
      expect(canAttackIce(ice, 'chaff-base')).toBe(false)
    })
  })

  describe('zone tier and lane fields', () => {
    it('every ice zone has a tier field', () => {
      const iceZones = ZONES.filter((z) => z.ice)
      for (const z of iceZones) {
        expect(z.tier).toBeDefined()
        expect([1, 2, 3]).toContain(z.tier)
      }
    })

    it('every ice zone has a lane field', () => {
      const iceZones = ZONES.filter((z) => z.ice)
      for (const z of iceZones) {
        expect(z.lane).toBeDefined()
        expect(['top', 'mid', 'bot']).toContain(z.lane)
      }
    })

    it('tier field matches the zone ID convention', () => {
      const iceZones = ZONES.filter((z) => z.ice)
      for (const z of iceZones) {
        const idTier = z.id.includes('-t1-')
          ? 1
          : z.id.includes('-t2-')
            ? 2
            : z.id.includes('-t3-')
              ? 3
              : null
        expect(z.tier).toBe(idTier)
      }
    })

    it('non-ice zones do not have a tier field', () => {
      const nonIceZones = ZONES.filter((z) => !z.ice)
      for (const z of nonIceZones) {
        expect(z.tier).toBeUndefined()
      }
    })

    it('river crossing zones have a lane field', () => {
      const riverZones = ZONES.filter((z) => z.type === 'river' && z.lane)
      expect(riverZones.length).toBe(3) // top-river, mid-river, bot-river
      for (const z of riverZones) {
        expect(z.lane).toBe(z.id.split('-')[0])
      }
    })
  })
})
