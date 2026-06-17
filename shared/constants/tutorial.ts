import type { Command } from '~~/shared/types/commands'

/**
 * Tutorial flow data — the ordered steps a new player is walked through, each
 * unlocking one command and carrying the hint shown while it's active.
 *
 * This lives in `shared/` because BOTH sides need it: the server gates commands
 * + advances the step (server/game/modes/tutorial.ts), and the client renders
 * the current hint + progress (the in-game tutorial banner). Keep it pure data.
 */

/** A single tutorial step: the command it teaches + the hint shown while active. */
export interface TutorialStep {
  /** The command type this step teaches — performing it advances the tutorial. */
  teaches: Command['type']
  /** One-line hint surfaced to the player while this step is active. */
  hint: string
}

/** Ordered tutorial flow: each step unlocks exactly one new command type. */
export const TUTORIAL_FLOW: readonly TutorialStep[] = [
  {
    teaches: 'move',
    // The player spawns in the fountain, which is only adjacent to its base — so
    // the first move MUST be `move base` (any farther zone is rejected as
    // non-adjacent, which would stall the tutorial on step one).
    hint: '🎓 Walk down the lane — type `move base` to leave the fountain, then push to mid.',
  },
  {
    teaches: 'attack',
    hint: '🎓 Last-hit a creep — type `attack creep:0` when its HP is low, for gold.',
  },
  {
    teaches: 'cast',
    hint: '🎓 Use an ability — type `cast q` to fire your Q (it auto-picks a target).',
  },
  {
    teaches: 'buy',
    hint: '🎓 Spend your gold — head back to base and type `buy boots_of_speed` for move speed.',
  },
]

/** The number of scripted steps in the tutorial. */
export const TUTORIAL_STEP_COUNT = TUTORIAL_FLOW.length

/** The hint for the current step (null once the tutorial is complete / free play). */
export function tutorialHint(step: number): string | null {
  return TUTORIAL_FLOW[step]?.hint ?? null
}

/** Whether the player has finished the scripted flow and is in free play. */
export function isTutorialComplete(step: number): boolean {
  return step >= TUTORIAL_STEP_COUNT
}
