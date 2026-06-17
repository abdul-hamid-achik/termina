import type { Command } from '~~/shared/types/commands'
import type { GameState, TeamId } from '~~/shared/types/game'
import { TUTORIAL_FLOW, TUTORIAL_STEP_COUNT } from '~~/shared/constants/tutorial'
import { HERO_IDS } from '~~/shared/constants/heroes'

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
 * Commands always available in tutorial mode, regardless of step: informational
 * readouts (status/map/scan), comms (chat/ping/missing), the player's own escape
 * hatch (surrender), grabbing a rune you're standing on, and — importantly —
 * selecting a talent. Talent selection is essential hero progression gated by
 * its own level requirement, so the verb-learning sequence must never block a
 * leveled-up tutorial player from spending a talent point.
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
  'select_talent',
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

export interface TutorialRosterPlayer {
  playerId: string
  team: TeamId
  heroId: string
}

/**
 * The roster for a tutorial game: a calm 2v2 on the one-lane map — the human
 * plus one ally bot versus two enemy bots, all with distinct heroes. The caller
 * pins the bots to mid via registerBots({ forceLane: 'mid' }). Pure so the shape
 * is unit-tested without booting the game server.
 */
export function buildTutorialRoster(
  humanId: string,
  humanHeroId: string,
  gameId: string,
): TutorialRosterPlayer[] {
  const used = new Set<string>([humanHeroId])
  const nextHero = (): string => {
    const h = HERO_IDS.find((x) => !used.has(x)) ?? HERO_IDS[0]!
    used.add(h)
    return h
  }
  return [
    { playerId: humanId, team: 'radiant', heroId: humanHeroId },
    { playerId: `bot_ally_${gameId}`, team: 'radiant', heroId: nextHero() },
    { playerId: `bot_enemy0_${gameId}`, team: 'dire', heroId: nextHero() },
    { playerId: `bot_enemy1_${gameId}`, team: 'dire', heroId: nextHero() },
  ]
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
  const actor = validActions.find(
    (a) =>
      !a.playerId.startsWith('bot_') && a.command.type === taught && !rejectedIds.has(a.playerId),
  )
  if (!actor) return state

  // The move step teaches "walk to the lane", not "take one step": from the
  // fountain the first hop only reaches base, where the next steps (last-hit a
  // creep, cast on an enemy) have no targets. Hold the step until the human has
  // actually left their base/fountain into the field.
  if (taught === 'move' && /fountain|base/.test(state.players[actor.playerId]?.zone ?? '')) {
    return state
  }

  return { ...state, tutorialStep: step + 1 }
}
