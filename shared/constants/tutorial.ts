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
  /**
   * Shown when the step auto-advances on its deadline instead of being
   * performed, so a stuck player learns what they missed and why they moved on.
   */
  skipNote: string
}

/**
 * How many ticks a player may sit on one step before the tutorial gives up
 * waiting and moves them on. A tutorial that can dead-end is worse than one that
 * teaches a step imperfectly: the step conditions depend on the live match (an
 * enemy hero being in range, a creep wave having arrived), so any of them CAN
 * be unsatisfiable for a long stretch through no fault of the player.
 *
 * 15 cycles ≈ 60s at the 4s batch clock.
 */
export const TUTORIAL_STEP_DEADLINE_TICKS = 15

/** Ordered tutorial flow: each step unlocks exactly one new command type. */
export const TUTORIAL_FLOW: readonly TutorialStep[] = [
  {
    teaches: 'move',
    // The player spawns in the fountain. `move base` only reaches the base, and
    // the step deliberately holds until they leave it (see
    // advanceTutorialAfterTick) — so the hint must name a destination that
    // actually satisfies the step. Movement auto-paths one zone per tick, so a
    // single command walks the whole way.
    //
    // Send them to their OWN T1 ice, not `mid` (which aliases to mid-river).
    // The river is neutral, has no ice, and borders the AUDIT T1 — both enemy
    // bots are pinned to mid, so they reach it before the first creep wave does.
    // A level-1 newcomer who followed the old hint arrived alone, ahead of their
    // own creeps, and was stunned and killed inside ~12 ticks having landed
    // nothing. Standing behind your own ice is also just what the game wants
    // you to learn.
    hint: '🎓 Walk to your ice — type `move mid-t1-chaff`. You move one zone per cycle, so this takes a few.',
    skipNote:
      'Movement: `move <zone>` auto-paths one zone per cycle. Stay behind your own ice — the river is contested.',
  },
  {
    teaches: 'attack',
    hint: '🎓 Attack something — type `attack` to hit the nearest enemy, or `attack creep:0` to last-hit a creep for gold.',
    skipNote: 'Attacking: `attack` auto-targets; `attack creep:0` last-hits a creep for gold.',
  },
  {
    teaches: 'cast',
    // NB: many heroes' Q needs an enemy HERO in your zone. Say so — the old copy
    // claimed the cast "auto-picks a target", which stranded players whose zone
    // had no legal target with no idea why nothing happened.
    hint: '🎓 Use an ability — type `cast q`. Most Qs need an enemy hero in your zone, so close in first.',
    skipNote:
      'Abilities: `cast q|w|e|r`. Many need an enemy hero in your zone — check `status` for cooldowns.',
  },
  {
    teaches: 'buy',
    // NB: Termina movement is a fixed 1 zone/tick, so the moveSpeed stat is
    // inert — suggest an item with a stat that actually does something (+attack).
    hint: '🎓 Spend your gold — type `buy blades_of_attack` (you can buy from your base or fountain).',
    skipNote: 'Shopping: `buy <item>` works while you stand in your base or fountain.',
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
