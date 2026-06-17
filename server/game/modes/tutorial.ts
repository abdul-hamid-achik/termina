import type { Command } from '~~/shared/types/commands'
import type { GameState } from '~~/shared/types/game'

/**
 * Tutorial flow — staggered command unlocks.
 *
 * In tutorial mode the player learns one verb at a time: only the commands
 * unlocked by the current step (plus always-allowed informational commands)
 * pass validation. Performing the command a step teaches advances the flow,
 * unlocking the next verb. Past the last step everything is unlocked (free
 * play). This module is the single source of truth for both the gate
 * (ActionResolver.validateAction) and advancement (GameLoop).
 */

/** A single tutorial step: the command it teaches + the hint shown while active. */
export interface TutorialStep {
  /** The command type this step teaches — performing it advances the tutorial. */
  teaches: Command['type']
  /** One-line hint surfaced to the player while this step is active. */
  hint: string
}

/**
 * Informational / harmless commands that are always available in tutorial mode,
 * regardless of step — a learner can't break anything or skip ahead with these.
 */
const TUTORIAL_ALWAYS_ALLOWED: ReadonlySet<Command['type']> = new Set([
  'status',
  'map',
  'scan',
  'rune',
  'chat',
  'ping',
  'missing',
  'surrender',
])

/** Ordered tutorial flow: each step unlocks exactly one new command type. */
export const TUTORIAL_FLOW: readonly TutorialStep[] = [
  {
    teaches: 'move',
    hint: '🎓 Walk down the lane — type `move mid-t3-rad` to advance toward mid.',
  },
  { teaches: 'attack', hint: '🎓 Last-hit a creep — type `attack` on a low-HP creep for gold.' },
  { teaches: 'cast', hint: '🎓 Use an ability — type `cast q` to hit an enemy with your Q.' },
  { teaches: 'buy', hint: '🎓 Spend your gold — back at base, type `buy <item>` to power up.' },
]

/** The number of scripted steps in the tutorial. */
export const TUTORIAL_STEP_COUNT = TUTORIAL_FLOW.length

/**
 * Commands unlocked at a given step (cumulative): every step's `teaches` up to
 * and including the current step, plus the always-allowed informational set.
 */
export function tutorialUnlockedCommands(step: number): ReadonlySet<Command['type']> {
  const unlocked = new Set<Command['type']>(TUTORIAL_ALWAYS_ALLOWED)
  for (let i = 0; i <= step && i < TUTORIAL_FLOW.length; i++) {
    unlocked.add(TUTORIAL_FLOW[i]!.teaches)
  }
  return unlocked
}

/** Whether a command type is allowed at the current tutorial step. */
export function isCommandAllowedInTutorial(commandType: Command['type'], step: number): boolean {
  // Past the last scripted step the player is in free play — nothing is gated.
  if (step >= TUTORIAL_FLOW.length) return true
  return tutorialUnlockedCommands(step).has(commandType)
}

/** Teaching rejection message for a command that's still locked at this step. */
export function tutorialLockMessage(step: number): string {
  const current = TUTORIAL_FLOW[Math.min(step, TUTORIAL_FLOW.length - 1)]
  return current ? current.hint : '🎓 Tutorial: follow the current step first.'
}

/** The hint for the current step (null once the tutorial is complete). */
export function tutorialHint(step: number): string | null {
  return TUTORIAL_FLOW[step]?.hint ?? null
}

/**
 * Advance the tutorial after a tick's actions resolve: if the human (any
 * non-bot player) performed — and the engine accepted — the command the current
 * step teaches, step forward. Pure: returns the same state reference unless the
 * step changed.
 */
export function advanceTutorialAfterTick(
  state: GameState,
  validActions: readonly { playerId: string; command: Command }[],
  rejected: readonly { playerId: string }[],
): GameState {
  if (state.mode !== 'tutorial') return state
  const step = state.tutorialStep ?? 0
  if (step >= TUTORIAL_FLOW.length) return state

  const taught = TUTORIAL_FLOW[step]!.teaches
  const rejectedIds = new Set(rejected.map((r) => r.playerId))
  const completed = validActions.some(
    (a) =>
      !a.playerId.startsWith('bot_') && a.command.type === taught && !rejectedIds.has(a.playerId),
  )
  return completed ? { ...state, tutorialStep: step + 1 } : state
}
