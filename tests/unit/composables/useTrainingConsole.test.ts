import { describe, it, expect } from 'vitest'
import { ref, nextTick } from 'vue'
import { useTrainingConsole, CONSOLE_LEVELS } from '~~/app/composables/useTrainingConsole'
import type { HeroDef, AbilityDef } from '~~/shared/types/hero'
import { ULTIMATE_UNLOCK_LEVEL } from '~~/shared/constants/balance'

/** Move the console to a non-default hero level (the watcher resets on flush). */
async function atLevel<T extends { level: { value: number } }>(c: T, lvl: number): Promise<T> {
  c.level.value = lvl
  await nextTick()
  return c
}

const ability = (over: Partial<AbilityDef>): AbilityDef => ({
  id: 'x',
  name: 'X',
  description: '',
  manaCost: 0,
  cooldownTicks: 0,
  targetType: 'self',
  effects: [],
  ...over,
})

function makeHero(over: Partial<HeroDef> = {}): HeroDef {
  return {
    id: 't',
    name: 'Tester',
    role: 'mage',
    lore: '',
    difficulty: 'medium',
    openingCombo: ['q', 'w', 'e', 'r'],
    oneLineTip: 'tip',
    baseStats: {
      integ: 600,
      bw: 200,
      attack: 50,
      plate: 0,
      ice: 0,
    },
    growthPerLevel: {},
    passive: ability({ id: 'p', name: 'P' }),
    abilities: {
      q: ability({
        id: 'q',
        name: 'Q',
        manaCost: 50,
        cooldownTicks: 2,
        effects: [{ type: 'damage', value: 100 }],
      }),
      w: ability({
        id: 'w',
        name: 'W',
        manaCost: 30,
        cooldownTicks: 3,
        effects: [{ type: 'dot', value: 60, duration: 3 }],
      }),
      e: ability({
        id: 'e',
        name: 'E',
        manaCost: 500,
        cooldownTicks: 1,
        effects: [{ type: 'heal', value: 40 }],
      }),
      r: ability({ id: 'r', name: 'R' }),
    },
    ...over,
  }
}

