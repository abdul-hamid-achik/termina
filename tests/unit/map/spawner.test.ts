import { describe, it, expect, beforeEach } from 'vitest'
import {
  spawnWaveUnits,
  resetWaveIdCounter,
  spawnCaches,
  initializeTenant,
  shouldTenantRespawn,
  respawnTenant,
} from '~~/server/game/map/spawner'
import { zonesForMap, ONE_LANE_MAP_ID, TWO_LANE_MAP_ID } from '~~/shared/constants/maps'
import {
  WAVE_INTERVAL_CYCLES,
  LINE_UNITS_PER_WAVE,
  SWEEP_UNITS_PER_WAVE,
  BREACH_WAVE_INTERVAL,
  LINE_UNIT_HP,
  SWEEP_UNIT_HP,
  BREACH_UNIT_HP,
  WAVE_ESCALATION_INTERVAL_CYCLES,
  waveUnitMaxHp,
  TENANT_RESPAWN_CYCLES,
  TENANT_BASE_HP,
  CACHE_INTERVAL_CYCLES,
  CACHE_DURATION_CYCLES,
} from '~~/shared/constants/balance'

describe('Spawner', () => {
  beforeEach(() => {
    resetWaveIdCounter()
  })

  describe('spawnWaveUnits', () => {
    it('does not spawn waves at cycle 0', () => {
      expect(spawnWaveUnits(0)).toEqual([])
    })

    it('does not spawn waves on non-wave ticks', () => {
      expect(spawnWaveUnits(1)).toEqual([])
      expect(spawnWaveUnits(3)).toEqual([])
      expect(spawnWaveUnits(WAVE_INTERVAL_CYCLES - 1)).toEqual([])
    })

    it('spawns waves at the first wave tick', () => {
      const waves = spawnWaveUnits(WAVE_INTERVAL_CYCLES)
      expect(waves.length).toBeGreaterThan(0)
    })

    it('spawns correct number of waves per wave (no breach)', () => {
      const waves = spawnWaveUnits(WAVE_INTERVAL_CYCLES)
      // 3 lanes * 2 teams * (3 line + 1 sweep) = 24
      const expectedPerWave = 3 * 2 * (LINE_UNITS_PER_WAVE + SWEEP_UNITS_PER_WAVE)
      expect(waves.length).toBe(expectedPerWave)
    })

    it('spawns breach waves on breach wave intervals', () => {
      const breachWaveTick = WAVE_INTERVAL_CYCLES * BREACH_WAVE_INTERVAL
      const waves = spawnWaveUnits(breachWaveTick)
      // 3 lanes * 2 teams * (3 line + 1 sweep + 1 breach) = 30
      const expectedWithBreach = 3 * 2 * (LINE_UNITS_PER_WAVE + SWEEP_UNITS_PER_WAVE + 1)
      expect(waves.length).toBe(expectedWithBreach)
    })

    it('does not spawn breach waves on non-breach waves', () => {
      const waves = spawnWaveUnits(WAVE_INTERVAL_CYCLES)
      const breachWaves = waves.filter((c) => c.type === 'breach')
      expect(breachWaves.length).toBe(0)
    })

    it('assigns correct INTEG to each wave type', () => {
      const breachWaveTick = WAVE_INTERVAL_CYCLES * BREACH_WAVE_INTERVAL
      const waves = spawnWaveUnits(breachWaveTick)

      for (const c of waves) {
        if (c.type === 'line') expect(c.integ).toBe(LINE_UNIT_HP)
        else if (c.type === 'sweep') expect(c.integ).toBe(SWEEP_UNIT_HP)
        else if (c.type === 'breach') expect(c.integ).toBe(BREACH_UNIT_HP)
      }
    })

    it('spawns escalated waves once the game is past the first interval', () => {
      // First wave cycle at or after two full escalation intervals.
      const cycle =
        Math.ceil((WAVE_ESCALATION_INTERVAL_CYCLES * 2) / WAVE_INTERVAL_CYCLES) *
        WAVE_INTERVAL_CYCLES
      const waves = spawnWaveUnits(cycle)

      expect(waves.length).toBeGreaterThan(0)
      for (const c of waves) {
        expect(c.integ).toBe(waveUnitMaxHp(c.type, cycle))
      }
      const line = waves.find((c) => c.type === 'line')!
      expect(line.integ).toBeGreaterThan(LINE_UNIT_HP)
    })

    it('waves keep the INTEG of the cycle they spawned on, so late waves are tougher', () => {
      const earlyTick = WAVE_INTERVAL_CYCLES
      const lateTick =
        Math.ceil((WAVE_ESCALATION_INTERVAL_CYCLES * 3) / WAVE_INTERVAL_CYCLES) *
        WAVE_INTERVAL_CYCLES
      const early = spawnWaveUnits(earlyTick).find((c) => c.type === 'line')!
      const late = spawnWaveUnits(lateTick).find((c) => c.type === 'line')!

      expect(early.integ).toBe(LINE_UNIT_HP)
      expect(late.integ).toBeGreaterThan(early.integ)
    })

    it('assigns unique IDs to each wave', () => {
      const waves = spawnWaveUnits(WAVE_INTERVAL_CYCLES)
      const ids = waves.map((c) => c.id)
      expect(new Set(ids).size).toBe(ids.length)
    })

    it('spawns waves for both teams', () => {
      const waves = spawnWaveUnits(WAVE_INTERVAL_CYCLES)
      const chaff = waves.filter((c) => c.team === 'chaff')
      const audit = waves.filter((c) => c.team === 'audit')
      expect(chaff.length).toBe(audit.length)
      expect(chaff.length).toBeGreaterThan(0)
    })

    it('spawns waves in correct spawn zones', () => {
      const waves = spawnWaveUnits(WAVE_INTERVAL_CYCLES)
      const chaffZones = new Set(waves.filter((c) => c.team === 'chaff').map((c) => c.zone))
      const auditZones = new Set(waves.filter((c) => c.team === 'audit').map((c) => c.zone))

      expect(chaffZones).toContain('seawall-t3-chaff')
      expect(chaffZones).toContain('coldstore-t3-chaff')
      expect(chaffZones).toContain('shallows-t3-chaff')
      expect(auditZones).toContain('seawall-t3-audit')
      expect(auditZones).toContain('coldstore-t3-audit')
      expect(auditZones).toContain('shallows-t3-audit')
    })

    it('spawns waves on consecutive wave ticks', () => {
      const wave1 = spawnWaveUnits(WAVE_INTERVAL_CYCLES)
      const wave2 = spawnWaveUnits(WAVE_INTERVAL_CYCLES * 2)
      expect(wave1.length).toBeGreaterThan(0)
      expect(wave2.length).toBeGreaterThan(0)
      // IDs should not overlap
      const ids1 = new Set(wave1.map((c) => c.id))
      for (const c of wave2) {
        expect(ids1.has(c.id)).toBe(false)
      }
    })
  })

  describe('spawnCaches', () => {
    it('does not spawn caches at cycle 0', () => {
      expect(spawnCaches(0)).toEqual([])
    })

    it('does not spawn caches on non-cache ticks', () => {
      expect(spawnCaches(1)).toEqual([])
      expect(spawnCaches(30)).toEqual([])
      expect(spawnCaches(59)).toEqual([])
    })

    it('spawns caches at cache interval (cycle 60)', () => {
      const caches = spawnCaches(60)
      expect(caches).toHaveLength(2)
    })

    it('spawns caches at correct zones', () => {
      const caches = spawnCaches(60)
      const zones = caches.map((r) => r.zone)
      expect(zones).toContain('cache-seawall')
      expect(zones).toContain('cache-shallows')
    })

    it('cache types are valid', () => {
      const validTypes = ['haste', 'dd', 'regen', 'arcane', 'invis']
      const caches = spawnCaches(60)
      for (const r of caches) {
        expect(validTypes).toContain(r.type)
      }
    })

    it('a cache always expires before the next spawn (no stacking at a zone)', () => {
      // spawnCaches has a defensive occupancy check (activeCaches param) that skips
      // re-spawning on an occupied spot, but the primary no-stacking guarantee
      // rests on this relationship: an unclaimed cache (lifetime CACHE_DURATION_CYCLES)
      // must be gone before the next spawn (CACHE_INTERVAL_CYCLES). If a future
      // balance change lifts the duration past the interval, caches would pile up
      // at a zone — this test trips first.
      expect(CACHE_DURATION_CYCLES).toBeLessThan(CACHE_INTERVAL_CYCLES)
    })

    it('caches record the spawn tick', () => {
      const caches = spawnCaches(120)
      for (const r of caches) {
        expect(r.cycle).toBe(120)
      }
    })

    it('does not spawn a cache on an occupied zone (occupancy check)', () => {
      const active = new Set(['cache-seawall'])
      const caches = spawnCaches(60, undefined, active)
      // cache-seawall is occupied → only cache-shallows should spawn
      expect(caches).toHaveLength(1)
      expect(caches[0]!.zone).toBe('cache-shallows')
    })

    it('does not spawn caches when all spots are occupied', () => {
      const active = new Set(['cache-seawall', 'cache-shallows'])
      const caches = spawnCaches(60, undefined, active)
      expect(caches).toEqual([])
    })
  })

  // The spawner gates lane/cache spawns on a game's live zone set via the
  // `hasZone` callback. On a subset map (one-lane, two-lane) a lane whose spawn
  // zones aren't in the game must be skipped entirely, or waves would be
  // placed in zones that don't exist on this map.
  describe('subset-map spawning (hasZone gating)', () => {
    function hasZoneFor(mapId: string): (zoneId: string) => boolean {
      const ids = new Set(zonesForMap(mapId).map((z) => z.id))
      return (zoneId: string) => ids.has(zoneId)
    }

    it('one-lane map: spawns only Coldstore waves (no Seawall or Shallows)', () => {
      const hasZone = hasZoneFor(ONE_LANE_MAP_ID)
      const waves = spawnWaveUnits(WAVE_INTERVAL_CYCLES, hasZone)
      // Only mid lane — 3 line + 1 sweep per team = 8 waves.
      expect(waves).toHaveLength((LINE_UNITS_PER_WAVE + SWEEP_UNITS_PER_WAVE) * 2)
      for (const c of waves) {
        expect(c.zone).toMatch(/^coldstore-t3-(chaff|audit)$/)
      }
    })

    it('one-lane map: spawns no caches (both cache spots are absent)', () => {
      const hasZone = hasZoneFor(ONE_LANE_MAP_ID)
      const caches = spawnCaches(CACHE_INTERVAL_CYCLES, hasZone)
      expect(caches).toEqual([])
    })

    it('two-lane map: spawns top + mid waves (no bot)', () => {
      const hasZone = hasZoneFor(TWO_LANE_MAP_ID)
      const waves = spawnWaveUnits(WAVE_INTERVAL_CYCLES, hasZone)
      // Top + mid lanes — 2 lanes × 2 teams × (3 line + 1 sweep) = 16 waves.
      expect(waves).toHaveLength((LINE_UNITS_PER_WAVE + SWEEP_UNITS_PER_WAVE) * 2 * 2)
      for (const c of waves) {
        expect(c.zone).not.toMatch(/^bot-/)
      }
    })

    it('two-lane map: spawns only cache-seawall (cache-shallows is absent)', () => {
      const hasZone = hasZoneFor(TWO_LANE_MAP_ID)
      const caches = spawnCaches(CACHE_INTERVAL_CYCLES, hasZone)
      expect(caches).toHaveLength(1)
      expect(caches[0]!.zone).toBe('cache-seawall')
    })
  })

  describe('Tenant', () => {
    describe('initializeTenant', () => {
      it('starts alive with full INTEG', () => {
        const rosh = initializeTenant()
        expect(rosh.alive).toBe(true)
        expect(rosh.integ).toBe(TENANT_BASE_HP)
        expect(rosh.maxInteg).toBe(TENANT_BASE_HP)
        expect(rosh.deathCycle).toBeNull()
      })
    })

    describe('shouldTenantRespawn', () => {
      it('returns false when Tenant is alive', () => {
        const rosh = initializeTenant()
        expect(shouldTenantRespawn(rosh, 1000)).toBe(false)
      })

      it('returns false when deathCycle is null', () => {
        const rosh = { alive: false, integ: 0, maxInteg: TENANT_BASE_HP, deathCycle: null }
        expect(shouldTenantRespawn(rosh, 1000)).toBe(false)
      })

      it('returns false before respawn time', () => {
        const rosh = { alive: false, integ: 0, maxInteg: TENANT_BASE_HP, deathCycle: 100 }
        expect(shouldTenantRespawn(rosh, 100 + TENANT_RESPAWN_CYCLES - 1)).toBe(false)
      })

      it('returns true at exactly respawn time', () => {
        const rosh = { alive: false, integ: 0, maxInteg: TENANT_BASE_HP, deathCycle: 100 }
        expect(shouldTenantRespawn(rosh, 100 + TENANT_RESPAWN_CYCLES)).toBe(true)
      })

      it('returns true after respawn time', () => {
        const rosh = { alive: false, integ: 0, maxInteg: TENANT_BASE_HP, deathCycle: 100 }
        expect(shouldTenantRespawn(rosh, 100 + TENANT_RESPAWN_CYCLES + 50)).toBe(true)
      })
    })

    describe('respawnTenant', () => {
      it('restores alive status and full INTEG', () => {
        const dead = { alive: false, integ: 0, maxInteg: TENANT_BASE_HP, deathCycle: 100 }
        const respawned = respawnTenant(dead, 0)
        expect(respawned.alive).toBe(true)
        expect(respawned.integ).toBe(TENANT_BASE_HP)
        expect(respawned.deathCycle).toBeNull()
      })

      it('scales maxInteg with minutes elapsed', () => {
        const dead = { alive: false, integ: 0, maxInteg: TENANT_BASE_HP, deathCycle: 100 }
        // 150 ticks * 4s = 600s = 10 minutes
        const respawned = respawnTenant(dead, 150)
        expect(respawned.integ).toBe(TENANT_BASE_HP + 10 * 100)
        expect(respawned.maxInteg).toBe(TENANT_BASE_HP + 10 * 100)
      })
    })
  })
})
