import { describe, it, expect } from 'vitest'
import { seedGame, HUMAN, type Run } from './harness'
import {
  TUTORIAL_FLOW,
  TUTORIAL_STEP_COUNT,
  TUTORIAL_STEP_DEADLINE_CYCLES,
  TUTORIAL_SKIP_AFTER_DEADLINES,
  ICE_DRILL_ZONE,
  TUTORIAL_IDLE_END_CYCLES,
  TUTORIAL_IDLE_END_NOTICE,
} from '~~/shared/constants/tutorial'
import { APPROACH_HOLD_INTEG_RATIO } from '~~/shared/constants/balance'
import { tutorialGameOverSummary } from '~~/server/workflows/gameTickCore'
import { tutorialMasteryAchieved } from '~~/server/game/modes/tutorial'

/**
 * Playtest 3 (Oct 2026), tutorial pacing.
 *
 *  - "🎓 Moving on — Movement…" fired at cycle 45 (3 min) with the hero still in
 *    the fountain: the player was READING. A deadline that skips a drill nobody
 *    has tried yet teaches nothing; the opening drills (move, attack) and the
 *    final ICE drill (whose skip ends the game) now start their skip clock at
 *    the player's FIRST order in the step. Until then the deadlines still push
 *    the step's help — never stuck, never skipped.
 *  - The ICE drill's skip GRADUATES, i.e. ends the game: run 1 ended around
 *    cycle 145 as the player typed the ICE order (the drill opened ~100, read for
 *    45 cycles). It no longer skips under a live ICE order either.
 *  - "keep walking toward `coldstore-t2-chaff`" was said after
 *    `move coldstore-t3-chaff`: the en-route notice names the zone ordered.
 */

const SKIP_AFTER = TUTORIAL_STEP_DEADLINE_CYCLES * TUTORIAL_SKIP_AFTER_DEADLINES
const stepIndex = (id: (typeof TUTORIAL_FLOW)[number]['id']): number =>
  TUTORIAL_FLOW.findIndex((s) => s.id === id)

/** Tick `n` cycles one at a time, collecting the human's notices. */
async function tickCollect(game: Run, n: number): Promise<string[]> {
  const seen: string[] = []
  for (let i = 0; i < n; i++) {
    await game.tick()
    seen.push(...game.lastNotices.filter((x) => x.playerId === HUMAN).map((x) => x.message))
    if ((await game.state()).phase === 'ended') break
  }
  return seen
}

/** A tutorial parked on `id` from a NON-default cycle (`at`), the human at
 *  `zone`. Their last order cleared the step before (on the step's opening
 *  cycle) — so the tutorial's idle budget runs from `at`, not from cycle 0. */
async function seedAt(id: (typeof TUTORIAL_FLOW)[number]['id'], zone: string, at: number) {
  const game = await seedGame('fresh', { mode: 'tutorial', mapId: 'one_lane' })
  await game.patch((s) => ({
    ...s,
    cycle: at,
    tutorialStep: stepIndex(id),
    tutorialStepSince: at,
    players: {
      ...s.players,
      [HUMAN]: { ...s.players[HUMAN]!, zone, alive: true, lastActionCycle: at },
    },
  }))
  return game
}

