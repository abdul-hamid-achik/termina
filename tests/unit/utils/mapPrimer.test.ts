import { describe, it, expect } from 'vitest'
import { buildMapPrimerZones } from '~~/app/utils/mapPrimer'
import { ZONES } from '~~/shared/constants/zones'

describe('buildMapPrimerZones', () => {
  const zones = buildMapPrimerZones()

  it('includes every canonical zone, fully revealed + unoccupied', () => {
    expect(zones).toHaveLength(ZONES.length)
    expect(new Set(zones.map((z) => z.id))).toEqual(new Set(ZONES.map((z) => z.id)))
    for (const z of zones) {
      expect(z.fogged).toBe(false)
      expect(z.playerHere).toBe(false)
      expect(z.allies).toEqual([])
      expect(z.enemyCount).toBe(0)
    }
  })

  it('marks every ice zone with an alive ice on the right team + tier', () => {
    const iceZones = ZONES.filter((z) => z.ice)
    expect(iceZones.length).toBeGreaterThan(0)
    for (const z of iceZones) {
      const d = zones.find((x) => x.id === z.id)!
      expect(d.ice).toBeDefined()
      expect(d.ice!.alive).toBe(true)
      expect(d.ice!.team).toBe(z.team)
      expect(d.ice!.tier).toBe(z.tier ?? 1)
    }
  })

  it('leaves non-ice zones (fountain) without a ice', () => {
    expect(zones.find((z) => z.id === 'chaff-fountain')!.ice).toBeUndefined()
  })

  it('marks Tenant alive on the pit', () => {
    expect(zones.find((z) => z.id === 'hollow')!.tenant).toEqual({ alive: true, respawnIn: 0 })
  })
})
