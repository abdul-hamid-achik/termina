import { describe, it, expect } from 'vitest'
import { seedGame, HUMAN, ENEMY } from './harness'
import { TUTORIAL_STEP_COUNT } from '~~/server/game/modes/tutorial'

/** Did the human's action get rejected with a tutorial-lock hint this tick? */
function lockedThisTick(rejected: Array<{ playerId: string; reason: string }>): boolean {
  return rejected.some((r) => r.playerId === HUMAN && r.reason.includes('🎓'))
}

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

  describe('staggered command unlocks', () => {
    it('blocks non-move commands at step 0 (only move is unlocked)', async () => {
      const game = await seedGame('fresh', { mode: 'tutorial', mapId: 'one_lane' })

      // Attacking before you've learned to move is gated with a teaching hint.
      game.attackHero('daemon')
      await game.tick()
      expect(lockedThisTick(game.lastRejected)).toBe(true)
      expect(game.lastRejected.find((r) => r.playerId === HUMAN)?.reason).toContain('Walk down')

      // Move itself is allowed at step 0.
      game.submit({ type: 'move', zone: 'radiant-base' })
      await game.tick()
      expect(lockedThisTick(game.lastRejected)).toBe(false)
    })

    it('advances the move step only once the human reaches the lane', async () => {
      const game = await seedGame('fresh', { mode: 'tutorial', mapId: 'one_lane' })
      expect((await game.state()).tutorialStep).toBe(0)

      // From the fountain the first hop only reaches base (still "home") — the
      // move step holds, since the attack/cast steps need lane targets.
      game.submit({ type: 'move', zone: 'radiant-base' })
      await game.tick()
      expect((await game.state()).tutorialStep).toBe(0)

      // Stepping into the lane completes the move step → advances to attack.
      game.submit({ type: 'move', zone: 'mid-t3-rad' })
      await game.tick()
      expect((await game.state()).tutorialStep).toBe(1)
    })

    it('walks the full move → attack progression (steps 0 → 2)', async () => {
      const game = await seedGame('fresh', { mode: 'tutorial', mapId: 'one_lane' })

      // Move into the lane to clear the move step.
      game.submit({ type: 'move', zone: 'radiant-base' })
      await game.tick()
      game.submit({ type: 'move', zone: 'mid-t3-rad' })
      await game.tick()
      expect((await game.state()).tutorialStep).toBe(1) // attack step

      // Put the enemy in the human's lane zone so the attack lands, then attack.
      await game.patch((s) => ({
        ...s,
        players: { ...s.players, [ENEMY]: { ...s.players[ENEMY]!, zone: 'mid-t3-rad', hp: 800 } },
      }))
      game.attackHero(ENEMY)
      await game.tick()

      // A landed attack completes step 1 → the tutorial unlocks casting (step 2).
      expect((await game.state()).tutorialStep).toBe(2)
    })

    it('lets informational commands through at any step (status at step 0)', async () => {
      const game = await seedGame('fresh', { mode: 'tutorial', mapId: 'one_lane' })
      game.submit({ type: 'status' })
      await game.tick()
      expect(lockedThisTick(game.lastRejected)).toBe(false)
    })

    it('gates cast + buy at step 1 but lets attack through', async () => {
      const game = await seedGame('fresh', { mode: 'tutorial', mapId: 'one_lane' })
      await game.patch((s) => ({ ...s, tutorialStep: 1 })) // attack unlocked, cast/buy not

      game.submit({ type: 'cast', ability: 'q' })
      await game.tick()
      expect(lockedThisTick(game.lastRejected)).toBe(true)

      game.submit({ type: 'buy', item: 'boots' })
      await game.tick()
      expect(lockedThisTick(game.lastRejected)).toBe(true)

      // Attack passes the tutorial gate (it may still fail on target, but not
      // with a tutorial-lock hint).
      game.attackHero('daemon')
      await game.tick()
      expect(lockedThisTick(game.lastRejected)).toBe(false)
    })

    it('unlocks everything once past the last scripted step (free play)', async () => {
      const game = await seedGame('fresh', { mode: 'tutorial', mapId: 'one_lane' })
      await game.patch((s) => ({ ...s, tutorialStep: TUTORIAL_STEP_COUNT }))

      for (const command of [
        { type: 'cast', ability: 'q' } as const,
        { type: 'buy', item: 'boots' } as const,
        { type: 'move', zone: 'radiant-base' } as const,
      ]) {
        game.submit(command)
        await game.tick()
        expect(lockedThisTick(game.lastRejected)).toBe(false)
      }
    })

    it('never gates a normal (non-tutorial) game', async () => {
      const game = await seedGame('fresh')

      game.attackHero('daemon')
      await game.tick()
      expect(lockedThisTick(game.lastRejected)).toBe(false)

      game.submit({ type: 'buy', item: 'boots' })
      await game.tick()
      expect(lockedThisTick(game.lastRejected)).toBe(false)
    })
  })
})