describe('a reader is never skipped past a drill they have not tried', () => {
  it('the move drill holds (with help every deadline) while the player has typed nothing', async () => {
    const game = await seedGame('fresh', { mode: 'tutorial', mapId: 'one_lane' })
    const seen = await tickCollect(game, SKIP_AFTER + 20)
    const s = await game.state()
    expect(s.tutorialStep ?? 0).toBe(stepIndex('move'))
    expect(s.tutorialSkips ?? 0).toBe(0)
    expect(seen.some((m) => m.includes('Moving on'))).toBe(false)
    // The gentle nudge: the step's help, once per exhausted deadline.
    expect(seen.filter((m) => m === TUTORIAL_FLOW[stepIndex('move')]!.help).length).toBe(4)
  })

  it('the skip clock starts at the first order — the escape hatch is kept for a player who acts', async () => {
    const game = await seedGame('fresh', { mode: 'tutorial', mapId: 'one_lane' })
    await tickCollect(game, 30) // reading
    // An order that does not clear the drill (another home tile).
    game.submit({ type: 'move', zone: 'rookery-terminal' })
    const ordered = (await game.state()).cycle + 1
    // The order's own cycle plus 44 more: one short of the skip.
    let seen = await tickCollect(game, SKIP_AFTER)
    expect((await game.state()).tutorialStep ?? 0).toBe(stepIndex('move'))
    expect(seen.some((m) => m.includes('Moving on'))).toBe(false)
    seen = await tickCollect(game, 1)
    const s = await game.state()
    expect(s.cycle).toBe(ordered + SKIP_AFTER)
    expect(s.tutorialStep).toBe(stepIndex('attack'))
    expect(s.tutorialSkipped).toEqual(['move'])
    expect(seen.some((m) => m.startsWith('🎓 Moving on — '))).toBe(true)
  })

  it('the attack drill holds for an idle reader on the lane, from a late cycle', async () => {
    const game = await seedAt('attack', 'coldstore-t2-chaff', 211)
    const seen = await tickCollect(game, SKIP_AFTER + 5)
    const s = await game.state()
    expect(s.tutorialStep).toBe(stepIndex('attack'))
    expect(s.tutorialSkips ?? 0).toBe(0)
    expect(seen.some((m) => m.includes('Moving on'))).toBe(false)
  })

  it('a drill past the opening two keeps its deadline skip (counted from the step start)', async () => {
    const game = await seedAt('buy', 'coldstore-t2-chaff', 211)
    await tickCollect(game, SKIP_AFTER)
    const s = await game.state()
    expect(s.tutorialSkipped).toEqual(['buy'])
  })
})

describe('the ICE drill does not end the game under a player who is doing it', () => {
  it('reads for 45 cycles, then types the order: walks, swings, graduates — mastered, no skip', async () => {
    // Playtest 3 run 1: the drill opened ~cycle 100, the player read the hint,
    // and the game ENDED as they typed `attack ice:…` at ~145 — the drill's
    // third deadline skipped it, and skipping the last drill graduates.
    const game = await seedAt('ice', 'rookery-terminal', 100)
    let seen = await tickCollect(game, SKIP_AFTER)
    expect((await game.state()).phase).toBe('playing')
    expect(seen.some((m) => m.includes('Moving on'))).toBe(false)

    game.submit({ type: 'attack', target: { kind: 'ice', zone: ICE_DRILL_ZONE } })
    seen = await tickCollect(game, 30)
    const s = await game.state()
    expect(s.phase).toBe('ended')
    expect(s.tutorialStep).toBe(TUTORIAL_STEP_COUNT)
    expect(s.tutorialSkips ?? 0).toBe(0)
    expect(tutorialMasteryAchieved(s)).toBe(true)
    expect(seen.some((m) => m.includes('practice complete'))).toBe(true)
  })

  it('the order that cleared the drill before (the tap) does not start the ICE drill’s skip clock', async () => {
    const game = await seedAt('tap', 'rookery-terminal', 100)
    await game.patch((s) => ({
      ...s,
      players: {
        ...s.players,
        [HUMAN]: { ...s.players[HUMAN]!, items: ['camtap', null, null, null, null, null] },
      },
    }))
    game.submit({ type: 'tap', zone: 'rookery-terminal' })
    await tickCollect(game, 1)
    expect((await game.state()).tutorialStep).toBe(stepIndex('ice'))
    const seen = await tickCollect(game, SKIP_AFTER + 5) // reading the ICE hint
    const s = await game.state()
    expect(s.phase).toBe('playing')
    expect(s.tutorialSkips ?? 0).toBe(0)
    expect(seen.some((m) => m.includes('Moving on') || m.includes('Practice over'))).toBe(false)
  })

  it('a live ICE order holds the skip even past the deadline; once dropped, the skip (and the end) comes with its reason', async () => {
    const game = await seedAt('ice', 'rookery-terminal', 100)
    // Acted early (the clock runs), then holds the ICE order across the deadline.
    await game.patch((s) => ({
      ...s,
      tutorialStepSince: 100 - SKIP_AFTER,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          lastActionCycle: 100 - SKIP_AFTER + 1,
          attackTarget: { kind: 'ice', zone: ICE_DRILL_ZONE },
          // Rooted in base: the order is live but cannot progress this cycle.
          buffs: [{ id: 'root', stacks: 1, cyclesRemaining: 3, source: 'test' }],
          moveTarget: ICE_DRILL_ZONE,
        },
      },
    }))
    await tickCollect(game, 1)
    expect((await game.state()).phase).toBe('playing')
    expect((await game.state()).tutorialSkips ?? 0).toBe(0)

    // The player drops the order (any other order replaces it). That order
    // RESTARTS the ICE drill's clock (its skip ends the game): nothing for a
    // full skip window — then, nothing in progress, it skips and says why.
    game.submit({ type: 'move', zone: 'rookery-anchor' })
    const quiet = await tickCollect(game, SKIP_AFTER)
    expect((await game.state()).phase).toBe('playing')
    expect(quiet.some((m) => m.includes('Moving on') || m.includes('Practice over'))).toBe(false)
    const seen = await tickCollect(game, 1)
    const s = await game.state()
    expect(s.phase).toBe('ended')
    expect(s.tutorialSkipped).toEqual(['ice'])
    expect(seen).toContain(
      '🎓 Practice over — the ICE drill timed out and was skipped. Run practice again to master it.',
    )
  })
})

