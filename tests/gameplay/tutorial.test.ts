import { describe, it, expect } from 'vitest'
import { seedGame, HUMAN, ENEMY } from './harness'
import {
  TUTORIAL_STEP_COUNT,
  TUTORIAL_STEP_DEADLINE_TICKS,
  tutorialHint,
} from '~~/server/game/modes/tutorial'
import { canSurrender } from '~~/server/game/engine/SurrenderSystem'
import { SURRENDER_MIN_TICK } from '~~/shared/constants/balance'

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
    expect((await game.me()).zone).toBe('chaff-fountain')
    game.submit({ type: 'move', zone: 'chaff-base' })
    await game.tick()
    expect((await game.me()).zone).toBe('chaff-base')
    expect(game.lastRejected.some((r) => r.playerId === HUMAN)).toBe(false)
  })

  describe('staggered command unlocks', () => {
    it('blocks non-move commands at step 0 (only move is unlocked)', async () => {
      const game = await seedGame('fresh', { mode: 'tutorial', mapId: 'one_lane' })

      // Attacking before you've learned to move is gated with a teaching hint.
      game.attackHero('daemon')
      await game.tick()
      expect(lockedThisTick(game.lastRejected)).toBe(true)
      // The lock message IS the current step's hint — assert that relationship
      // rather than the copy, which gets reworded as the teaching improves.
      expect(game.lastRejected.find((r) => r.playerId === HUMAN)?.reason).toBe(tutorialHint(0))

      // Move itself is allowed at step 0.
      game.submit({ type: 'move', zone: 'chaff-base' })
      await game.tick()
      expect(lockedThisTick(game.lastRejected)).toBe(false)
    })

    it('exempts bots from the step gate — the tutorial world stays ALIVE while the human learns', async () => {
      // Regression: gating bots froze the whole tutorial (no farming ally, no
      // pushing enemies, a silent feed) until the human advanced the steps —
      // caught by the game_feed_story e2e flow showing a tick-181 game with an
      // empty combat feed.
      const { registerBots, cleanupGame } = await import('~~/server/game/ai/BotManager')
      const game = await seedGame('fresh', {
        mode: 'tutorial',
        mapId: 'one_lane',
        players: [
          { id: HUMAN, name: HUMAN, team: 'chaff', heroId: 'echo' },
          { id: 'bot_ally', name: 'bot_ally', team: 'chaff', heroId: 'kernel' },
          { id: 'bot_foe', name: 'bot_foe', team: 'audit', heroId: 'regex' },
        ],
      })
      registerBots(
        game.gameId,
        [
          { playerId: 'bot_ally', team: 'chaff', heroId: 'kernel' },
          { playerId: 'bot_foe', team: 'audit', heroId: 'regex' },
        ],
        { forceLane: 'mid', difficulty: 'easy' },
      )
      try {
        await game.tick(30)
        // Bots left their fountains (their moves/buys were NOT tutorial-locked)…
        const ally = await game.player('bot_ally')
        const foe = await game.player('bot_foe')
        expect(ally.zone === 'chaff-fountain' && foe.zone === 'audit-fountain').toBe(false)
        // …and the world produced events by tick 30 (a frozen tutorial had none).
        expect(game.allEvents.length).toBeGreaterThan(0)
      } finally {
        cleanupGame(game.gameId)
      }
    })

    it('advances the move step only once the human reaches the lane', async () => {
      const game = await seedGame('fresh', { mode: 'tutorial', mapId: 'one_lane' })
      expect((await game.state()).tutorialStep).toBe(0)

      // From the fountain the first hop only reaches base (still "home") — the
      // move step holds, since the attack/cast steps need lane targets.
      game.submit({ type: 'move', zone: 'chaff-base' })
      await game.tick()
      expect((await game.state()).tutorialStep).toBe(0)

      // Stepping into the lane completes the move step → advances to attack.
      game.submit({ type: 'move', zone: 'mid-t3-chaff' })
      await game.tick()
      expect((await game.state()).tutorialStep).toBe(1)
    })

    it('walks the full move → attack progression (steps 0 → 2)', async () => {
      const game = await seedGame('fresh', { mode: 'tutorial', mapId: 'one_lane' })

      // Move into the lane to clear the move step.
      game.submit({ type: 'move', zone: 'chaff-base' })
      await game.tick()
      game.submit({ type: 'move', zone: 'mid-t3-chaff' })
      await game.tick()
      expect((await game.state()).tutorialStep).toBe(1) // attack step

      // Put the enemy in the human's lane zone so the attack lands, then attack.
      await game.patch((s) => ({
        ...s,
        players: { ...s.players, [ENEMY]: { ...s.players[ENEMY]!, zone: 'mid-t3-chaff', hp: 800 } },
      }))
      game.attackHero(ENEMY)
      await game.tick()

      // A landed attack completes step 1 → the tutorial unlocks casting (step 2).
      expect((await game.state()).tutorialStep).toBe(2)
    })

    it('does NOT advance the attack step when the attack hit nothing', async () => {
      // The attack step used to tick green off a swing at an empty zone: the
      // resolver swallowed the mis-target, so advanceTutorialAfterTick saw an
      // accepted `attack` and taught the player that whiffing counts.
      const game = await seedGame('fresh', { mode: 'tutorial', mapId: 'one_lane' })
      await game.patch((s) => ({
        ...s,
        tutorialStep: 1,
        // Refresh the deadline so the step can only advance on the action.
        tutorialStepSince: s.tick,
        waves: [],
      }))

      game.submit({ type: 'attack', target: { kind: 'wave', index: 0 } })
      await game.tick()

      expect((await game.state()).tutorialStep).toBe(1)
      expect(lockedThisTick(game.lastRejected)).toBe(false)
      expect(game.lastRejected.some((r) => r.playerId === HUMAN && /wave/i.test(r.reason))).toBe(
        true,
      )
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
        { type: 'move', zone: 'chaff-base' } as const,
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

  describe('graduation ends the game (no limbo)', () => {
    // REGRESSION: the tutorial's designed happy path used to terminate in the
    // app's WORST state. The four hints finish around tick 60, the banner
    // announced "free play", and the player was then held in an endless 2v2
    // with no menu and no surrender — SURRENDER_MIN_TICK is 225 (15 min), so
    // the only real way out was closing the tab.
    it('ends the game and credits the human when the last step completes', async () => {
      const game = await seedGame('fresh', { mode: 'tutorial', mapId: 'one_lane' })
      // Park on the final step with its deadline already elapsed. Driving
      // graduation off the clock rather than a purchase keeps the test about
      // "graduation ends the game" instead of item economics — and the deadline
      // is the path a real stuck player takes anyway.
      await game.patch((s) => ({
        ...s,
        tutorialStep: TUTORIAL_STEP_COUNT - 1,
        tutorialStepSince: s.tick - TUTORIAL_STEP_DEADLINE_TICKS,
      }))
      await game.tick()

      const s = await game.state()
      expect(s.tutorialStep).toBeGreaterThanOrEqual(TUTORIAL_STEP_COUNT)
      expect(s.phase).toBe('ended')
      expect(s.winner).toBe(s.players[HUMAN]?.team)
    })

    it('leaves a mid-flow tutorial running (only graduation ends it)', async () => {
      const game = await seedGame('fresh', { mode: 'tutorial', mapId: 'one_lane' })
      await game.tick()
      const s = await game.state()
      expect(s.tutorialStep).toBeLessThan(TUTORIAL_STEP_COUNT)
      expect(s.phase).toBe('playing')
    })

    it('is quittable immediately — no 15-minute surrender lock', async () => {
      const game = await seedGame('fresh', { mode: 'tutorial', mapId: 'one_lane' })
      const early = await game.state()
      expect(early.tick).toBeLessThan(SURRENDER_MIN_TICK)

      expect(canSurrender(early, early.players[HUMAN]!.team).can).toBe(true)
    })

    it('still holds a NORMAL game to the surrender tick gate', async () => {
      const game = await seedGame('fresh')
      const s = await game.state()
      const verdict = canSurrender(s, s.players[HUMAN]!.team)
      expect(verdict.can).toBe(false)
      expect(verdict.reason).toContain('Too early')
    })
  })
})
