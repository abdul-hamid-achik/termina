import { describe, it, expect } from 'vitest'
import {
  TICK_DURATION_MS,
  ACTION_WINDOW_MS,
  PASSIVE_GOLD_PER_TICK,
  CREEP_GOLD_MIN,
  CREEP_GOLD_MAX,
  SIEGE_CREEP_GOLD,
  KILL_BOUNTY_BASE,
  KILL_BOUNTY_PER_STREAK,
  ASSIST_GOLD,
  TOWER_GOLD,
  ROSHAN_GOLD,
  STARTING_GOLD,
  MAX_LEVEL,
  XP_PER_LEVEL,
  CREEP_XP,
  HERO_KILL_XP_BASE,
  HERO_KILL_XP_PER_LEVEL,
  RESPAWN_BASE_TICKS,
  RESPAWN_PER_LEVEL_TICKS,
  MAX_ITEMS,
  WARD_DURATION_TICKS,
  WARD_LIMIT_PER_TEAM,
  ROSHAN_RESPAWN_TICKS,
  ROSHAN_BASE_HP,
  CREEP_WAVE_INTERVAL_TICKS,
  MELEE_CREEPS_PER_WAVE,
  RANGED_CREEPS_PER_WAVE,
  SIEGE_CREEP_WAVE_INTERVAL,
  MELEE_CREEP_HP,
  RANGED_CREEP_HP,
  SIEGE_CREEP_HP,
  MELEE_CREEP_ATTACK,
  RANGED_CREEP_ATTACK,
  SIEGE_CREEP_ATTACK,
  TOWER_HP_T1,
  TOWER_HP_T2,
  TOWER_HP_T3,
  TOWER_ATTACK,
  TOWER_DEFENSE,
  FOUNTAIN_HEAL_PER_TICK_PERCENT,
  FOUNTAIN_MANA_PER_TICK_PERCENT,
  SURRENDER_MIN_TICK,
} from '../../../shared/constants/balance'
import { HEROES } from '../../../shared/constants/heroes'