describe('the en-route notice names the zone the player actually ordered', () => {
  it.each(['coldstore-t3-chaff', 'coldstore-t2-chaff'])(
    '`move %s` from the fountain names that zone, not another',
    async (zone) => {
      const game = await seedGame('fresh', { mode: 'tutorial', mapId: 'one_lane' })
      game.submit({ type: 'move', zone })
      const seen = await tickCollect(game, 1)
      const enroute = seen.find((m) => m.startsWith('🎓 On your way — the order stands.'))
      expect(enroute).toContain(`keep walking toward \`${zone}\``)
      for (const other of ['coldstore-t3-chaff', 'coldstore-t2-chaff'].filter((z) => z !== zone)) {
        expect(enroute).not.toContain(other)
      }
    },
  )
})

/**
 * Round-4 review: in the ICE drill, the low-INTEG approach hold (GameLoop)
 * dropped the player's held ICE walk + attack — and later in the SAME cycle the
 * drill's skip saw no live ICE order with its clock long spent, so it skipped
 * and ENDED the practice under a player who was acting ("Holding at …" →
 * "Moving on" → "Practice over — the ICE drill timed out").
 */
describe('the ICE drill under the approach hold', () => {
  it('a low-INTEG player on a held ICE walk keeps walking — no hold, no skip, no end', async () => {
    const game = await seedGame('fresh', { mode: 'tutorial', mapId: 'one_lane' })
    await game.patch((s) => ({
      ...s,
      cycle: 200,
      tutorialStep: stepIndex('ice'),
      tutorialStepSince: 100,
      tutorialFirstOrderCycle: 120,
      players: {
        ...s.players,
        [HUMAN]: {
          ...s.players[HUMAN]!,
          zone: 'coldstore-cross',
          alive: true,
          // The order was typed at 120 — 80 cycles ago, past the skip window.
          lastActionCycle: 120,
          integ: Math.floor(s.players[HUMAN]!.maxInteg * APPROACH_HOLD_INTEG_RATIO * 0.8),
          moveTarget: ICE_DRILL_ZONE,
          attackTarget: { kind: 'ice', zone: ICE_DRILL_ZONE },
        },
      },
    }))
    const seen = await tickCollect(game, 1)
    const s = await game.state()
    expect(s.phase).toBe('playing')
    expect(s.tutorialSkips ?? 0).toBe(0)
    expect(seen.some((m) => m.startsWith('Holding at'))).toBe(false)
    expect(s.players[HUMAN]!.zone).toBe(ICE_DRILL_ZONE)
    expect(s.players[HUMAN]!.attackTarget).toEqual({ kind: 'ice', zone: ICE_DRILL_ZONE })
  })

  it('any order restarts the ICE drill’s skip clock — even one that is not the ICE order', async () => {
    const game = await seedAt('ice', 'rookery-terminal', 100)
    // The drill opened long ago and the FIRST order in it is long spent.
    await game.patch((s) => ({
      ...s,
      tutorialStepSince: 40,
      tutorialFirstOrderCycle: 50,
      players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, lastActionCycle: 50 } },
    }))
    game.submit({ type: 'status' })
    let seen = await tickCollect(game, SKIP_AFTER)
    expect((await game.state()).phase).toBe('playing')
    expect(seen.some((m) => m.includes('Moving on') || m.includes('Practice over'))).toBe(false)
    seen = await tickCollect(game, 1)
    expect((await game.state()).tutorialSkipped).toEqual(['ice'])
  })
})

