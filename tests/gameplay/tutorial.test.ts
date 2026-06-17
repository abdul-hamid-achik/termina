import { describe, it, expect } from 'vitest'
import { seedGame, HUMAN } from './harness'

/**
 * Tutorial mode (slice 1): a game seeded with `mode: 'tutorial'` at the
 * createGame seam. This slice only proves the mode flag is plumbed end-to-end
 * (state + broadcast) and that a tutorial game is otherwise a normal, playable
 * game on its chosen map. Command-gating + hints land in later slices.
 */
describe('tutorial mode', () => {
  it('stamps mode=tutorial on the game state', async () => {
    const game = await seedGame('fresh', { mode: 'tutorial' })
    const s = await game.state()
    expect(s.mode).toBe('tutorial')
  })

  it('defaults to mode=normal when unspecified', async () => {
    const game = await seedGame('fresh')
    const s = await game.state()
    expect(s.mode).toBe('normal')
  })

  it('pairs naturally with the one-lane map and stays playable', async () => {
    const game = await seedGame('fresh', { mode: 'tutorial', mapId: 'one_lane' })
    const s = await game.state()
    expect(s.mode).toBe('tutorial')
    expect(s.mapId).toBe('one_lane')

    // A tutorial game is still a real game: the player can walk the lane.
    expect((await game.me()).zone).toBe('radiant-fountain')
    game.submit({ type: 'move', zone: 'radiant-base' })
    await game.tick()
    expect((await game.me()).zone).toBe('radiant-base')
    expect(game.lastRejected.some((r) => r.playerId === HUMAN)).toBe(false)
  })
})
