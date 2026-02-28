import { describe, it, expect } from 'vitest'
import {
  initializeZoneStates,
  initializeTowers,
  placeWard,
  removeExpiredWards,
  canAttackTower,
} from '../../../server/game/map/zones'
import { ZONES, ZONE_IDS } from '../../../shared/constants/zones'
import {
  TOWER_HP_T1,
  TOWER_HP_T2,
  TOWER_HP_T3,
  WARD_DURATION_TICKS,
  WARD_LIMIT_PER_TEAM,
} from '../../../shared/constants/balance'

describe('Zones', () => {
  describe('initializeZoneStates', () => {
    it('creates a runtime state for every defined zone', () => {
      const states = initializeZoneStates()
      for (const id of ZONE_IDS) {
        expect(states[id]).toBeDefined()
        expect(states[id]!.id).toBe(id)
      }
    })

    it('initializes zones with empty wards and creeps', () => {
      const states = initializeZoneStates()
      for (const state of Object.values(states)) {
        expect(state.wards).toEqual([])
        expect(state.creeps).toEqual([])
      }
    })

    it('creates the correct number of zone states', () => {
      const states = initializeZoneStates()
      expect(Object.keys(states).length).toBe(ZONES.length)
    })
  })

  describe('initializeTowers', () => {
    it('creates towers only for zones with tower: true', () => {
      const towers = initializeTowers()
      const towerZones = ZONES.filter((z) => z.tower)
      expect(towers.length).toBe(towerZones.length)
    })

    it('creates 18 towers total (3 lanes * 3 tiers * 2 teams)', () => {
      const towers = initializeTowers()
      expect(towers.length).toBe(18)
    })

    it('assigns correct HP by tier', () => {
      const towers = initializeTowers()
      for (const t of towers) {
        if (t.zone.includes('-t1-')) {
          expect(t.hp).toBe(TOWER_HP_T1)
          expect(t.maxHp).toBe(TOWER_HP_T1)
        } else if (t.zone.includes('-t2-')) {
          expect(t.hp).toBe(TOWER_HP_T2)
          expect(t.maxHp).toBe(TOWER_HP_T2)
        } else if (t.zone.includes('-t3-')) {
          expect(t.hp).toBe(TOWER_HP_T3)
          expect(t.maxHp).toBe(TOWER_HP_T3)
        }
      }
    })

    it('all towers start alive', () => {
      const towers = initializeTowers()
      for (const t of towers) {
        expect(t.alive).toBe(true)
      }
    })

    it('assigns correct team to each tower', () => {
      const towers = initializeTowers()
      for (const t of towers) {
        if (t.zone.endsWith('-rad')) expect(t.team).toBe('radiant')
        else if (t.zone.endsWith('-dire')) expect(t.team).toBe('dire')
      }
    })

    it('each team has 9 towers (3 lanes * 3 tiers)', () => {
      const towers = initializeTowers()
      const radiant = towers.filter((t) => t.team === 'radiant')
      const dire = towers.filter((t) => t.team === 'dire')
      expect(radiant.length).toBe(9)
      expect(dire.length).toBe(9)
    })
  })

  describe('placeWard', () => {
    it('places a ward in a valid zone', () => {
      const zones = initializeZoneStates()
      const result = placeWard(zones, 'mid-river', 'radiant', 10)
      expect(result).toBe(true)
      expect(zones['mid-river']!.wards).toHaveLength(1)
      expect(zones['mid-river']!.wards[0]!.team).toBe('radiant')
      expect(zones['mid-river']!.wards[0]!.placedTick).toBe(10)
      expect(zones['mid-river']!.wards[0]!.expiryTick).toBe(10 + WARD_DURATION_TICKS)
    })

    it('returns false for unknown zone', () => {
      const zones = initializeZoneStates()
      expect(placeWard(zones, 'nonexistent', 'radiant', 10)).toBe(false)
    })

    it('enforces ward limit per team', () => {
      const zones = initializeZoneStates()
      for (let i = 0; i < WARD_LIMIT_PER_TEAM; i++) {
        expect(placeWard(zones, 'mid-river', 'radiant', 10)).toBe(true)
      }
      // Next ward should fail
      expect(placeWard(zones, 'top-river', 'radiant', 10)).toBe(false)
    })

    it('tracks ward limits independently per team', () => {
      const zones = initializeZoneStates()
      for (let i = 0; i < WARD_LIMIT_PER_TEAM; i++) {
        expect(placeWard(zones, 'mid-river', 'radiant', 10)).toBe(true)
      }
      // Dire should still be able to place wards
      expect(placeWard(zones, 'mid-river', 'dire', 10)).toBe(true)
    })
  })

  describe('removeExpiredWards', () => {
    it('removes wards that have expired', () => {
      const zones = initializeZoneStates()
      placeWard(zones, 'mid-river', 'radiant', 10)
      expect(zones['mid-river']!.wards).toHaveLength(1)

      removeExpiredWards(zones, 10 + WARD_DURATION_TICKS + 1)
      expect(zones['mid-river']!.wards).toHaveLength(0)
    })

    it('keeps wards that have not expired', () => {
      const zones = initializeZoneStates()
      placeWard(zones, 'mid-river', 'radiant', 10)

      removeExpiredWards(zones, 10 + WARD_DURATION_TICKS - 1)
      expect(zones['mid-river']!.wards).toHaveLength(1)
    })

    it('removes ward at exactly expiry tick', () => {
      const zones = initializeZoneStates()
      placeWard(zones, 'mid-river', 'radiant', 10)

      // expiryTick = 10 + WARD_DURATION_TICKS. Filter keeps w.expiryTick > currentTick
      removeExpiredWards(zones, 10 + WARD_DURATION_TICKS)
      expect(zones['mid-river']!.wards).toHaveLength(0)
    })
  })

  describe('canAttackTower', () => {
    it('T1 towers can always be attacked', () => {
      const towers = initializeTowers()
      expect(canAttackTower(towers, 'mid-t1-rad')).toBe(true)
      expect(canAttackTower(towers, 'top-t1-dire')).toBe(true)
    })

    it('T2 cannot be attacked while T1 is alive', () => {
      const towers = initializeTowers()
      expect(canAttackTower(towers, 'mid-t2-rad')).toBe(false)
    })

    it('T2 can be attacked when T1 is destroyed', () => {
      const towers = initializeTowers()
      const t1 = towers.find((t) => t.zone === 'mid-t1-rad')!
      t1.alive = false
      t1.hp = 0
      expect(canAttackTower(towers, 'mid-t2-rad')).toBe(true)
    })

    it('T3 cannot be attacked while T2 is alive', () => {
      const towers = initializeTowers()
      // Destroy T1
      const t1 = towers.find((t) => t.zone === 'mid-t1-rad')!
      t1.alive = false
      expect(canAttackTower(towers, 'mid-t3-rad')).toBe(false)
    })

    it('T3 can be attacked when T2 is destroyed', () => {
      const towers = initializeTowers()
      const t1 = towers.find((t) => t.zone === 'mid-t1-rad')!
      const t2 = towers.find((t) => t.zone === 'mid-t2-rad')!
      t1.alive = false
      t2.alive = false
      expect(canAttackTower(towers, 'mid-t3-rad')).toBe(true)
    })

    it('returns false for a dead tower', () => {
      const towers = initializeTowers()
      const t1 = towers.find((t) => t.zone === 'mid-t1-rad')!
      t1.alive = false
      expect(canAttackTower(towers, 'mid-t1-rad')).toBe(false)
    })

    it('returns false for zones without towers', () => {
      const towers = initializeTowers()
      expect(canAttackTower(towers, 'mid-river')).toBe(false)
      expect(canAttackTower(towers, 'radiant-base')).toBe(false)
    })
  })
})
