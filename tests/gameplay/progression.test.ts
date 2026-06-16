import { describe, it, expect } from 'vitest'
import { seedGame, HUMAN } from './harness'

/**
 * Engine-truth coverage for hero leveling, driven through the real processTick
 * checkLevelUps phase. XP thresholds: level 2 needs 100 XP, level 6 needs 700.
 * checkLevelUps grants at most ONE level per tick.
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

  it('a hero short of the next threshold does not level up', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      // Well short of 100, and no creeps around to feed any XP.
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, level: 1, xp: 10 } },
      creeps: [],
    }))

    await game.tick()

    const me = await game.me()
    expect(me.level).toBe(1)
    expect(game.lastEvents.some((e) => e._tag === 'level_up' && e.playerId === HUMAN)).toBe(false)
  })
})