/**
 * Round-4 review (cost): an abandoned tutorial ran ~675 cycles — the idle
 * backstop was paid per drill. ONE idle budget now ends it, and the tutorial
 * never AFK-converts (a converted human's AI orders would read as the player's
 * own and keep the practice — and its Workflow/Neon/Ably bill — alive).
 */
describe('an abandoned practice ends on ONE idle budget', () => {
  async function runIdle(offline: boolean) {
    const game = await seedGame('fresh', { mode: 'tutorial', mapId: 'one_lane' })
    if (offline) {
      // Ably confirms the human gone at every sample (primary AND confirm).
      await game.patch((s) => ({
        ...s,
        presenceOffline: Object.fromEntries(
          Array.from({ length: TUTORIAL_IDLE_END_CYCLES * 2 }, (_, c) => [c + 1, [HUMAN]]),
        ),
      }))
    }
    const seen = await tickCollect(game, TUTORIAL_IDLE_END_CYCLES * 2)
    return { game, seen, s: await game.state() }
  }

  it.each([false, true])(
    'an idle player (offline at every presence sample: %s) ends at the budget, left_early',
    async (offline) => {
      const { game, seen, s } = await runIdle(offline)
      expect(s.phase).toBe('ended')
      expect(s.cycle).toBe(TUTORIAL_IDLE_END_CYCLES)
      expect(seen.at(-1)).toBe(TUTORIAL_IDLE_END_NOTICE)
      expect(s.tutorialSkips ?? 0).toBe(0)
      expect(tutorialGameOverSummary(s, 'tutorial')?.reason).toBe('left_early')
      expect(s.players[HUMAN]!.aiControlled ?? false).toBe(false)
      expect(game.allEvents.some((e) => e._tag === 'afk_takeover')).toBe(false)
    },
  )

  it('an active player is never cut off: the budget runs from the LAST order', async () => {
    const game = await seedGame('fresh', { mode: 'tutorial', mapId: 'one_lane' })
    await tickCollect(game, TUTORIAL_IDLE_END_CYCLES - 2)
    game.submit({ type: 'status' }) // resolves on cycle BUDGET-1
    const ordered = TUTORIAL_IDLE_END_CYCLES - 1
    await tickCollect(game, TUTORIAL_IDLE_END_CYCLES) // to ordered + BUDGET - 1
    let s = await game.state()
    expect(s.cycle).toBe(ordered + TUTORIAL_IDLE_END_CYCLES - 1)
    expect(s.phase).toBe('playing')
    await tickCollect(game, 1)
    s = await game.state()
    expect(s.phase).toBe('ended')
  })
})