describe('Balance Constants', () => {
  describe('timing', () => {
    it('tick duration is positive', () => {
      expect(TICK_DURATION_MS).toBeGreaterThan(0)
    })

    it('action window fits within tick duration', () => {
      expect(ACTION_WINDOW_MS).toBeLessThan(TICK_DURATION_MS)
      expect(ACTION_WINDOW_MS).toBeGreaterThan(0)
    })
  })

  describe('gold values', () => {
    it('passive gold is positive', () => {
      expect(PASSIVE_GOLD_PER_TICK).toBeGreaterThan(0)
    })

    it('creep gold min <= max', () => {
      expect(CREEP_GOLD_MIN).toBeLessThanOrEqual(CREEP_GOLD_MAX)
    })

    it('creep gold values are positive', () => {
      expect(CREEP_GOLD_MIN).toBeGreaterThan(0)
      expect(CREEP_GOLD_MAX).toBeGreaterThan(0)
    })

    it('siege creep gold exceeds regular creep gold', () => {
      expect(SIEGE_CREEP_GOLD).toBeGreaterThan(CREEP_GOLD_MAX)
    })

    it('kill bounty is positive and reasonable', () => {
      expect(KILL_BOUNTY_BASE).toBeGreaterThan(0)
      expect(KILL_BOUNTY_BASE).toBeLessThanOrEqual(1000)
    })

    it('streak bounty scales positively', () => {
      expect(KILL_BOUNTY_PER_STREAK).toBeGreaterThan(0)
    })

    it('assist gold is less than kill bounty', () => {
      expect(ASSIST_GOLD).toBeLessThan(KILL_BOUNTY_BASE)
    })

    it('tower gold is significant', () => {
      expect(TOWER_GOLD).toBeGreaterThanOrEqual(200)
    })

    it('roshan gold is the highest single-kill reward', () => {
      expect(ROSHAN_GOLD).toBeGreaterThanOrEqual(TOWER_GOLD)
    })

    it('starting gold is reasonable', () => {
      expect(STARTING_GOLD).toBeGreaterThanOrEqual(300)
      expect(STARTING_GOLD).toBeLessThanOrEqual(1000)
    })
  })

  describe('XP curve', () => {
    it('has correct number of entries (0 through MAX_LEVEL)', () => {
      expect(XP_PER_LEVEL.length).toBe(MAX_LEVEL + 1)
    })

    it('level 0 and 1 require 0 XP', () => {
      expect(XP_PER_LEVEL[0]).toBe(0)
      expect(XP_PER_LEVEL[1]).toBe(0)
    })

    it('XP curve is monotonically increasing from level 2 onward', () => {
      for (let i = 3; i <= MAX_LEVEL; i++) {
        expect(XP_PER_LEVEL[i]).toBeGreaterThan(XP_PER_LEVEL[i - 1]!)
      }
    })

    it('XP per level starts low and grows', () => {
      expect(XP_PER_LEVEL[2]).toBeLessThan(XP_PER_LEVEL[MAX_LEVEL]!)
    })

    it('max level XP is significant', () => {
      expect(XP_PER_LEVEL[MAX_LEVEL]).toBeGreaterThan(1000)
    })

    it('creep XP is positive', () => {
      expect(CREEP_XP).toBeGreaterThan(0)
    })

    it('hero kill XP scales with level', () => {
      expect(HERO_KILL_XP_BASE).toBeGreaterThan(0)
      expect(HERO_KILL_XP_PER_LEVEL).toBeGreaterThan(0)
    })
  })

  describe('respawn time', () => {
    it('base respawn is positive', () => {
      expect(RESPAWN_BASE_TICKS).toBeGreaterThan(0)
    })

    it('respawn scales with level', () => {
      expect(RESPAWN_PER_LEVEL_TICKS).toBeGreaterThan(0)
    })

    it('respawn time increases monotonically with level', () => {
      for (let level = 1; level < MAX_LEVEL; level++) {
        const respawnCurrent = RESPAWN_BASE_TICKS + level * RESPAWN_PER_LEVEL_TICKS
        const respawnNext = RESPAWN_BASE_TICKS + (level + 1) * RESPAWN_PER_LEVEL_TICKS
        expect(respawnNext).toBeGreaterThan(respawnCurrent)
      }
    })

    it('level 1 respawn time is short', () => {
      const respawnL1 = RESPAWN_BASE_TICKS + 1 * RESPAWN_PER_LEVEL_TICKS
      expect(respawnL1).toBeLessThanOrEqual(10)
    })

    it('max level respawn time is longer', () => {
      const respawnMax = RESPAWN_BASE_TICKS + MAX_LEVEL * RESPAWN_PER_LEVEL_TICKS
      expect(respawnMax).toBeGreaterThan(20)
    })
  })

  describe('inventory', () => {
    it('max items is 6', () => {
      expect(MAX_ITEMS).toBe(6)
    })
  })

  describe('wards', () => {
    it('ward duration is positive', () => {
      expect(WARD_DURATION_TICKS).toBeGreaterThan(0)
    })

    it('ward limit per team is reasonable', () => {
      expect(WARD_LIMIT_PER_TEAM).toBeGreaterThanOrEqual(1)
      expect(WARD_LIMIT_PER_TEAM).toBeLessThanOrEqual(10)
    })
  })

  describe('Roshan', () => {
    it('Roshan respawn time is significant', () => {
      expect(ROSHAN_RESPAWN_TICKS).toBeGreaterThan(30)
    })

    it('Roshan has high base HP', () => {
      expect(ROSHAN_BASE_HP).toBeGreaterThan(1000)
    })
  })

  describe('creep waves', () => {
    it('wave interval is positive', () => {
      expect(CREEP_WAVE_INTERVAL_TICKS).toBeGreaterThan(0)
    })

    it('melee creeps per wave is reasonable', () => {
      expect(MELEE_CREEPS_PER_WAVE).toBeGreaterThanOrEqual(1)
      expect(MELEE_CREEPS_PER_WAVE).toBeLessThanOrEqual(10)
    })

    it('ranged creeps per wave is reasonable', () => {
      expect(RANGED_CREEPS_PER_WAVE).toBeGreaterThanOrEqual(1)
      expect(RANGED_CREEPS_PER_WAVE).toBeLessThanOrEqual(5)
    })

    it('siege wave interval is greater than 1', () => {
      expect(SIEGE_CREEP_WAVE_INTERVAL).toBeGreaterThan(1)
    })

    it('creep HP values are ordered: melee < siege, ranged < melee', () => {
      expect(RANGED_CREEP_HP).toBeLessThan(MELEE_CREEP_HP)
      expect(MELEE_CREEP_HP).toBeLessThan(SIEGE_CREEP_HP)
    })

    it('siege creep has highest attack', () => {
      expect(SIEGE_CREEP_ATTACK).toBeGreaterThan(RANGED_CREEP_ATTACK)
      expect(SIEGE_CREEP_ATTACK).toBeGreaterThan(MELEE_CREEP_ATTACK)
    })

    it('ranged creep attack exceeds melee creep attack', () => {
      expect(RANGED_CREEP_ATTACK).toBeGreaterThan(MELEE_CREEP_ATTACK)
    })
  })

  describe('towers', () => {
    it('tower HP increases by tier', () => {
      expect(TOWER_HP_T1).toBeLessThan(TOWER_HP_T2)
      expect(TOWER_HP_T2).toBeLessThan(TOWER_HP_T3)
    })

    it('tower attack is significant', () => {
      expect(TOWER_ATTACK).toBeGreaterThan(50)
    })

    it('tower defense is positive', () => {
      expect(TOWER_DEFENSE).toBeGreaterThan(0)
    })
  })

  describe('fountain', () => {
    it('fountain heal rate is reasonable', () => {
      expect(FOUNTAIN_HEAL_PER_TICK_PERCENT).toBeGreaterThan(0)
      expect(FOUNTAIN_HEAL_PER_TICK_PERCENT).toBeLessThanOrEqual(100)
    })

    it('fountain mana rate is reasonable', () => {
      expect(FOUNTAIN_MANA_PER_TICK_PERCENT).toBeGreaterThan(0)
      expect(FOUNTAIN_MANA_PER_TICK_PERCENT).toBeLessThanOrEqual(100)
    })
  })

  describe('surrender', () => {
    it('surrender minimum tick is positive', () => {
      expect(SURRENDER_MIN_TICK).toBeGreaterThan(0)
    })
  })

  describe('hero stat ranges', () => {
    for (const [heroId, hero] of Object.entries(HEROES)) {
      describe(`${hero.name} (${heroId})`, () => {
        it('has HP in valid range (400-800)', () => {
          expect(hero.baseStats.hp).toBeGreaterThanOrEqual(400)
          expect(hero.baseStats.hp).toBeLessThanOrEqual(800)
        })

        it('has MP in valid range (200-450)', () => {
          expect(hero.baseStats.mp).toBeGreaterThanOrEqual(200)
          expect(hero.baseStats.mp).toBeLessThanOrEqual(450)
        })

        it('has attack in valid range (30-70)', () => {
          expect(hero.baseStats.attack).toBeGreaterThanOrEqual(30)
          expect(hero.baseStats.attack).toBeLessThanOrEqual(70)
        })

        it('has defense in valid range (1-10)', () => {
          expect(hero.baseStats.defense).toBeGreaterThanOrEqual(1)
          expect(hero.baseStats.defense).toBeLessThanOrEqual(10)
        })

        it('has magic resist in valid range (10-30)', () => {
          expect(hero.baseStats.magicResist).toBeGreaterThanOrEqual(10)
          expect(hero.baseStats.magicResist).toBeLessThanOrEqual(30)
        })

        it('ability mana costs are affordable at level 1', () => {
          for (const [slot, ability] of Object.entries(hero.abilities)) {
            if (slot === 'r') continue // ults can be expensive
            expect(ability.manaCost).toBeLessThanOrEqual(hero.baseStats.mp)
          }
        })

        it('has positive HP growth per level', () => {
          expect(hero.growthPerLevel.hp).toBeGreaterThan(0)
        })

        it('has positive attack growth per level', () => {
          expect(hero.growthPerLevel.attack).toBeGreaterThan(0)
        })

        it('tanks have higher base HP than carries/mages', () => {
          if (hero.role === 'tank') {
            expect(hero.baseStats.hp).toBeGreaterThanOrEqual(700)
          }
        })

        it('assassins have higher base attack', () => {
          if (hero.role === 'assassin') {
            expect(hero.baseStats.attack).toBeGreaterThanOrEqual(60)
          }
        })
      })
    }
  })
})
