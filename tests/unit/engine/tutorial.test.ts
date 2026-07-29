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
  buildTutorialRoster,
} from '~~/server/game/modes/tutorial'
import { isBot } from '~~/server/game/ai/BotManager'
import { ITEMS } from '~~/shared/constants/items'
import { STARTING_GOLD } from '~~/shared/constants/balance'
import { TUTORIAL_STEP_DEADLINE_TICKS } from '~~/shared/constants/tutorial'
import { ONE_LANE_ZONES } from '~~/shared/constants/maps'
import { ZONE_MAP } from '~~/shared/constants/zones'
import { findPath } from '~~/shared/pathfinding'

const ONE_LANE_ZONE_IDS = new Set(ONE_LANE_ZONES.map((z) => z.id))

/** Resolve the short zone word a hint uses (`mid`) to a real one-lane zone id. */
function resolveOneLaneZone(word: string): string | null {
  if (ONE_LANE_ZONE_IDS.has(word)) return word
  if (word === 'base') return 'radiant-base'
  if (word === 'fountain') return 'radiant-fountain'
  // Mirrors the client's `mid` → `mid-river` alias.
  if (word === 'mid') return 'mid-river'
  return null
}

/** Minimal tutorial-mode state for the pure advancement helper. The human's
 *  zone matters for the move step (it holds until they leave base/fountain).
 *  `tick`/`tutorialStepSince` drive the step deadline. */
function tutorialState(step: number, humanZone = 'mid-river', tick = 0): GameState {
  return {
    mode: 'tutorial',
    tutorialStep: step,
    tutorialStepSince: 0,
    tick,
    players: { p1: { id: 'p1', zone: humanZone } },
  } as unknown as GameState
}

