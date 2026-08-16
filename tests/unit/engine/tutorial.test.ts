import { describe, it, expect } from 'vitest'
import type { GameState } from '~~/shared/types/game'
import {
  TUTORIAL_FLOW,
  TUTORIAL_STEP_COUNT,
  tutorialUnlockedCommands,
  isCommandAllowedInTutorial,
  tutorialLockMessage,
  tutorialHint,
  advanceTutorialAfterTick,
  tutorialMasteryAchieved,
  buildTutorialRoster,
} from '~~/server/game/modes/tutorial'
import { isBot } from '~~/server/game/ai/BotManager'
import { ITEMS } from '~~/shared/constants/items'
import { STARTING_SCRIP } from '~~/shared/constants/balance'
import {
  TUTORIAL_STEP_DEADLINE_CYCLES,
  TUTORIAL_SKIP_AFTER_DEADLINES,
} from '~~/shared/constants/tutorial'
import { ONE_LANE_ZONES } from '~~/shared/constants/maps'
import { ZONE_MAP } from '~~/shared/constants/zones'
import { findPath } from '~~/shared/pathfinding'

const ONE_LANE_ZONE_IDS = new Set(ONE_LANE_ZONES.map((z) => z.id))

/** Resolve the short zone word a hint uses (`mid`) to a real one-lane zone id. */
function resolveOneLaneZone(word: string): string | null {
  if (ONE_LANE_ZONE_IDS.has(word)) return word
  if (word === 'base') return 'rookery-terminal'
  if (word === 'anchor') return 'rookery-anchor'
  // Mirrors the client's `mid` → `coldstore-cross` alias.
  if (word === 'coldstore') return 'coldstore-cross'
  return null
}

/** Minimal tutorial-mode state for the pure advancement helper. The human's
 *  zone matters for the move step (it holds until they leave base/fountain).
 *  `cycle`/`tutorialStepSince` drive the step deadline. */
function tutorialState(step: number, humanZone = 'coldstore-cross', cycle = 0): GameState {
  return {
    mode: 'tutorial',
    tutorialStep: step,
    tutorialStepSince: 0,
    cycle,
    players: { p1: { id: 'p1', zone: humanZone } },
  } as unknown as GameState
}

/** Index of a drill in the flow, by id — positions are data, not contract. */
const stepIndex = (id: (typeof TUTORIAL_FLOW)[number]['id']): number =>
  TUTORIAL_FLOW.findIndex((s) => s.id === id)