describe('useTrainingConsole', () => {
  it('initializes BW to the hero max and greets in the log', () => {
    const c = useTrainingConsole(ref(makeHero()))
    expect(c.mana.value).toBe(200)
    expect(c.dummyHp.value).toBe(1000)
    expect(c.log.value[0]).toContain('Tester at level 1')
  })

  it('cast Q spends BW, sets cooldown, and burst-damages the dummy', () => {
    const c = useTrainingConsole(ref(makeHero()))
    c.cast('q')
    expect(c.mana.value).toBe(150) // 200 - 50
    expect(c.cooldowns.q).toBe(2)
    expect(c.dummyHp.value).toBe(900) // 1000 - 100 burst
  })

  it('rejects a cast on cooldown', () => {
    const c = useTrainingConsole(ref(makeHero()))
    c.cast('q')
    const manaAfter = c.mana.value
    c.cast('q')
    expect(c.mana.value).toBe(manaAfter)
    expect(c.log.value.some((l) => l.includes('on cooldown'))).toBe(true)
  })

  it('rejects a cast with insufficient BW', () => {
    const c = useTrainingConsole(ref(makeHero()))
    c.cast('e') // costs 500, have 200
    expect(c.mana.value).toBe(200)
    expect(c.log.value.some((l) => l.includes('not enough BW'))).toBe(true)
  })

  it('applies a DoT that drains the dummy over ticks (total spread per tick)', () => {
    const c = useTrainingConsole(ref(makeHero()))
    c.cast('w') // dot total 60 over 3 → 20/tick
    expect(c.dots.value).toHaveLength(1)
    expect(c.dummyHp.value).toBe(1000) // no burst
    c.advanceTick()
    expect(c.dummyHp.value).toBe(980) // -20
    c.advanceTick()
    c.advanceTick()
    expect(c.dummyHp.value).toBe(940) // -60 total
    expect(c.dots.value).toHaveLength(0) // expired
  })

  it('regenerates BW (≥2) and decrements cooldowns each tick', () => {
    const c = useTrainingConsole(ref(makeHero()))
    c.cast('q') // mana 150, cd 2
    c.advanceTick()
    expect(c.cooldowns.q).toBe(1)
    expect(c.mana.value).toBe(160) // +10 (5% of 200)
  })

  it('respawns the dummy at full hp when it dies', () => {
    const c = useTrainingConsole(
      ref(
        makeHero({
          abilities: {
            ...makeHero().abilities,
            q: ability({ id: 'q', name: 'Nuke', effects: [{ type: 'damage', value: 5000 }] }),
          },
        }),
      ),
    )
    c.cast('q')
    expect(c.dummyHp.value).toBe(1000)
    expect(c.log.value.some((l) => l.includes('destroyed'))).toBe(true)
  })

  it('resets when the hero changes', async () => {
    const heroRef = ref(makeHero())
    const c = useTrainingConsole(heroRef)
    c.cast('q')
    expect(c.dummyHp.value).toBe(900)
    heroRef.value = makeHero({
      name: 'Other',
      baseStats: { ...makeHero().baseStats, bw: 100 },
    })
    await nextTick()
    expect(c.mana.value).toBe(100)
    expect(c.dummyHp.value).toBe(1000)
    expect(c.log.value[0]).toContain('Other at level 1')
  })

  it('trims the log to the last 50 lines', () => {
    const c = useTrainingConsole(ref(makeHero()))
    for (let i = 0; i < 60; i++) c.advanceTick()
    expect(c.log.value.length).toBeLessThanOrEqual(50)
  })

  describe('castCombo', () => {
    it('fires every ready + affordable ability in one go, skipping the rest', async () => {
      const c = await atLevel(useTrainingConsole(ref(makeHero())), ULTIMATE_UNLOCK_LEVEL)
      c.castCombo()
      // q (50) + w (30) + r (0) land; e (500) is unaffordable with 200 mana
      expect(c.mana.value).toBe(120) // 200 - 50 - 30 - 0
      expect(c.castCount.value).toBe(3)
      expect(c.cooldowns.q).toBe(2)
      expect(c.cooldowns.w).toBe(3)
      expect(c.cooldowns.e).toBe(0) // skipped — never cast
      // only q dealt burst (w is a DoT, r is inert); dummy 1000 - 100
      expect(c.dummyHp.value).toBe(900)
      expect(c.totalDamage.value).toBe(100)
      expect(c.log.value.some((l) => l.includes('cast COMBO'))).toBe(true)
      expect(c.log.value.some((l) => l.includes('combo landed 3'))).toBe(true)
    })

    it('follows the hero-authored openingCombo order, not Q→W→E→R', () => {
      const c = useTrainingConsole(ref(makeHero({ openingCombo: ['w', 'q'] })))
      c.castCombo()
      const order = c.log.value.filter((l) => /^> cast [qwer]$/.test(l))
      expect(order).toEqual(['> cast w', '> cast q'])
      expect(c.castCount.value).toBe(2)
    })

    it('drops slots the hero has not learned yet at the selected level', () => {
      // Default level 1: R has no rank, so the authored rotation loses it.
      const c = useTrainingConsole(ref(makeHero()))
      c.castCombo()
      expect(c.castCount.value).toBe(2) // q + w; e unaffordable, r locked
      expect(c.log.value.some((l) => l.includes('combo landed 2'))).toBe(true)
      expect(c.log.value.some((l) => l === '> cast r')).toBe(false)
    })

    it('reports when nothing is ready instead of casting', () => {
      const c = useTrainingConsole(
        ref(
          makeHero({
            abilities: {
              q: ability({ id: 'q', name: 'Q', manaCost: 9999 }),
              w: ability({ id: 'w', name: 'W', manaCost: 9999 }),
              e: ability({ id: 'e', name: 'E', manaCost: 9999 }),
              r: ability({ id: 'r', name: 'R', manaCost: 9999 }),
            },
          }),
        ),
      )
      c.castCombo()
      expect(c.castCount.value).toBe(0)
      expect(c.mana.value).toBe(200) // untouched
      expect(c.log.value.some((l) => l.includes('nothing ready'))).toBe(true)
    })
  })

  describe('output tallies', () => {
    it('accumulates burst and resolved DoT damage across casts + ticks', () => {
      const c = useTrainingConsole(ref(makeHero()))
      c.cast('q') // 100 burst
      c.cast('w') // dot 60 over 3 → 20/tick
      c.advanceTick()
      c.advanceTick()
      c.advanceTick() // 3 dot ticks → +60
      expect(c.totalDamage.value).toBe(160)
      expect(c.castCount.value).toBe(2)
    })

    it('zeroes the tallies on reset', () => {
      const c = useTrainingConsole(ref(makeHero()))
      c.cast('q')
      expect(c.totalDamage.value).toBeGreaterThan(0)
      c.reset()
      expect(c.totalDamage.value).toBe(0)
      expect(c.castCount.value).toBe(0)
    })
  })

  describe('control effects on the dummy', () => {
    // A hero whose R stuns for 2t and Q slows for 3t (alongside its damage).
    const controlHero = () =>
      makeHero({
        abilities: {
          ...makeHero().abilities,
          q: ability({
            id: 'q',
            name: 'Q',
            manaCost: 50,
            cooldownTicks: 0,
            effects: [
              { type: 'damage', value: 100 },
              { type: 'slow', value: 30, duration: 3 },
            ],
          }),
          r: ability({
            id: 'r',
            name: 'R',
            manaCost: 0,
            cooldownTicks: 0,
            effects: [{ type: 'stun', duration: 2 }],
          }),
        },
      })

    // The stun rides on R, so these run at the level the ultimate exists at.
    const consoleAtSix = () => atLevel(useTrainingConsole(ref(controlHero())), 6)

    it('applies a control status and logs it on cast', async () => {
      const c = await consoleAtSix()
      c.cast('r')
      expect(c.statuses.value).toEqual([{ kind: 'stun', label: 'STUNNED', ticksLeft: 2 }])
      expect(c.log.value.some((l) => l.includes('STUNNED for 2t'))).toBe(true)
    })

    it('decays statuses each tick and announces when they wear off', async () => {
      const c = await consoleAtSix()
      c.cast('r') // stun 2t
      c.advanceTick()
      expect(c.statuses.value[0]!.ticksLeft).toBe(1)
      c.advanceTick()
      expect(c.statuses.value).toHaveLength(0)
      expect(c.log.value.some((l) => l.includes('STUNNED wore off'))).toBe(true)
    })

    it('refreshes an existing control instead of stacking duplicates', async () => {
      const c = await consoleAtSix()
      c.cast('r')
      c.advanceTick() // stun → 1t left
      c.cast('r') // re-stun → refreshed back to 2t
      expect(c.statuses.value).toHaveLength(1)
      expect(c.statuses.value[0]!.ticksLeft).toBe(2)
    })

    it('tracks damage + control from the same ability', () => {
      const c = useTrainingConsole(ref(controlHero()))
      c.cast('q') // 100 dmg + 30% slow 3t
      expect(c.dummyHp.value).toBe(900)
      expect(c.statuses.value).toEqual([{ kind: 'slow', label: 'SLOW 30%', ticksLeft: 3 }])
    })

    it('clears statuses on reset', async () => {
      const c = await consoleAtSix()
      c.cast('r')
      expect(c.statuses.value).toHaveLength(1)
      c.reset()
      expect(c.statuses.value).toHaveLength(0)
    })
  })

  describe('hero level', () => {
    it('offers the levels where a gate actually moves', () => {
      expect(CONSOLE_LEVELS).toEqual([1, ULTIMATE_UNLOCK_LEVEL, 11, 18])
    })

    it('refuses an ultimate below its unlock level and names the level', () => {
      const c = useTrainingConsole(ref(makeHero()))
      c.cast('r')
      expect(c.castCount.value).toBe(0)
      expect(c.cooldowns.r).toBe(0)
      expect(
        c.log.value.some((l) => l.includes(`R unlocks at level ${ULTIMATE_UNLOCK_LEVEL}`)),
      ).toBe(true)
    })

    it('casts the ultimate once the selected level unlocks it', async () => {
      const c = await atLevel(useTrainingConsole(ref(makeHero())), ULTIMATE_UNLOCK_LEVEL)
      c.cast('r')
      expect(c.castCount.value).toBe(1)
    })

    it('reports each slot rank at the selected level', async () => {
      const c = useTrainingConsole(ref(makeHero()))
      expect(c.rankOf('q')).toBe(1)
      expect(c.rankOf('r')).toBe(0)
      expect(c.isLocked('r')).toBe(true)
      await atLevel(c, 18)
      expect(c.rankOf('q')).toBe(4)
      expect(c.rankOf('r')).toBe(3)
      expect(c.isLocked('r')).toBe(false)
      expect(c.maxRankFor('q')).toBe(4)
      expect(c.maxRankFor('r')).toBe(3)
      expect(c.unlockLevelFor('r')).toBe(ULTIMATE_UNLOCK_LEVEL)
    })

    it('grows the BW pool with growthPerLevel, mirroring levelUpHero', async () => {
      const hero = makeHero({ growthPerLevel: { bw: 40 } })
      const c = await atLevel(useTrainingConsole(ref(hero)), 11)
      expect(c.maxMana.value).toBe(200 + 40 * 10)
      expect(c.mana.value).toBe(600) // reset refills to the level-11 pool
      c.advanceTick()
      expect(c.mana.value).toBe(600) // already full — the refill can't overflow
    })

    it('refills mana per tick against the level pool, labelled as a sandbox aid', async () => {
      const hero = makeHero({ growthPerLevel: { bw: 40 } })
      const c = await atLevel(useTrainingConsole(ref(hero)), 11)
      c.cast('q') // −50 from a 600 pool
      c.advanceTick()
      expect(c.mana.value).toBe(580) // +30 (5% of 600), not 5% of the base 200
      expect(c.log.value.some((l) => l.includes('+30 mp sandbox refill'))).toBe(true)
    })

    it('resets the console when the level changes', async () => {
      const c = useTrainingConsole(ref(makeHero()))
      c.cast('q')
      expect(c.dummyHp.value).toBe(900)
      await atLevel(c, 18)
      expect(c.dummyHp.value).toBe(1000)
      expect(c.cooldowns.q).toBe(0)
      expect(c.log.value[0]).toContain('Tester at level 18')
    })
  })
})