describe('tutorial flow', () => {
  it('teaches move → attack → cast → buy in order', () => {
    expect(TUTORIAL_FLOW.map((s) => s.teaches)).toEqual(['move', 'attack', 'cast', 'buy'])
    expect(TUTORIAL_STEP_COUNT).toBe(4)
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

    it('accumulates earlier verbs as the step climbs', () => {
      expect(isCommandAllowedInTutorial('move', 1)).toBe(true)
      expect(isCommandAllowedInTutorial('attack', 1)).toBe(true)
      expect(isCommandAllowedInTutorial('cast', 1)).toBe(false)

      expect(isCommandAllowedInTutorial('cast', 2)).toBe(true)
      expect(isCommandAllowedInTutorial('buy', 2)).toBe(false)
      expect(isCommandAllowedInTutorial('buy', 3)).toBe(true)
    })

    it('unlocks everything past the last scripted step (free play)', () => {
      expect(isCommandAllowedInTutorial('buy', TUTORIAL_STEP_COUNT)).toBe(true)
      expect(isCommandAllowedInTutorial('cast', TUTORIAL_STEP_COUNT)).toBe(true)
      expect(isCommandAllowedInTutorial('ward', TUTORIAL_STEP_COUNT)).toBe(true)
    })
  })

  describe('gating policy at step 0 (the strictest point)', () => {
    // Informational / comms / essential-progression commands are never gated —
    // a learner can read state, talk, bail, grab a rune, or spend a talent point
    // even before they've been taught the combat verbs.
    const ALWAYS_ALLOWED = [
      'status',
      'map',
      'scan',
      'rune',
      'chat',
      'ping',
      'missing',
      'surrender',
      'select_talent',
    ] as const

    // Staged verbs: locked at step 0, each unlocked by its own step.
    const STAGED_LOCKED_AT_0 = ['attack', 'cast', 'buy'] as const

    // Advanced actions stay gated until free play (they aren't part of the
    // verb-learning sequence and would only confuse a brand-new player).
    const GATED_UNTIL_FREEPLAY = ['ward', 'use', 'deny', 'aegis', 'glyph', 'buyback'] as const

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
      expect(tutorialLockMessage(0)).toContain('move mid')
      expect(tutorialLockMessage(1)).toContain('attack')
    })

    it('tutorialHint returns the current step hint, null once complete', () => {
      expect(tutorialHint(0)).toContain('move mid')
      expect(tutorialHint(TUTORIAL_STEP_COUNT)).toBeNull()
    })

    it('the last-hit hint teaches the explicit creep syntax, not bare attack', () => {
      // Bare `attack` auto-targets an enemy HERO, so the last-hit step must show
      // `attack creep:N` — otherwise the hint contradicts what the command does.
      expect(tutorialHint(1)).toContain('creep:')
      expect(tutorialHint(1)).not.toMatch(/type `attack` on/)
    })

    it('the cast hint never promises the game will find a target for you', () => {
      // REGRESSION: the hint used to read "(it auto-picks a target)". Client-side
      // auto-targeting only works when a LEGAL target is already in your zone —
      // for the many heroes whose Q needs an enemy hero, standing alone means the
      // cast is refused. Players believed the game would handle it, sat still,
      // and the step never completed. The hint must set the real precondition.
      expect(tutorialHint(2)).toContain('cast q')
      expect(tutorialHint(2)!.toLowerCase()).not.toContain('auto-pick')
      expect(tutorialHint(2)!.toLowerCase()).toMatch(/enemy hero|in your zone/)
    })

    it('the first move hint sends the player somewhere reachable, valid, and SAFE', () => {
      const suggested = /move ([a-z0-9-]+)/.exec(tutorialHint(0) ?? '')?.[1]
      expect(suggested).toBeTruthy()
      const target = resolveOneLaneZone(suggested!)
      expect(target, `"${suggested}" is not a one-lane zone`).toBeTruthy()

      // Reachable: the player spawns in radiant-fountain, adjacent ONLY to
      // radiant-base. Movement auto-paths, so any routed zone is fair game.
      expect(
        findPath('radiant-fountain', target!, (id) => ONE_LANE_ZONE_IDS.has(id)).length,
      ).toBeGreaterThan(0)

      // Valid: REGRESSION — the hint used to say `move base`, but the step
      // deliberately holds while the player is still in base/fountain, so
      // following it exactly produced no visible progress at all.
      expect(target).not.toMatch(/fountain|base/)

      // Safe: REGRESSION — the hint then said `move mid`, which aliases to
      // mid-river: neutral ground with no tower, bordering the DIRE T1. Both
      // enemy bots are pinned to mid and arrive there before the first creep
      // wave, so a level-1 player who obeyed the hint was killed in ~12 ticks
      // having done nothing. Send them somewhere their own tower covers.
      const zone = ZONE_MAP[target!]
      expect(zone?.team, `${target} is not friendly ground`).toBe('radiant')
      expect(zone?.tower, `${target} has no friendly tower cover`).toBe(true)
    })

    it('the buy hint names a real, affordable item that actually does something', () => {
      // Every other hint gives a concrete command; the buy hint must name a real,
      // buyable item (not a `<item>` placeholder) the player can afford — AND one
      // that does something. Termina movement is fixed (1 zone/tick), so a
      // pure-moveSpeed item like Boots of Speed would be an inert suggestion.
      const itemId = /buy ([a-z_]+)/.exec(tutorialHint(3) ?? '')?.[1]
      expect(itemId && ITEMS[itemId]).toBeTruthy()
      const item = ITEMS[itemId!]!
      expect(item.cost).toBeLessThanOrEqual(STARTING_GOLD)
      const functionalStats = Object.keys(item.stats).filter((k) => k !== 'moveSpeed')
      expect(functionalStats.length > 0 || !!item.active).toBe(true)
    })
  })

  describe('advanceTutorialAfterTick', () => {
    it('advances the move step when the human reaches the lane', () => {
      const next = advanceTutorialAfterTick(
        tutorialState(0, 'mid-river'),
        [{ playerId: 'p1', command: { type: 'move', zone: 'mid-river' } }],
        [],
      )
      expect(next.state.tutorialStep).toBe(1)
    })

    it('stamps the step clock on advance so the next step gets a full deadline', () => {
      const next = advanceTutorialAfterTick(
        tutorialState(0, 'mid-river', 7),
        [{ playerId: 'p1', command: { type: 'move', zone: 'mid-river' } }],
        [],
      )
      expect(next.state.tutorialStepSince).toBe(7)
    })

    it('holds the move step while the human is still in base/fountain — but says why', () => {
      for (const zone of ['radiant-base', 'radiant-fountain']) {
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

    it('does not advance on a different verb', () => {
      const state = tutorialState(0)
      const next = advanceTutorialAfterTick(
        state,
        [{ playerId: 'p1', command: { type: 'status' } }],
        [],
      )
      expect(next.state).toBe(state) // same reference — no change
      expect(next.notice).toBeNull()
    })

    it('does not advance if the taught action was rejected in resolution', () => {
      const next = advanceTutorialAfterTick(
        tutorialState(2),
        [{ playerId: 'p1', command: { type: 'cast', ability: 'q' } }],
        [{ playerId: 'p1', reason: 'Not enough mana' }],
      )
      expect(next.state.tutorialStep).toBe(2)
    })

    it('ignores bot actions (only the human drives the tutorial)', () => {
      const state = tutorialState(0)
      const next = advanceTutorialAfterTick(
        state,
        [{ playerId: 'bot_r0_g', command: { type: 'move', zone: 'mid-river' } }],
        [],
      )
      expect(next.state).toBe(state)
    })

    it('is a no-op in a normal game', () => {
      const normal = { mode: 'normal', tutorialStep: undefined } as unknown as GameState
      const next = advanceTutorialAfterTick(
        normal,
        [{ playerId: 'p1', command: { type: 'move', zone: 'mid-river' } }],
        [],
      )
      expect(next.state).toBe(normal)
      expect(next.notice).toBeNull()
    })

    describe('step deadline (the tutorial must never dead-end)', () => {
      // REGRESSION: every step's success condition depends on the live match —
      // "cast" needs a legal target, which for most heroes means an enemy hero in
      // your zone. A player who never got one sat on step 2 forever, and because
      // tutorial mode gates LATER commands behind the current step they had
      // nothing legal left to do. The flow could not reach the final step, so
      // tutorial completion never fired for anyone.
      it('auto-advances a step the player cannot satisfy, and explains why', () => {
        const stuck = tutorialState(2, 'mid-t3-rad', TUTORIAL_STEP_DEADLINE_TICKS)
        const next = advanceTutorialAfterTick(stuck, [], [])
        expect(next.state.tutorialStep).toBe(3)
        expect(next.notice).toContain('Moving on')
      })

      it('does not auto-advance before the deadline', () => {
        const waiting = tutorialState(2, 'mid-t3-rad', TUTORIAL_STEP_DEADLINE_TICKS - 1)
        expect(advanceTutorialAfterTick(waiting, [], []).state.tutorialStep).toBe(2)
      })

      it('always reaches free play from a standing start, doing nothing at all', () => {
        // The whole flow, driven only by the clock — this is the invariant that
        // makes tutorial completion (and the returning-player funnel) reachable.
        let state = tutorialState(0, 'radiant-fountain', 0)
        for (let tick = 1; tick <= TUTORIAL_STEP_DEADLINE_TICKS * TUTORIAL_STEP_COUNT + 1; tick++) {
          state = { ...state, tick }
          state = advanceTutorialAfterTick(state, [], []).state
        }
        expect(state.tutorialStep).toBeGreaterThanOrEqual(TUTORIAL_STEP_COUNT)
      })

      it('every step carries a skipNote so an auto-advance still teaches', () => {
        for (const step of TUTORIAL_FLOW) {
          expect(step.skipNote, `${step.teaches} needs a skipNote`).toBeTruthy()
        }
      })
    })
  })

  describe('buildTutorialRoster', () => {
    const roster = buildTutorialRoster('github_42', 'echo', 'game_abc')

    it('is a calm 2v2: the human + 1 ally vs 2 enemy bots', () => {
      expect(roster).toHaveLength(4)
      const radiant = roster.filter((p) => p.team === 'radiant')
      const dire = roster.filter((p) => p.team === 'dire')
      expect(radiant).toHaveLength(2)
      expect(dire).toHaveLength(2)
    })

    it('puts the human (only non-bot) on radiant with their chosen hero', () => {
      const humans = roster.filter((p) => !isBot(p.playerId))
      expect(humans).toHaveLength(1)
      expect(humans[0]).toMatchObject({ playerId: 'github_42', team: 'radiant', heroId: 'echo' })
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
