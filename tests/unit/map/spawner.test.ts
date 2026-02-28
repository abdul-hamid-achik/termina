import { describe, it, expect, beforeEach } from 'vitest'
import {
  spawnCreepWaves,
  resetCreepIdCounter,
  spawnRunes,
  initializeRoshan,
  shouldRoshanRespawn,
  respawnRoshan,
} from '../../../server/game/map/spawner'
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
      const expectedWithSiege =
        3 * 2 * (MELEE_CREEPS_PER_WAVE + RANGED_CREEPS_PER_WAVE + 1)
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

    it('runes record the spawn tick', () => {
      const runes = spawnRunes(120)
      for (const r of runes) {
        expect(r.tick).toBe(120)
      }
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
        const respawned = respawnRoshan(dead)
        expect(respawned.alive).toBe(true)
        expect(respawned.hp).toBe(ROSHAN_BASE_HP)
        expect(respawned.deathTick).toBeNull()
      })

      it('preserves maxHp', () => {
        const dead = { alive: false, hp: 0, maxHp: 6000, deathTick: 100 }
        const respawned = respawnRoshan(dead)
        expect(respawned.hp).toBe(6000)
        expect(respawned.maxHp).toBe(6000)
      })
    })
  })
})
