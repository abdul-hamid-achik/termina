import { describe, it, expect, beforeEach } from 'vitest'
import {
  spawnCreepWaves,
  resetCreepIdCounter,
  spawnRunes,
  initializeRoshan,
  shouldRoshanRespawn,
  respawnRoshan,
} from '../../../server/game/map/spawner'
import { zonesForMap, ONE_LANE_MAP_ID, TWO_LANE_MAP_ID } from '../../../shared/constants/maps'
import {
  CREEP_WAVE_INTERVAL_TICKS,
  MELEE_CREEPS_PER_WAVE,
  RANGED_CREEPS_PER_WAVE,
  SIEGE_CREEP_WAVE_INTERVAL,
  MELEE_CREEP_HP,
  RANGED_CREEP_HP,
  SIEGE_CREEP_HP,
  ROSHAN_RESPAWN_TICKS,
  ROSHAN_BASE_HP,
  RUNE_INTERVAL_TICKS,
  RUNE_DURATION_TICKS,
} from '../../../shared/constants/balance'

describe('Spawner', () => {
  beforeEach(() => {
    resetCreepIdCounter()
  })

  describe('spawnCreepWaves', () => {
    it('does not spawn creeps at tick 0', () => {
      expect(spawnCreepWaves(0)).toEqual([])
    })

    it('does not spawn creeps on non-wave ticks', () => {
      expect(spawnCreepWaves(1)).toEqual([])
      expect(spawnCreepWaves(3)).toEqual([])
      expect(spawnCreepWaves(CREEP_WAVE_INTERVAL_TICKS - 1)).toEqual([])
    })

    it('spawns creeps at the first wave tick', () => {
      const creeps = spawnCreepWaves(CREEP_WAVE_INTERVAL_TICKS)
      expect(creeps.length).toBeGreaterThan(0)
    })

    it('spawns correct number of creeps per wave (no siege)', () => {
      const creeps = spawnCreepWaves(CREEP_WAVE_INTERVAL_TICKS)
      // 3 lanes * 2 teams * (3 melee + 1 ranged) = 24
      const expectedPerWave = 3 * 2 * (MELEE_CREEPS_PER_WAVE + RANGED_CREEPS_PER_WAVE)
      expect(creeps.length).toBe(expectedPerWave)
    })

    it('spawns siege creeps on siege wave intervals', () => {
      const siegeWaveTick = CREEP_WAVE_INTERVAL_TICKS * SIEGE_CREEP_WAVE_INTERVAL
      const creeps = spawnCreepWaves(siegeWaveTick)
      // 3 lanes * 2 teams * (3 melee + 1 ranged + 1 siege) = 30
      const expectedWithSiege = 3 * 2 * (MELEE_CREEPS_PER_WAVE + RANGED_CREEPS_PER_WAVE + 1)
      expect(creeps.length).toBe(expectedWithSiege)
    })

    it('does not spawn siege creeps on non-siege waves', () => {
      const creeps = spawnCreepWaves(CREEP_WAVE_INTERVAL_TICKS)
      const siegeCreeps = creeps.filter((c) => c.type === 'siege')
      expect(siegeCreeps.length).toBe(0)
    })

    it('assigns correct HP to each creep type', () => {
      const siegeWaveTick = CREEP_WAVE_INTERVAL_TICKS * SIEGE_CREEP_WAVE_INTERVAL
      const creeps = spawnCreepWaves(siegeWaveTick)

      for (const c of creeps) {
        if (c.type === 'melee') expect(c.hp).toBe(MELEE_CREEP_HP)
        else if (c.type === 'ranged') expect(c.hp).toBe(RANGED_CREEP_HP)
        else if (c.type === 'siege') expect(c.hp).toBe(SIEGE_CREEP_HP)
      }
    })

    it('assigns unique IDs to each creep', () => {
      const creeps = spawnCreepWaves(CREEP_WAVE_INTERVAL_TICKS)
      const ids = creeps.map((c) => c.id)
      expect(new Set(ids).size).toBe(ids.length)
    })

    it('spawns creeps for both teams', () => {
      const creeps = spawnCreepWaves(CREEP_WAVE_INTERVAL_TICKS)
      const radiant = creeps.filter((c) => c.team === 'radiant')
      const dire = creeps.filter((c) => c.team === 'dire')
      expect(radiant.length).toBe(dire.length)
      expect(radiant.length).toBeGreaterThan(0)
    })

    it('spawns creeps in correct spawn zones', () => {
      const creeps = spawnCreepWaves(CREEP_WAVE_INTERVAL_TICKS)
      const radiantZones = new Set(creeps.filter((c) => c.team === 'radiant').map((c) => c.zone))
      const direZones = new Set(creeps.filter((c) => c.team === 'dire').map((c) => c.zone))

      expect(radiantZones).toContain('top-t3-rad')
      expect(radiantZones).toContain('mid-t3-rad')
      expect(radiantZones).toContain('bot-t3-rad')
      expect(direZones).toContain('top-t3-dire')
      expect(direZones).toContain('mid-t3-dire')
      expect(direZones).toContain('bot-t3-dire')
    })

    it('spawns creeps on consecutive wave ticks', () => {
      const wave1 = spawnCreepWaves(CREEP_WAVE_INTERVAL_TICKS)
      const wave2 = spawnCreepWaves(CREEP_WAVE_INTERVAL_TICKS * 2)
      expect(wave1.length).toBeGreaterThan(0)
      expect(wave2.length).toBeGreaterThan(0)
      // IDs should not overlap
      const ids1 = new Set(wave1.map((c) => c.id))
      for (const c of wave2) {
        expect(ids1.has(c.id)).toBe(false)
      }
    })
  })

  describe('spawnRunes', () => {
    it('does not spawn runes at tick 0', () => {
      expect(spawnRunes(0)).toEqual([])
    })

    it('does not spawn runes on non-rune ticks', () => {
      expect(spawnRunes(1)).toEqual([])
      expect(spawnRunes(30)).toEqual([])
      expect(spawnRunes(59)).toEqual([])
    })

    it('spawns runes at rune interval (tick 60)', () => {
      const runes = spawnRunes(60)
      expect(runes).toHaveLength(2)
    })

    it('spawns runes at correct zones', () => {
      const runes = spawnRunes(60)
      const zones = runes.map((r) => r.zone)
      expect(zones).toContain('rune-top')
      expect(zones).toContain('rune-bot')
    })

    it('rune types are valid', () => {
      const validTypes = ['haste', 'dd', 'regen', 'arcane', 'invis']
      const runes = spawnRunes(60)
      for (const r of runes) {
        expect(validTypes).toContain(r.type)
      }
    })

    it('a rune always expires before the next spawn (no stacking at a zone)', () => {
      // spawnRunes has a defensive occupancy check (activeRunes param) that skips
      // re-spawning on an occupied spot, but the primary no-stacking guarantee
      // rests on this relationship: an unclaimed rune (lifetime RUNE_DURATION_TICKS)
      // must be gone before the next spawn (RUNE_INTERVAL_TICKS). If a future
      // balance change lifts the duration past the interval, runes would pile up
      // at a zone — this test trips first.
      expect(RUNE_DURATION_TICKS).toBeLessThan(RUNE_INTERVAL_TICKS)
    })

    it('runes record the spawn tick', () => {
      const runes = spawnRunes(120)
      for (const r of runes) {
        expect(r.tick).toBe(120)
      }
    })

    it('does not spawn a rune on an occupied zone (occupancy check)', () => {
      const active = new Set(['rune-top'])
      const runes = spawnRunes(60, undefined, active)
      // rune-top is occupied → only rune-bot should spawn
      expect(runes).toHaveLength(1)
      expect(runes[0]!.zone).toBe('rune-bot')
    })

    it('does not spawn runes when all spots are occupied', () => {
      const active = new Set(['rune-top', 'rune-bot'])
      const runes = spawnRunes(60, undefined, active)
      expect(runes).toEqual([])
    })
  })

  // The spawner gates lane/rune spawns on a game's live zone set via the
  // `hasZone` callback. On a subset map (one-lane, two-lane) a lane whose spawn
  // zones aren't in the game must be skipped entirely, or creeps would be
  // placed in zones that don't exist on this map.
  describe('subset-map spawning (hasZone gating)', () => {
    function hasZoneFor(mapId: string): (zoneId: string) => boolean {
      const ids = new Set(zonesForMap(mapId).map((z) => z.id))
      return (zoneId: string) => ids.has(zoneId)
    }

    it('one-lane map: spawns only mid-lane creeps (no top or bot)', () => {
      const hasZone = hasZoneFor(ONE_LANE_MAP_ID)
      const creeps = spawnCreepWaves(CREEP_WAVE_INTERVAL_TICKS, hasZone)
      // Only mid lane — 3 melee + 1 ranged per team = 8 creeps.
      expect(creeps).toHaveLength((MELEE_CREEPS_PER_WAVE + RANGED_CREEPS_PER_WAVE) * 2)
      for (const c of creeps) {
        expect(c.zone).toMatch(/^mid-t3-(rad|dire)$/)
      }
    })

    it('one-lane map: spawns no runes (both rune spots are absent)', () => {
      const hasZone = hasZoneFor(ONE_LANE_MAP_ID)
      const runes = spawnRunes(RUNE_INTERVAL_TICKS, hasZone)
      expect(runes).toEqual([])
    })

    it('two-lane map: spawns top + mid creeps (no bot)', () => {
      const hasZone = hasZoneFor(TWO_LANE_MAP_ID)
      const creeps = spawnCreepWaves(CREEP_WAVE_INTERVAL_TICKS, hasZone)
      // Top + mid lanes — 2 lanes × 2 teams × (3 melee + 1 ranged) = 16 creeps.
      expect(creeps).toHaveLength((MELEE_CREEPS_PER_WAVE + RANGED_CREEPS_PER_WAVE) * 2 * 2)
      for (const c of creeps) {
        expect(c.zone).not.toMatch(/^bot-/)
      }
    })

    it('two-lane map: spawns only rune-top (rune-bot is absent)', () => {
      const hasZone = hasZoneFor(TWO_LANE_MAP_ID)
      const runes = spawnRunes(RUNE_INTERVAL_TICKS, hasZone)
      expect(runes).toHaveLength(1)
      expect(runes[0]!.zone).toBe('rune-top')
    })
  })

  describe('Roshan', () => {
    describe('initializeRoshan', () => {
      it('starts alive with full HP', () => {
        const rosh = initializeRoshan()
        expect(rosh.alive).toBe(true)
        expect(rosh.hp).toBe(ROSHAN_BASE_HP)
        expect(rosh.maxHp).toBe(ROSHAN_BASE_HP)
        expect(rosh.deathTick).toBeNull()
      })
    })

    describe('shouldRoshanRespawn', () => {
      it('returns false when Roshan is alive', () => {
        const rosh = initializeRoshan()
        expect(shouldRoshanRespawn(rosh, 1000)).toBe(false)
      })

      it('returns false when deathTick is null', () => {
        const rosh = { alive: false, hp: 0, maxHp: ROSHAN_BASE_HP, deathTick: null }
        expect(shouldRoshanRespawn(rosh, 1000)).toBe(false)
      })

      it('returns false before respawn time', () => {
        const rosh = { alive: false, hp: 0, maxHp: ROSHAN_BASE_HP, deathTick: 100 }
        expect(shouldRoshanRespawn(rosh, 100 + ROSHAN_RESPAWN_TICKS - 1)).toBe(false)
      })

      it('returns true at exactly respawn time', () => {
        const rosh = { alive: false, hp: 0, maxHp: ROSHAN_BASE_HP, deathTick: 100 }
        expect(shouldRoshanRespawn(rosh, 100 + ROSHAN_RESPAWN_TICKS)).toBe(true)
      })

      it('returns true after respawn time', () => {
        const rosh = { alive: false, hp: 0, maxHp: ROSHAN_BASE_HP, deathTick: 100 }
        expect(shouldRoshanRespawn(rosh, 100 + ROSHAN_RESPAWN_TICKS + 50)).toBe(true)
      })
    })

    describe('respawnRoshan', () => {
      it('restores alive status and full HP', () => {
        const dead = { alive: false, hp: 0, maxHp: ROSHAN_BASE_HP, deathTick: 100 }
        const respawned = respawnRoshan(dead, 0)
        expect(respawned.alive).toBe(true)
        expect(respawned.hp).toBe(ROSHAN_BASE_HP)
        expect(respawned.deathTick).toBeNull()
      })

      it('scales maxHp with minutes elapsed', () => {
        const dead = { alive: false, hp: 0, maxHp: ROSHAN_BASE_HP, deathTick: 100 }
        // 150 ticks * 4s = 600s = 10 minutes
        const respawned = respawnRoshan(dead, 150)
        expect(respawned.hp).toBe(ROSHAN_BASE_HP + 10 * 100)
        expect(respawned.maxHp).toBe(ROSHAN_BASE_HP + 10 * 100)
      })
    })
  })
})
