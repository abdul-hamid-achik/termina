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
} from '~~/server/game/modes/tutorial'

/** Minimal tutorial-mode state for the pure advancement helper. */
function tutorialState(step: number): GameState {
  return { mode: 'tutorial', tutorialStep: step } as unknown as GameState
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

  describe('hints', () => {
    it('lock message points at the current step (what to do instead)', () => {
      expect(tutorialLockMessage(0)).toContain('Walk down')
      expect(tutorialLockMessage(1)).toContain('Last-hit')
    })

    it('tutorialHint returns the current step hint, null once complete', () => {
      expect(tutorialHint(0)).toContain('Walk down')
      expect(tutorialHint(TUTORIAL_STEP_COUNT)).toBeNull()
    })
  })

  describe('advanceTutorialAfterTick', () => {
    it('advances when the human performs the taught verb (accepted)', () => {
      const next = advanceTutorialAfterTick(
        tutorialState(0),
        [{ playerId: 'p1', command: { type: 'move', zone: 'mid-river' } }],
        [],
      )
      expect(next.tutorialStep).toBe(1)
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
})
