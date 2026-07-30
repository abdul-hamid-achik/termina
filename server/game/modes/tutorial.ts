import type { Command } from '~~/shared/types/commands'
import type { GameState, TeamId } from '~~/shared/types/game'
import {
  TUTORIAL_FLOW,
  TUTORIAL_STEP_COUNT,
  TUTORIAL_STEP_DEADLINE_TICKS,
} from '~~/shared/constants/tutorial'
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
  TUTORIAL_STEP_DEADLINE_TICKS,
  tutorialHint,
} from '~~/shared/constants/tutorial'

/**
 * Commands always available in tutorial mode, regardless of step: informational
 * readouts (status/map/scan), comms (chat/ping/missing), the player's own escape
 * hatch (surrender), grabbing a cache you're standing on, and — importantly —
 * selecting a talent. Talent selection is essential hero progression gated by
 * its own level requirement, so the verb-learning sequence must never block a
 * leveled-up tutorial player from spending a talent point.
 */
const TUTORIAL_ALWAYS_ALLOWED: ReadonlySet<Command['type']> = new Set([
  'status',
  'map',
  'scan',
  'grab',
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
    { playerId: humanId, team: 'chaff', heroId: humanHeroId },
    { playerId: `bot_ally_${gameId}`, team: 'chaff', heroId: nextHero() },
    { playerId: `bot_enemy0_${gameId}`, team: 'audit', heroId: nextHero() },
    { playerId: `bot_enemy1_${gameId}`, team: 'audit', heroId: nextHero() },
  ]
}

/** Outcome of a tutorial advance: the new state plus anything to tell the player. */
export interface TutorialAdvance {
  state: GameState
  /** Announcement to push to the human this tick, or null. */
  notice: string | null
}

/**
 * Advance the tutorial after a tick's actions resolve.
 *
 * A step completes when the human (any non-bot player) performed — and the
 * engine accepted — the command that step teaches. A step ALSO completes when it
 * has been active longer than TUTORIAL_STEP_DEADLINE_TICKS.
 *
 * The deadline is the load-bearing part. Every step's success condition depends
 * on the live match: "attack" wants a creep wave to have arrived, "cast" wants a
 * legal target (most heroes' Q needs an enemy hero in your zone). Without a
 * deadline a player whose zone never produced a legal target sat on the same
 * step forever — and because tutorial mode gates the *later* commands behind the
 * current step, they were left with nothing they were allowed to do. That was a
 * true dead end: the flow could never reach the last step, so tutorial
 * completion never fired for anyone.
 *
 * Pure: returns the same state reference unless the step changed.
 */
export function advanceTutorialAfterTick(
  state: GameState,
  validActions: readonly { playerId: string; command: Command }[],
  rejected: readonly { playerId: string }[],
): TutorialAdvance {
  if (state.mode !== 'tutorial') return { state, notice: null }
  const step = state.tutorialStep ?? 0
  if (step >= TUTORIAL_FLOW.length) return { state, notice: null }

  const current = TUTORIAL_FLOW[step]!
  const taught = current.teaches
  const rejectedIds = new Set(rejected.map((r) => r.playerId))
  const actor = validActions.find(
    (a) =>
      !a.playerId.startsWith('bot_') && a.command.type === taught && !rejectedIds.has(a.playerId),
  )

  // The move step teaches "walk to the lane", not "take one step": from the
  // fountain the first hop only reaches base, where the next steps (last-hit a
  // creep, cast on an enemy) have no targets. Hold the step until the human has
  // actually left their base/fountain into the field — but SAY so, otherwise the
  // player who typed exactly what the hint said sees nothing happen at all.
  const stalledInBase =
    !!actor && taught === 'move' && /fountain|base/.test(state.players[actor.playerId]?.zone ?? '')

  if (actor && !stalledInBase) return { state: advanceTo(state, step + 1), notice: null }

  const since = state.tutorialStepSince ?? 0
  const elapsed = state.tick - since
  if (elapsed >= TUTORIAL_STEP_DEADLINE_TICKS) {
    return {
      state: advanceTo(state, step + 1),
      notice: `🎓 Moving on — ${current.skipNote}`,
    }
  }

  if (stalledInBase) {
    return {
      state,
      notice: '🎓 Still in your base — keep going with `move mid-t1-chaff` to reach the lane.',
    }
  }

  return { state, notice: null }
}

/** Step the flow forward, stamping the tick so the next step gets a fresh deadline. */
function advanceTo(state: GameState, nextStep: number): GameState {
  return { ...state, tutorialStep: nextStep, tutorialStepSince: state.tick }
}
