import { describe, it, expect } from 'vitest'
import { buildMapPrimerZones } from '../../../app/utils/mapPrimer'
import { ZONES } from '../../../shared/constants/zones'

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

  it('marks every tower zone with an alive tower on the right team + tier', () => {
    const towerZones = ZONES.filter((z) => z.tower)
    expect(towerZones.length).toBeGreaterThan(0)
    for (const z of towerZones) {
      const d = zones.find((x) => x.id === z.id)!
      expect(d.tower).toBeDefined()
      expect(d.tower!.alive).toBe(true)
      expect(d.tower!.team).toBe(z.team)
      expect(d.tower!.tier).toBe(z.tier ?? 1)
    }
  })

  it('leaves non-tower zones (fountain) without a tower', () => {
    expect(zones.find((z) => z.id === 'radiant-fountain')!.tower).toBeUndefined()
  })

  it('marks Roshan alive on the pit', () => {
    expect(zones.find((z) => z.id === 'roshan-pit')!.roshan).toEqual({ alive: true, respawnIn: 0 })
  })
})
