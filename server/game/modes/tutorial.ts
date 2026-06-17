import type { Command } from '~~/shared/types/commands'
import type { GameState } from '~~/shared/types/game'
import { TUTORIAL_FLOW, TUTORIAL_STEP_COUNT } from '~~/shared/constants/tutorial'

/**
 * Tutorial mode — staggered command unlocks (server side).
 *
 * In tutorial mode the player learns one verb at a time: only the commands
 * unlocked by the current step (plus always-allowed informational commands)
 * pass validation. Performing the command a step teaches advances the flow,
 * unlocking the next verb. Past the last step everything is unlocked (free
 * play). The flow DATA (steps + hints) lives in shared/constants/tutorial so
 * the client can render it; this module owns the gate + advancement logic.
 */

// Re-export the shared flow so existing server-side imports keep one source.
export {
  TUTORIAL_FLOW,
  TUTORIAL_STEP_COUNT,
  tutorialHint,
  isTutorialComplete,
  type TutorialStep,
} from '~~/shared/constants/tutorial'

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
  if (step >= TUTORIAL_STEP_COUNT) return true
  return tutorialUnlockedCommands(step).has(commandType)
}

/** Teaching rejection message for a command that's still locked at this step. */
export function tutorialLockMessage(step: number): string {
  const current = TUTORIAL_FLOW[Math.min(step, TUTORIAL_FLOW.length - 1)]
  return current ? current.hint : '🎓 Tutorial: follow the current step first.'
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
