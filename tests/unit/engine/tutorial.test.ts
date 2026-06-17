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

/** Minimal tutorial-mode state for the pure advancement helper. The human's
 *  zone matters for the move step (it holds until they leave base/fountain). */
function tutorialState(step: number, humanZone = 'mid-river'): GameState {
  return {
    mode: 'tutorial',
    tutorialStep: step,
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
      expect(tutorialLockMessage(0)).toContain('Walk down')
      expect(tutorialLockMessage(1)).toContain('Last-hit')
    })

    it('tutorialHint returns the current step hint, null once complete', () => {
      expect(tutorialHint(0)).toContain('Walk down')
      expect(tutorialHint(TUTORIAL_STEP_COUNT)).toBeNull()
    })

    it('the last-hit hint teaches the explicit creep syntax, not bare attack', () => {
      // Bare `attack` auto-targets an enemy HERO, so the last-hit step must show
      // `attack creep:N` — otherwise the hint contradicts what the command does.
      expect(tutorialHint(1)).toContain('creep:')
      expect(tutorialHint(1)).not.toMatch(/type `attack` on/)
    })

    it('the cast hint is hero-agnostic (some heroes have a supportive Q)', () => {
      // `cast q` auto-targets per the ability — an ally/self for a supportive Q —
      // so the hint must not promise it "hits an enemy".
      expect(tutorialHint(2)).toContain('cast q')
      expect(tutorialHint(2)!.toLowerCase()).not.toContain('enemy')
    })

    it('the first move hint suggests a move reachable from the spawn fountain', () => {
      // The player spawns in radiant-fountain (adjacent ONLY to radiant-base), so
      // the first move must go there — any farther zone is a non-adjacent reject
      // that would stall the tutorial on step one.
      const suggested = /move ([a-z-]+)/.exec(tutorialHint(0) ?? '')?.[1]
      expect(['base', 'radiant-base']).toContain(suggested)
    })

    it('the buy hint names a real item affordable on the starting gold', () => {
      // Every other hint gives a concrete command; the buy hint must name a real,
      // buyable item (not a `<item>` placeholder) the player can actually afford.
      const itemId = /buy ([a-z_]+)/.exec(tutorialHint(3) ?? '')?.[1]
      expect(itemId && ITEMS[itemId]).toBeTruthy()
      expect(ITEMS[itemId!]!.cost).toBeLessThanOrEqual(STARTING_GOLD)
    })
  })

  describe('advanceTutorialAfterTick', () => {
    it('advances the move step when the human reaches the lane', () => {
      const next = advanceTutorialAfterTick(
        tutorialState(0, 'mid-river'),
        [{ playerId: 'p1', command: { type: 'move', zone: 'mid-river' } }],
        [],
      )
      expect(next.tutorialStep).toBe(1)
    })

    it('holds the move step while the human is still in base/fountain', () => {
      for (const zone of ['radiant-base', 'radiant-fountain']) {
        const state = tutorialState(0, zone)
        const next = advanceTutorialAfterTick(
          state,
          [{ playerId: 'p1', command: { type: 'move', zone } }],
          [],
        )
        expect(next).toBe(state) // a hop within home doesn't complete the move step
      }
    })

    it('does not advance on a different verb', () => {
      const state = tutorialState(0)
      const next = advanceTutorialAfterTick(
        state,
        [{ playerId: 'p1', command: { type: 'status' } }],
        [],
      )
      expect(next).toBe(state) // same reference — no change
    })

    it('does not advance if the taught action was rejected in resolution', () => {
      const next = advanceTutorialAfterTick(
        tutorialState(2),
        [{ playerId: 'p1', command: { type: 'cast', ability: 'q' } }],
        [{ playerId: 'p1', reason: 'Not enough mana' }],
      )
      expect(next.tutorialStep).toBe(2)
    })

    it('ignores bot actions (only the human drives the tutorial)', () => {
      const state = tutorialState(0)
      const next = advanceTutorialAfterTick(
        state,
        [{ playerId: 'bot_r0_g', command: { type: 'move', zone: 'mid-river' } }],
        [],
      )
      expect(next).toBe(state)
    })

    it('is a no-op in a normal game', () => {
      const normal = { mode: 'normal', tutorialStep: undefined } as unknown as GameState
      const next = advanceTutorialAfterTick(
        normal,
        [{ playerId: 'p1', command: { type: 'move', zone: 'mid-river' } }],
        [],
      )
      expect(next).toBe(normal)
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
