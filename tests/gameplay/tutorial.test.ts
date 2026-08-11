import { describe, it, expect } from 'vitest'
import { seedGame, HUMAN } from './harness'
import {
  TUTORIAL_STEP_COUNT,
  TUTORIAL_STEP_DEADLINE_CYCLES,
  tutorialHint,
  tutorialMasteryAchieved,
} from '~~/server/game/modes/tutorial'
import { TUTORIAL_FLOW, TUTORIAL_SKIP_AFTER_DEADLINES } from '~~/shared/constants/tutorial'
import { canSurrender } from '~~/server/game/engine/SurrenderSystem'
import { SURRENDER_MIN_CYCLE, STRIP_HP_THRESHOLD, LINE_UNIT_HP } from '~~/shared/constants/balance'

/** Index of a drill in the flow, by id — steps are data, tests shouldn't hardcode positions. */
const stepIndex = (id: (typeof TUTORIAL_FLOW)[number]['id']): number =>
  TUTORIAL_FLOW.findIndex((s) => s.id === id)

/** Did the human's action get rejected with a tutorial-lock hint this cycle? */
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
    expect((await game.me()).zone).toBe('rookery-anchor')
    game.submit({ type: 'move', zone: 'rookery-terminal' })
    await game.tick()
    expect((await game.me()).zone).toBe('rookery-terminal')
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
      game.submit({ type: 'move', zone: 'rookery-terminal' })
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
        { forceLane: 'coldstore', difficulty: 'easy' },
      )
      try {
        await game.tick(30)
        // Bots left their fountains (their moves/buys were NOT tutorial-locked)…
        const ally = await game.player('bot_ally')
        const foe = await game.player('bot_foe')
        expect(ally.zone === 'rookery-anchor' && foe.zone === 'landing-anchor').toBe(false)
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
      game.submit({ type: 'move', zone: 'rookery-terminal' })
      await game.tick()
      expect((await game.state()).tutorialStep).toBe(0)

      // Stepping into the lane completes the move step → advances to attack.
      game.submit({ type: 'move', zone: 'coldstore-t3-chaff' })
      await game.tick()
      expect((await game.state()).tutorialStep).toBe(1)
    })

    it('walks the full move → attack progression (steps 0 → 2)', async () => {
      const game = await seedGame('fresh', { mode: 'tutorial', mapId: 'one_lane' })

      // Move into the lane to clear the move step.
      game.submit({ type: 'move', zone: 'rookery-terminal' })
      await game.tick()
      game.submit({ type: 'move', zone: 'coldstore-t3-chaff' })
      await game.tick()
      expect((await game.state()).tutorialStep).toBe(1) // attack step

      // The attack drill's objective is DAMAGE ON A WAVE UNIT — a swing at a
      // hero doesn't clear it. Seed a healthy enemy unit and hit it.
      await game.patch((s) => ({
        ...s,
        waves: [
          {
            id: 'wave-drill',
            team: 'audit' as const,
            zone: 'coldstore-t3-chaff',
            integ: LINE_UNIT_HP,
            maxInteg: LINE_UNIT_HP,
            type: 'line' as const,
          },
        ],
      }))
      game.submit({ type: 'attack', target: { kind: 'wave', index: 0 } })
      await game.tick()

      // A landed wave hit completes step 1 → the strip drill opens (step 2).
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
        tutorialStepSince: s.cycle,
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
        { type: 'move', zone: 'rookery-terminal' } as const,
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
    // with no menu and no surrender — SURRENDER_MIN_CYCLE is 225 (15 min), so
    // the only real way out was closing the tab.
    it('ends the game and credits the human when the last step completes', async () => {
      const game = await seedGame('fresh', { mode: 'tutorial', mapId: 'one_lane' })
      // Park on the final step with EVERY deadline already exhausted (skips
      // only fire after TUTORIAL_SKIP_AFTER_DEADLINES of them now). Driving
      // graduation off the clock rather than an ice hit keeps the test about
      // "graduation ends the game" — and the skip path is the one a truly
      // stuck player takes anyway.
      await game.patch((s) => ({
        ...s,
        tutorialStep: TUTORIAL_STEP_COUNT - 1,
        tutorialStepSince: s.cycle - TUTORIAL_STEP_DEADLINE_CYCLES * TUTORIAL_SKIP_AFTER_DEADLINES,
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
      expect(early.cycle).toBeLessThan(SURRENDER_MIN_CYCLE)

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

  /**
   * The dead-end guard.
   *
   * Every other completion test in this file reaches the end by patching
   * `tutorialStep` — which skips the exact thing that was once broken. The
   * tutorial was, for a while, unfinishable by ANYONE: the flow could never
   * reach its last step, so completion never fired for a single player. A test
   * that starts at the end cannot see that.
   *
   * This one starts at step 0, never touches `tutorialStep`, and only ticks. It
   * passes only if a player who does nothing useful still arrives at the end via
   * the per-step deadline — which is the whole point of the deadline existing.
   */
  describe('the tutorial always terminates', () => {
    it('reaches completion from step 0 on deadlines alone — but counted, never mastered', async () => {
      const game = await seedGame('fresh', { mode: 'tutorial' })
      expect((await game.state()).tutorialStep ?? 0).toBe(0)

      // Enough cycles for every step to exhaust ALL its deadlines, plus slack.
      // A player who typed nothing at all must still arrive at the end (the
      // dead-end guarantee) — the design change is that arriving this way is
      // COUNTED: every step records a skip and mastery is denied, so the
      // funnel keeps offering practice instead of stamping a false graduation.
      const budget =
        TUTORIAL_STEP_COUNT * (TUTORIAL_STEP_DEADLINE_CYCLES * TUTORIAL_SKIP_AFTER_DEADLINES + 2)
      for (let i = 0; i < budget; i++) {
        await game.tick()
        if ((await game.state()).tutorialStep! >= TUTORIAL_STEP_COUNT) break
      }

      const s = await game.state()
      const step = s.tutorialStep ?? 0
      expect(step, `stuck on tutorial step ${step} after ${budget} cycles`).toBeGreaterThanOrEqual(
        TUTORIAL_STEP_COUNT,
      )
      expect(s.tutorialSkips ?? 0).toBeGreaterThan(0)
      expect(tutorialMasteryAchieved(s)).toBe(false)
    })

    it('never leaves the player with nothing legal to do', async () => {
      // At EVERY step the gate must permit something. A step that unlocks a verb
      // the live match makes impossible, with no informational escape hatch, is
      // the dead end in its other form.
      const game = await seedGame('fresh', { mode: 'tutorial' })
      for (let step = 0; step < TUTORIAL_STEP_COUNT; step++) {
        await game.patch((s) => ({ ...s, tutorialStep: step }))
        game.submit({ type: 'status' })
        await game.tick()
        expect(
          lockedThisTick(game.lastRejected),
          `step ${step} refused even a status readout`,
        ).toBe(false)
      }
    })

    it('every step has a hint that names what to do', async () => {
      for (let step = 0; step < TUTORIAL_STEP_COUNT; step++) {
        const hint = tutorialHint(step)
        expect(hint, `step ${step} has no hint`).toBeTruthy()
        expect(hint!.length, `step ${step} hint is too short to teach anything`).toBeGreaterThan(20)
      }
    })
  })

  /**
   * Objective-gated drills: a step completes only when the thing it teaches
   * ACTUALLY HAPPENED in the engine, and a stalled step gets the world nudged
   * into practicability instead of a silent advance.
   */
  describe('objective-gated drills', () => {
    /** Seed a tutorial game parked on a drill, with the human out in the lane. */
    async function seedAtStep(
      id: (typeof TUTORIAL_FLOW)[number]['id'],
      zone = 'coldstore-t3-chaff',
    ) {
      const game = await seedGame('fresh', { mode: 'tutorial', mapId: 'one_lane' })
      await game.patch((s) => ({
        ...s,
        tutorialStep: stepIndex(id),
        tutorialStepSince: s.cycle,
        players: {
          ...s.players,
          [HUMAN]: { ...s.players[HUMAN]!, zone, alive: true },
        },
      }))
      return game
    }

    const lowUnit = (team: 'chaff' | 'audit', zone: string) => ({
      id: `wave-low-${team}`,
      team,
      zone,
      integ: Math.floor(LINE_UNIT_HP * STRIP_HP_THRESHOLD) - 1,
      maxInteg: LINE_UNIT_HP,
      type: 'line' as const,
    })

    it('the strip drill completes on a REAL strip, not on plain wave damage', async () => {
      // A swing at a healthy unit damages it — that cleared the old tutorial,
      // but the strip drill demands the payload: only a wave_strip clears it.
      const game = await seedAtStep('strip')
      await game.patch((s) => ({
        ...s,
        waves: [
          {
            id: 'wave-fat',
            team: 'audit' as const,
            zone: 'coldstore-t3-chaff',
            integ: LINE_UNIT_HP,
            maxInteg: LINE_UNIT_HP,
            type: 'line' as const,
          },
        ],
      }))
      game.submit({ type: 'attack', target: { kind: 'wave', index: 0 } })
      await game.tick()
      expect((await game.state()).tutorialStep).toBe(stepIndex('strip')) // held

      // Now the unit is low — inside the window, the swing takes it: drill done.
      await game.patch((s) => ({
        ...s,
        waves: [lowUnit('audit', 'coldstore-t3-chaff')],
      }))
      game.submit({ type: 'attack', target: { kind: 'wave', index: 0 } })
      await game.tick()
      expect((await game.state()).tutorialStep).toBe(stepIndex('strip') + 1)
      expect((await game.state()).tutorialSkips ?? 0).toBe(0)
    })

    it('the burn drill completes on a real burn of your OWN unit', async () => {
      const game = await seedAtStep('burn')
      await game.patch((s) => ({
        ...s,
        waves: [lowUnit('chaff', 'coldstore-t3-chaff')],
      }))
      game.submit({ type: 'burn', target: { kind: 'wave', index: 0 } })
      await game.tick()
      expect((await game.state()).tutorialStep).toBe(stepIndex('burn') + 1)
    })

    it('a stalled strip drill gets the world nudged: a unit weakened into the window', async () => {
      // The crossing, not a T3 zone: standing ICE shoots the practice unit,
      // which is exactly the noise this drill's nudge must survive without.
      const game = await seedAtStep('strip', 'coldstore-cross')
      // A healthy wave stands in the zone; the player does nothing. When the
      // deadline lapses, the tutorial weakens it into the window instead of
      // skipping the lesson.
      await game.patch((s) => ({
        ...s,
        tutorialStepSince: s.cycle - TUTORIAL_STEP_DEADLINE_CYCLES + 1,
        waves: [
          {
            id: 'wave-sturdy',
            team: 'audit' as const,
            zone: 'coldstore-cross',
            integ: LINE_UNIT_HP,
            maxInteg: LINE_UNIT_HP,
            type: 'line' as const,
          },
        ],
      }))
      await game.tick()

      const s = await game.state()
      expect(s.tutorialStep).toBe(stepIndex('strip')) // NOT advanced
      const unit = s.waves.find((w) => w.zone === 'coldstore-cross' && w.team === 'audit')
      expect(unit, 'the practice unit vanished').toBeDefined()
      expect(unit!.integ).toBeLessThanOrEqual(LINE_UNIT_HP * STRIP_HP_THRESHOLD)
    })

    it('the buy drill grants a stipend on its deadline instead of stranding a broke player', async () => {
      const game = await seedAtStep('buy', 'rookery-terminal')
      await game.patch((s) => ({
        ...s,
        tutorialStepSince: s.cycle - TUTORIAL_STEP_DEADLINE_CYCLES + 1,
        players: {
          ...s.players,
          [HUMAN]: { ...s.players[HUMAN]!, scrip: 0 },
        },
      }))
      await game.tick()
      const s = await game.state()
      expect(s.tutorialStep).toBe(stepIndex('buy'))
      expect(s.players[HUMAN]!.scrip).toBeGreaterThanOrEqual(430) // edge_kit cost

      // And the drill still completes only on the actual purchase.
      game.submit({ type: 'buy', item: 'edge_kit' })
      await game.tick()
      expect((await game.state()).tutorialStep).toBe(stepIndex('buy') + 1)
    })

    it('the tap drill completes when a ward is actually placed', async () => {
      const game = await seedAtStep('tap', 'rookery-terminal')
      await game.patch((s) => ({
        ...s,
        players: {
          ...s.players,
          [HUMAN]: {
            ...s.players[HUMAN]!,
            items: ['camtap', null, null, null, null, null],
          },
        },
      }))
      game.submit({ type: 'tap', zone: 'rookery-terminal' })
      await game.tick()
      expect((await game.state()).tutorialStep).toBe(stepIndex('tap') + 1)
    })

    it('a skipped drill is COUNTED and denies mastery', async () => {
      const game = await seedAtStep('ice')
      await game.patch((s) => ({
        ...s,
        tutorialStepSince: s.cycle - TUTORIAL_STEP_DEADLINE_CYCLES * TUTORIAL_SKIP_AFTER_DEADLINES,
      }))
      await game.tick()
      const s = await game.state()
      expect(s.tutorialStep).toBe(stepIndex('ice') + 1)
      expect(s.tutorialSkips).toBe(1)
      expect(tutorialMasteryAchieved(s)).toBe(false)
    })

    it('a clean run masters the tutorial (no skips)', async () => {
      const game = await seedGame('fresh', { mode: 'tutorial', mapId: 'one_lane' })
      expect(tutorialMasteryAchieved(await game.state())).toBe(true)
    })
  })
})
