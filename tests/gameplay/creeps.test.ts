import { describe, it, expect } from 'vitest'
import { seedGame } from './harness'

/**
 * Engine-truth coverage for lane creep combat (CreepAI). When opposing waves
 * meet in a zone they trade blows rather than walking past each other — the
 * basis of lane equilibrium. Creeps don't regen, so any HP drop is combat.
 * Placed in an empty river zone so no heroes/towers confound the trade.
 */
describe('creeps: lane combat', () => {
  it('opposing creep waves fight when they meet in a lane', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      creeps: [
        { id: 'rc', team: 'radiant', zone: 'top-river', hp: 400, type: 'melee' },
        { id: 'dc', team: 'dire', zone: 'top-river', hp: 400, type: 'melee' },
      ],
    }))

    await game.tick()

    const state = await game.state()
    const rc = state.creeps.find((c) => c.id === 'rc')
    const dc = state.creeps.find((c) => c.id === 'dc')
    // Both traded blows — neither walked past the other untouched.
    expect(rc && rc.hp < 400).toBe(true)
    expect(dc && dc.hp < 400).toBe(true)
  })

  it('a creep at 1 HP is finished off by the opposing wave', async () => {
    const game = await seedGame('laning_combat', { heroSelf: 'echo' })
    await game.patch((s) => ({
      ...s,
      creeps: [
        { id: 'rc', team: 'radiant', zone: 'top-river', hp: 400, type: 'melee' },
        { id: 'dc', team: 'dire', zone: 'top-river', hp: 1, type: 'melee' },
      ],
    }))

    await game.tick()

    // The 1-HP dire creep dies and is reaped from the board.
    expect((await game.state()).creeps.find((c) => c.id === 'dc')).toBeUndefined()
  })
})