describe('tutorial flow', () => {
  it('drills the real game in order: move → attack → strip → burn → cast → buy → tap → ice', () => {
    expect(TUTORIAL_FLOW.map((s) => s.id)).toEqual([
      'move',
      'attack',
      'strip',
      'burn',
      'cast',
      'buy',
      'tap',
      'ice',
    ])
    expect(TUTORIAL_STEP_COUNT).toBe(8)
  })

  describe('cumulative unlocks', () => {
    it('unlocks only move (+ informational) at step 0', () => {
      const u = tutorialUnlockedCommands(0)
      expect(u.has('move')).toBe(true)
      expect(u.has('attack')).toBe(false)
      expect(u.has('cast')).toBe(false)
      // Informational commands are always available.
      expect(u.has('status')).toBe(true)
      expect(u.has('map')).toBe(true)
    })

    it('accumulates earlier verbs as the drills climb', () => {
      expect(isCommandAllowedInTutorial('move', stepIndex('attack'))).toBe(true)
      expect(isCommandAllowedInTutorial('attack', stepIndex('attack'))).toBe(true)
      expect(isCommandAllowedInTutorial('cast', stepIndex('attack'))).toBe(false)

      expect(isCommandAllowedInTutorial('burn', stepIndex('burn'))).toBe(true)
      expect(isCommandAllowedInTutorial('burn', stepIndex('strip'))).toBe(false)

      expect(isCommandAllowedInTutorial('cast', stepIndex('cast'))).toBe(true)
      expect(isCommandAllowedInTutorial('buy', stepIndex('cast'))).toBe(false)
      expect(isCommandAllowedInTutorial('buy', stepIndex('buy'))).toBe(true)
      expect(isCommandAllowedInTutorial('tap', stepIndex('tap'))).toBe(true)
      expect(isCommandAllowedInTutorial('tap', stepIndex('buy'))).toBe(false)
    })

    it('unlocks everything past the last scripted step (free play)', () => {
      expect(isCommandAllowedInTutorial('buy', TUTORIAL_STEP_COUNT)).toBe(true)
      expect(isCommandAllowedInTutorial('cast', TUTORIAL_STEP_COUNT)).toBe(true)
      expect(isCommandAllowedInTutorial('tap', TUTORIAL_STEP_COUNT)).toBe(true)
    })
  })

  describe('gating policy at step 0 (the strictest point)', () => {
    // Informational / comms / essential-progression commands are never gated —
    // a learner can read state, talk, bail, grab a cache, or spend a talent point
    // even before they've been taught the combat verbs.
    const ALWAYS_ALLOWED = [
      'status',
      'map',
      'scan',
      'grab',
      'chat',
      'ping',
      'missing',
      'surrender',
      'select_talent',
    ] as const

    // Staged verbs: locked at step 0, each unlocked by its own drill.
    const STAGED_LOCKED_AT_0 = ['attack', 'burn', 'cast', 'buy', 'tap'] as const

    // Advanced actions stay gated until free play (they aren't part of the
    // drill sequence and would only confuse a brand-new player).
    const GATED_UNTIL_FREEPLAY = ['use', 'backup', 'harden', 'buyback'] as const

    it('always allows informational / essential-progression commands', () => {
      for (const c of ALWAYS_ALLOWED) {
        expect(isCommandAllowedInTutorial(c, 0), `${c} should be allowed at step 0`).toBe(true)
      }
    })

    it('does not block talent selection while learning the verbs (regression)', () => {
      // select_talent is gated by its own level requirement, not the tutorial.
      expect(isCommandAllowedInTutorial('select_talent', 0)).toBe(true)
      expect(tutorialUnlockedCommands(0).has('select_talent')).toBe(true)
    })

    it('locks the staged combat verbs at step 0', () => {
      for (const c of STAGED_LOCKED_AT_0) {
        expect(isCommandAllowedInTutorial(c, 0), `${c} should be locked at step 0`).toBe(false)
      }
    })

    it('keeps advanced actions gated until free play', () => {
      for (const c of GATED_UNTIL_FREEPLAY) {
        expect(isCommandAllowedInTutorial(c, 0), `${c} locked at step 0`).toBe(false)
        expect(
          isCommandAllowedInTutorial(c, TUTORIAL_STEP_COUNT),
          `${c} unlocked in free play`,
        ).toBe(true)
      }
    })
  })

  describe('hints', () => {
    it('lock message points at the current step (what to do instead)', () => {
      expect(tutorialLockMessage(0)).toContain('move coldstore-t2-chaff')
      expect(tutorialLockMessage(1)).toContain('attack')
    })

    it('tutorialHint returns the current step hint, null once complete', () => {
      expect(tutorialHint(0)).toContain('move coldstore-t2-chaff')
      expect(tutorialHint(TUTORIAL_STEP_COUNT)).toBeNull()
    })

    it('the last-hit hint teaches the explicit wave syntax, not bare attack', () => {
      // Bare `attack` auto-targets an enemy HERO, so the last-hit step must show
      // `attack wave:N` — otherwise the hint contradicts what the command does.
      expect(tutorialHint(1)).toContain('wave:')
      expect(tutorialHint(1)).not.toMatch(/type `attack` on/)
    })

    it('the cast hint never promises the game will find a target for you', () => {
      // REGRESSION: the hint used to read "(it auto-picks a target)". Client-side
      // auto-targeting only works when a LEGAL target is already in your zone —
      // for the many heroes whose Q needs an enemy hero, standing alone means the
      // cast is refused. Players believed the game would handle it, sat still,
      // and the step never completed. The hint must set the real precondition.
      const castHint = tutorialHint(stepIndex('cast'))
      expect(castHint).toContain('cast q')
      expect(castHint!.toLowerCase()).not.toContain('auto-pick')
      expect(castHint!.toLowerCase()).toMatch(/enemy hero|in your zone/)
    })

    it('the first move hint sends the player somewhere reachable, valid, and SAFE', () => {
      const suggested = /move ([a-z0-9-]+)/.exec(tutorialHint(0) ?? '')?.[1]
      expect(suggested).toBeTruthy()
      const target = resolveOneLaneZone(suggested!)
      expect(target, `"${suggested}" is not a one-lane zone`).toBeTruthy()

      // Reachable: the player spawns in rookery-anchor, adjacent ONLY to
      // rookery-terminal. Movement auto-paths, so any routed zone is fair game.
      expect(
        findPath('rookery-anchor', target!, (id) => ONE_LANE_ZONE_IDS.has(id)).length,
      ).toBeGreaterThan(0)

      // Valid: REGRESSION — the hint used to say `move base`, but the step
      // deliberately holds while the player is still in base/fountain, so
      // following it exactly produced no visible progress at all.
      expect(target).not.toMatch(/fountain|base/)

      // Safe: REGRESSION — the hint then said `move mid`, which aliases to
      // coldstore-cross: neutral ground with no ice, bordering the AUDIT T1. Both
      // enemy bots are pinned to mid and arrive there before the first wave
      // wave, so a level-1 player who obeyed the hint was killed in ~12 ticks
      // having done nothing. Send them somewhere their own ice covers.
      const zone = ZONE_MAP[target!]
      expect(zone?.team, `${target} is not friendly ground`).toBe('chaff')
      expect(zone?.ice, `${target} has no friendly ice cover`).toBe(true)
    })

    it('the buy hint names a real, affordable item that actually does something', () => {
      // Every other hint gives a concrete command; the buy hint must name a real,
      // buyable item (not a `<item>` placeholder) the player can afford — AND one
      // that does something (a real stat or an active).
      const itemId = /buy ([a-z_]+)/.exec(tutorialHint(stepIndex('buy')) ?? '')?.[1]
      expect(itemId && ITEMS[itemId]).toBeTruthy()
      const item = ITEMS[itemId!]!
      expect(item.cost).toBeLessThanOrEqual(STARTING_SCRIP)
      const functionalStats = Object.keys(item.stats)
      expect(functionalStats.length > 0 || !!item.active).toBe(true)
    })
  })

  describe('advanceTutorialAfterTick', () => {
    it('advances the move step when the human reaches the lane', () => {
      const next = advanceTutorialAfterTick(
        tutorialState(0, 'coldstore-cross'),
        [{ playerId: 'p1', command: { type: 'move', zone: 'coldstore-cross' } }],
        [],
      )
      expect(next.state.tutorialStep).toBe(1)
    })

    it('stamps the step clock on advance so the next step gets a full deadline', () => {
      const next = advanceTutorialAfterTick(
        tutorialState(0, 'coldstore-cross', 7),
        [{ playerId: 'p1', command: { type: 'move', zone: 'coldstore-cross' } }],
        [],
      )
      expect(next.state.tutorialStepSince).toBe(7)
    })

    it('holds the move step while the human is still in base/fountain — but says why', () => {
      for (const zone of ['rookery-terminal', 'rookery-anchor']) {
        const state = tutorialState(0, zone)
        const next = advanceTutorialAfterTick(
          state,
          [{ playerId: 'p1', command: { type: 'move', zone } }],
          [],
        )
        expect(next.state).toBe(state) // a hop within home doesn't complete the step
        // ...but the player must not be left wondering why nothing happened.
        expect(next.notice).toBeTruthy()
      }
    })

    it('does not advance without the objective actually happening', () => {
      // Parked in home ground on the move drill: a status readout changes nothing.
      const state = tutorialState(0, 'rookery-terminal')
      const next = advanceTutorialAfterTick(
        state,
        [{ playerId: 'p1', command: { type: 'status' } }],
        [],
      )
      expect(next.state).toBe(state) // same reference — no change
      expect(next.notice).toBeNull()
    })

    it('a typed-and-accepted cast does NOT clear the cast drill — only the ability_used event does', () => {
      // The core of the redesign: the OLD tutorial advanced on the accepted
      // command. Now the objective is engine truth. Same accepted action, no
      // event → held; with the event → cleared.
      const held = advanceTutorialAfterTick(
        tutorialState(stepIndex('cast')),
        [{ playerId: 'p1', command: { type: 'cast', ability: 'q' } }],
        [],
        [],
      )
      expect(held.state.tutorialStep).toBe(stepIndex('cast'))

      const cleared = advanceTutorialAfterTick(
        tutorialState(stepIndex('cast')),
        [],
        [],
        [{ _tag: 'ability_used', cycle: 1, playerId: 'p1' } as never],
      )
      expect(cleared.state.tutorialStep).toBe(stepIndex('cast') + 1)
    })

    it("ignores bots' events (only the human drives the tutorial)", () => {
      const state = tutorialState(stepIndex('strip'))
      const next = advanceTutorialAfterTick(
        state,
        [],
        [],
        [{ _tag: 'wave_strip', cycle: 1, playerId: 'bot_r0_g' } as never],
      )
      expect(next.state).toBe(state)
    })

    it('is a no-op in a normal game', () => {
      const normal = { mode: 'normal', tutorialStep: undefined } as unknown as GameState
      const next = advanceTutorialAfterTick(
        normal,
        [{ playerId: 'p1', command: { type: 'move', zone: 'coldstore-cross' } }],
        [],
      )
      expect(next.state).toBe(normal)
      expect(next.notice).toBeNull()
    })

    describe('deadlines help, then count (the tutorial must never dead-end OR fake-graduate)', () => {
      // The OLD deadline silently advanced the step — a player who typed
      // nothing was stamped "graduated" in four minutes. Now a deadline pushes
      // the step's sharper help (plus a world nudge where one applies), and
      // only after TUTORIAL_SKIP_AFTER_DEADLINES exhausted deadlines does the
      // step skip — recorded in tutorialSkips, which denies mastery.
      it('a first deadline pushes help and HOLDS the step', () => {
        const stuck = tutorialState(
          stepIndex('cast'),
          'coldstore-t3-chaff',
          TUTORIAL_STEP_DEADLINE_CYCLES,
        )
        const next = advanceTutorialAfterTick(stuck, [], [])
        expect(next.state.tutorialStep).toBe(stepIndex('cast'))
        expect(next.notice).toBe(TUTORIAL_FLOW[stepIndex('cast')]!.help)
      })

      it('does not react before the deadline', () => {
        const waiting = tutorialState(
          stepIndex('cast'),
          'coldstore-t3-chaff',
          TUTORIAL_STEP_DEADLINE_CYCLES - 1,
        )
        const next = advanceTutorialAfterTick(waiting, [], [])
        expect(next.state.tutorialStep).toBe(stepIndex('cast'))
        expect(next.notice).toBeNull()
      })

      it('skips only after every deadline is exhausted — and counts it', () => {
        const stuck = tutorialState(
          stepIndex('cast'),
          'coldstore-t3-chaff',
          TUTORIAL_STEP_DEADLINE_CYCLES * TUTORIAL_SKIP_AFTER_DEADLINES,
        )
        const next = advanceTutorialAfterTick(stuck, [], [])
        expect(next.state.tutorialStep).toBe(stepIndex('cast') + 1)
        expect(next.state.tutorialSkips).toBe(1)
        expect(next.notice).toContain('Moving on')
      })

      it('always reaches the end from a standing start — with every skip counted, mastery denied', () => {
        // The dead-end guarantee survives the redesign: doing nothing still
        // terminates. What changed is the verdict: all skips are recorded and
        // the run does not count as tutorial completion.
        let state = tutorialState(0, 'rookery-anchor', 0)
        const budget =
          TUTORIAL_STEP_DEADLINE_CYCLES * TUTORIAL_SKIP_AFTER_DEADLINES * TUTORIAL_STEP_COUNT + 1
        for (let cycle = 1; cycle <= budget; cycle++) {
          state = { ...state, cycle }
          state = advanceTutorialAfterTick(state, [], []).state
        }
        expect(state.tutorialStep).toBeGreaterThanOrEqual(TUTORIAL_STEP_COUNT)
        expect(state.tutorialSkips).toBe(TUTORIAL_STEP_COUNT)
        expect(tutorialMasteryAchieved(state)).toBe(false)
      })

      it('a clean run keeps mastery', () => {
        expect(tutorialMasteryAchieved(tutorialState(0))).toBe(true)
      })

      it('every step carries help and a skipNote so escalation still teaches', () => {
        for (const step of TUTORIAL_FLOW) {
          expect(step.help, `${step.id} needs help copy`).toBeTruthy()
          expect(step.skipNote, `${step.id} needs a skipNote`).toBeTruthy()
          expect(step.done, `${step.id} needs a done note`).toBeTruthy()
        }
      })
    })
  })

  describe('buildTutorialRoster', () => {
    const roster = buildTutorialRoster('github_42', 'echo', 'game_abc')

    it('is a calm 2v2: the human + 1 ally vs 2 enemy bots', () => {
      expect(roster).toHaveLength(4)
      const chaff = roster.filter((p) => p.team === 'chaff')
      const audit = roster.filter((p) => p.team === 'audit')
      expect(chaff).toHaveLength(2)
      expect(audit).toHaveLength(2)
    })

    it('puts the human (only non-bot) on chaff with their chosen hero', () => {
      const humans = roster.filter((p) => !isBot(p.playerId))
      expect(humans).toHaveLength(1)
      expect(humans[0]).toMatchObject({ playerId: 'github_42', team: 'chaff', heroId: 'echo' })
    })

    it('gives every bot a distinct hero (none clashing with the human)', () => {
      const heroes = roster.map((p) => p.heroId)
      expect(new Set(heroes).size).toBe(heroes.length)
    })

    it('names bots with the bot_ prefix so isBot() recognises them', () => {
      for (const p of roster.filter((p) => p.playerId !== 'github_42')) {
        expect(isBot(p.playerId)).toBe(true)
      }
    })
  })
})
