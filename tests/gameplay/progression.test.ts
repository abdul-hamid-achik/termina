import { describe, it, expect } from 'vitest'
import { seedGame, HUMAN } from './harness'
import { DAY_DURATION_CYCLES, NIGHT_DURATION_CYCLES } from '~~/shared/constants/balance'

/**
 * Engine-truth coverage for hero leveling, driven through the real processCycle
 * checkLevelUps phase. XP thresholds: level 2 needs 100 XP, level 6 needs 700.
 * checkLevelUps grants at most ONE level per cycle.
 */
describe('progression: leveling up', () => {
  it('a hero that crosses the XP threshold gains a level and emits level_up', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      // Exactly the level-2 threshold (100 XP) at level 1.
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, level: 1, xp: 100 } },
    }))

    await game.tick()

    const me = await game.me()
    expect(me.level).toBe(2)
    expect(
      game.lastEvents.some(
        (e) => e._tag === 'level_up' && e.playerId === HUMAN && e.newLevel === 2,
      ),
    ).toBe(true)
  })

  it('reaching level 6 also fires a power_spike (ultimate online)', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, level: 5, xp: 700 } },
    }))

    await game.tick()

    const me = await game.me()
    expect(me.level).toBe(6)
    expect(game.lastEvents.some((e) => e._tag === 'level_up' && e.playerId === HUMAN)).toBe(true)
    expect(game.lastEvents.some((e) => e._tag === 'power_spike' && e.playerId === HUMAN)).toBe(true)
  })

  it('leveling up makes the hero stronger — max INTEG/BW grow, not just the level number', async () => {
    // The other tests prove the level NUMBER ticks up; this proves the level is
    // APPLIED — levelUpHero folds the hero's growthPerLevel into maxInteg/maxBw, so
    // a level-up makes the hero tankier with a deeper BW pool (echo: +55 / +25).
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, level: 1, xp: 0 } },
      waves: [], // no wave XP so the level stays put until we feed it
    }))

    // Settle first: the seed's first-tick stat recompute lands, so the baseline
    // we measure at level 1 is stable.
    await game.tick()
    const atL1 = await game.me()
    expect(atL1.level).toBe(1)

    // Feed exactly the level-2 threshold and tick — the hero levels once.
    await game.patch((s) => ({
      ...s,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, xp: 100 } },
      waves: [],
    }))
    await game.tick()

    const atL2 = await game.me()
    expect(atL2.level).toBe(2)
    // The growth is real, not cosmetic: a strictly larger INTEG and BW pool.
    expect(atL2.maxInteg).toBeGreaterThan(atL1.maxInteg)
    expect(atL2.maxBw).toBeGreaterThan(atL1.maxBw)
  })

  it('a hero short of the next threshold does not level up', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      // Well short of 100, and no waves around to feed any XP.
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, level: 1, xp: 10 } },
      waves: [],
    }))

    await game.tick()

    const me = await game.me()
    expect(me.level).toBe(1)
    expect(game.lastEvents.some((e) => e._tag === 'level_up' && e.playerId === HUMAN)).toBe(false)
  })
})

// The cycle (night reduces vision) never crosses its 300/240-tick thresholds in
// ordinary tests, so the transition went untested. These drive it directly.
describe('progression: day/night cycle', () => {
  it('day flips to night at DAY_DURATION_CYCLES, resets the clock, and emits night_falls', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({ ...s, timeOfDay: 'day', dayNightCycle: DAY_DURATION_CYCLES - 1 }))

    await game.tick()

    const state = await game.state()
    expect(state.timeOfDay).toBe('night')
    expect(state.dayNightCycle).toBe(0)
    expect(game.lastEvents.some((e) => e._tag === 'night_falls')).toBe(true)
  })

  it('night flips back to day at NIGHT_DURATION_CYCLES and emits day_breaks', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      timeOfDay: 'night',
      dayNightCycle: NIGHT_DURATION_CYCLES - 1,
    }))

    await game.tick()

    const state = await game.state()
    expect(state.timeOfDay).toBe('day')
    expect(game.lastEvents.some((e) => e._tag === 'day_breaks')).toBe(true)
  })

  it('stays day mid-cycle (just ticks the clock forward, no transition event)', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({ ...s, timeOfDay: 'day', dayNightCycle: 10 }))

    await game.tick()

    const state = await game.state()
    expect(state.timeOfDay).toBe('day')
    expect(state.dayNightCycle).toBe(11)
    expect(game.lastEvents.some((e) => e._tag === 'night_falls')).toBe(false)
  })
})
