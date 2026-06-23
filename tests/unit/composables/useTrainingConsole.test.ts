import { describe, it, expect } from 'vitest'
import { ref, nextTick } from 'vue'
import { useTrainingConsole } from '../../../app/composables/useTrainingConsole'
import type { HeroDef, AbilityDef } from '../../../shared/types/hero'

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
    baseStats: {
      hp: 600,
      mp: 200,
      attack: 50,
      defense: 0,
      magicResist: 0,
      moveSpeed: 1,
      attackRange: 'ranged',
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
  it('initializes mana to the hero max and greets in the log', () => {
    const c = useTrainingConsole(ref(makeHero()))
    expect(c.mana.value).toBe(200)
    expect(c.dummyHp.value).toBe(1000)
    expect(c.log.value[0]).toContain('Tester loaded')
  })

  it('cast Q spends mana, sets cooldown, and burst-damages the dummy', () => {
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

  it('rejects a cast with insufficient mana', () => {
    const c = useTrainingConsole(ref(makeHero()))
    c.cast('e') // costs 500, have 200
    expect(c.mana.value).toBe(200)
    expect(c.log.value.some((l) => l.includes('not enough mana'))).toBe(true)
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

  it('regenerates mana (≥2) and decrements cooldowns each tick', () => {
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
      baseStats: { ...makeHero().baseStats, mp: 100 },
    })
    await nextTick()
    expect(c.mana.value).toBe(100)
    expect(c.dummyHp.value).toBe(1000)
    expect(c.log.value[0]).toContain('Other loaded')
  })

  it('trims the log to the last 50 lines', () => {
    const c = useTrainingConsole(ref(makeHero()))
    for (let i = 0; i < 60; i++) c.advanceTick()
    expect(c.log.value.length).toBeLessThanOrEqual(50)
  })
})
