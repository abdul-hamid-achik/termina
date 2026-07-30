import { describe, it, expect } from 'vitest'
import {
  TICK_DURATION_MS,
  ACTION_WINDOW_MS,
  PASSIVE_GOLD_PER_TICK,
  WAVE_GOLD_MIN,
  WAVE_GOLD_MAX,
  BREACH_UNIT_GOLD,
  KILL_BOUNTY_BASE,
  KILL_BOUNTY_PER_STREAK,
  ASSIST_GOLD,
  ICE_GOLD,
  TENANT_GOLD,
  STARTING_GOLD,
  MAX_LEVEL,
  XP_PER_LEVEL,
  WAVE_XP,
  HERO_KILL_XP_BASE,
  HERO_KILL_XP_PER_LEVEL,
  RESPAWN_BASE_TICKS,
  RESPAWN_PER_LEVEL_TICKS,
  MAX_ITEMS,
  CAMTAP_DURATION_TICKS,
  SNIFFER_DURATION_TICKS,
  WARD_LIMIT_PER_TEAM,
  TENANT_RESPAWN_TICKS,
  TENANT_BASE_HP,
  WAVE_INTERVAL_TICKS,
  LINE_UNITS_PER_WAVE,
  SWEEP_UNITS_PER_WAVE,
  BREACH_WAVE_INTERVAL,
  LINE_UNIT_HP,
  SWEEP_UNIT_HP,
  BREACH_UNIT_HP,
  LINE_UNIT_ATTACK,
  SWEEP_UNIT_ATTACK,
  BREACH_UNIT_ATTACK,
  WAVE_ESCALATION_INTERVAL_TICKS,
  WAVE_ESCALATION_STEP,
  WAVE_ESCALATION_MAX_MULTIPLIER,
  waveEscalationMultiplier,
  waveUnitMaxHp,
  waveUnitAttack,
  WAVE_XP_SHARED,
  WAVE_XP_SHARED_RATIO,
  ICE_HP_T1,
  ICE_HP_T2,
  ICE_HP_T3,
  ICE_ATTACK,
  ICE_DEFENSE,
  FOUNTAIN_HEAL_PER_TICK_PERCENT,
  FOUNTAIN_MANA_PER_TICK_PERCENT,
  SURRENDER_MIN_TICK,
} from '~~/shared/constants/balance'
import { HEROES } from '~~/shared/constants/heroes'
import { TALENT_TREES } from '~~/shared/constants/talents'

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

    it('wave gold min <= max', () => {
      expect(WAVE_GOLD_MIN).toBeLessThanOrEqual(WAVE_GOLD_MAX)
    })

    it('wave gold values are positive', () => {
      expect(WAVE_GOLD_MIN).toBeGreaterThan(0)
      expect(WAVE_GOLD_MAX).toBeGreaterThan(0)
    })

    it('breach wave gold exceeds regular wave gold', () => {
      expect(BREACH_UNIT_GOLD).toBeGreaterThan(WAVE_GOLD_MAX)
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

    it('ice gold is significant', () => {
      expect(ICE_GOLD).toBeGreaterThanOrEqual(200)
    })

    it('tenant gold is the highest single-kill reward', () => {
      expect(TENANT_GOLD).toBeGreaterThanOrEqual(ICE_GOLD)
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

    it('wave XP is positive', () => {
      expect(WAVE_XP).toBeGreaterThan(0)
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
    it('observer ward duration is positive', () => {
      expect(CAMTAP_DURATION_TICKS).toBeGreaterThan(0)
    })

    it('sentry ward duration is positive', () => {
      expect(SNIFFER_DURATION_TICKS).toBeGreaterThan(0)
    })

    it('ward limit per team is reasonable', () => {
      expect(WARD_LIMIT_PER_TEAM).toBeGreaterThanOrEqual(1)
      expect(WARD_LIMIT_PER_TEAM).toBeLessThanOrEqual(10)
    })
  })

  describe('Tenant', () => {
    it('Tenant respawn time is significant', () => {
      expect(TENANT_RESPAWN_TICKS).toBeGreaterThan(30)
    })

    it('Tenant has high base HP', () => {
      expect(TENANT_BASE_HP).toBeGreaterThan(1000)
    })
  })

  describe('wave waves', () => {
    it('wave interval is positive', () => {
      expect(WAVE_INTERVAL_TICKS).toBeGreaterThan(0)
    })

    it('line waves per wave is reasonable', () => {
      expect(LINE_UNITS_PER_WAVE).toBeGreaterThanOrEqual(1)
      expect(LINE_UNITS_PER_WAVE).toBeLessThanOrEqual(10)
    })

    it('sweep waves per wave is reasonable', () => {
      expect(SWEEP_UNITS_PER_WAVE).toBeGreaterThanOrEqual(1)
      expect(SWEEP_UNITS_PER_WAVE).toBeLessThanOrEqual(5)
    })

    it('breach wave interval is greater than 1', () => {
      expect(BREACH_WAVE_INTERVAL).toBeGreaterThan(1)
    })

    it('wave HP values are ordered: line < breach, sweep < line', () => {
      expect(SWEEP_UNIT_HP).toBeLessThan(LINE_UNIT_HP)
      expect(LINE_UNIT_HP).toBeLessThan(BREACH_UNIT_HP)
    })

    it('breach wave has highest attack', () => {
      expect(BREACH_UNIT_ATTACK).toBeGreaterThan(SWEEP_UNIT_ATTACK)
      expect(BREACH_UNIT_ATTACK).toBeGreaterThan(LINE_UNIT_ATTACK)
    })

    it('sweep wave attack exceeds line wave attack', () => {
      expect(SWEEP_UNIT_ATTACK).toBeGreaterThan(LINE_UNIT_ATTACK)
    })
  })

  describe('wave escalation', () => {
    it('is flat for the whole first interval', () => {
      expect(waveEscalationMultiplier(0)).toBe(1)
      expect(waveEscalationMultiplier(WAVE_ESCALATION_INTERVAL_TICKS - 1)).toBe(1)
      expect(waveUnitMaxHp('line', WAVE_ESCALATION_INTERVAL_TICKS - 1)).toBe(LINE_UNIT_HP)
      expect(waveUnitAttack('line', WAVE_ESCALATION_INTERVAL_TICKS - 1)).toBe(LINE_UNIT_ATTACK)
    })

    it('steps up once per interval', () => {
      expect(waveEscalationMultiplier(WAVE_ESCALATION_INTERVAL_TICKS)).toBeCloseTo(
        1 + WAVE_ESCALATION_STEP,
      )
      expect(waveEscalationMultiplier(WAVE_ESCALATION_INTERVAL_TICKS * 2)).toBeCloseTo(
        1 + WAVE_ESCALATION_STEP * 2,
      )
    })

    it('scales both HP and damage of every wave type', () => {
      const tick = WAVE_ESCALATION_INTERVAL_TICKS * 2
      const mult = waveEscalationMultiplier(tick)
      expect(mult).toBeGreaterThan(1)
      expect(waveUnitMaxHp('line', tick)).toBe(Math.round(LINE_UNIT_HP * mult))
      expect(waveUnitMaxHp('sweep', tick)).toBe(Math.round(SWEEP_UNIT_HP * mult))
      expect(waveUnitMaxHp('breach', tick)).toBe(Math.round(BREACH_UNIT_HP * mult))
      expect(waveUnitAttack('line', tick)).toBe(Math.round(LINE_UNIT_ATTACK * mult))
      expect(waveUnitAttack('sweep', tick)).toBe(Math.round(SWEEP_UNIT_ATTACK * mult))
      expect(waveUnitAttack('breach', tick)).toBe(Math.round(BREACH_UNIT_ATTACK * mult))
    })

    it('caps so a stalled game does not produce one-shot waves', () => {
      expect(waveEscalationMultiplier(100_000)).toBe(WAVE_ESCALATION_MAX_MULTIPLIER)
      expect(waveUnitAttack('breach', 100_000)).toBe(
        BREACH_UNIT_ATTACK * WAVE_ESCALATION_MAX_MULTIPLIER,
      )
    })

    it('scales HP and damage by the same factor, so wave-vs-wave trades are unchanged', () => {
      const early = WAVE_ESCALATION_INTERVAL_TICKS - 1
      const late = WAVE_ESCALATION_INTERVAL_TICKS * 4
      const hitsEarly = waveUnitMaxHp('line', early) / waveUnitAttack('line', early)
      const hitsLate = waveUnitMaxHp('line', late) / waveUnitAttack('line', late)
      expect(hitsLate).toBeCloseTo(hitsEarly, 1)
    })
  })

  describe('shared wave XP', () => {
    it('is a fraction of the last-hit reward, so timing still pays more', () => {
      expect(WAVE_XP_SHARED_RATIO).toBeGreaterThan(0)
      expect(WAVE_XP_SHARED_RATIO).toBeLessThan(1)
      expect(WAVE_XP_SHARED).toBe(Math.floor(WAVE_XP * WAVE_XP_SHARED_RATIO))
      expect(WAVE_XP_SHARED).toBeGreaterThan(0)
      expect(WAVE_XP_SHARED).toBeLessThan(WAVE_XP)
    })
  })

  describe('ice', () => {
    it('ice HP increases by tier', () => {
      expect(ICE_HP_T1).toBeLessThan(ICE_HP_T2)
      expect(ICE_HP_T2).toBeLessThan(ICE_HP_T3)
    })

    it('ice attack is significant', () => {
      expect(ICE_ATTACK).toBeGreaterThan(50)
    })

    it('ICE structure plate is positive', () => {
      expect(ICE_DEFENSE).toBeGreaterThan(0)
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

        it('has plate in valid range (1-10)', () => {
          expect(hero.baseStats.plate).toBeGreaterThanOrEqual(1)
          expect(hero.baseStats.plate).toBeLessThanOrEqual(10)
        })

        it('has ice in valid range (10-30)', () => {
          expect(hero.baseStats.ice).toBeGreaterThanOrEqual(10)
          expect(hero.baseStats.ice).toBeLessThanOrEqual(30)
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

  describe('talents — no dead stats', () => {
    it('every stat_bonus talent targets a stat the engine consumes', () => {
      // getTalentStatBonus is only summed for these stats. attackSpeed is inert
      // in the tick model, so a stat_bonus talent granting it would do nothing
      // (the daemon +12 "Attack Speed" talent was exactly that).
      const CONSUMED = new Set(['hp', 'mp', 'attack', 'plate', 'ice'])
      for (const tree of Object.values(TALENT_TREES)) {
        for (const tier of Object.values(tree.tiers)) {
          for (const talent of tier) {
            if (talent.statBonus) {
              expect(
                CONSUMED.has(talent.statBonus.stat),
                `${talent.id} grants the inert stat "${talent.statBonus.stat}"`,
              ).toBe(true)
            }
          }
        }
      }
    })
  })
})
