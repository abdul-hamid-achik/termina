import type { Command } from '~~/shared/types/commands'

/**
 * Tutorial flow data — the ordered drills a new player is walked through.
 *
 * This lives in `shared/` because BOTH sides need it: the server gates commands,
 * evaluates each drill's OBJECTIVE against engine truth and advances the step
 * (server/game/modes/tutorial.ts), and the client renders the current hint +
 * checklist (TutorialHint.vue). Keep it pure data.
 *
 * Design (owner decision, Aug 2026 — replaces the verb-typing tutorial):
 *  - A step completes only when its objective ACTUALLY HAPPENED in the engine
 *    (a wave_strip event, damage on ICE, a ward placed…), never merely because
 *    the taught command was typed and accepted.
 *  - Deadlines no longer advance the step. They escalate HELP: sharper copy
 *    plus a controlled nudge that makes the objective practicable (a unit
 *    weakened into the strip window, a training stipend for the shop). Only
 *    after TUTORIAL_SKIP_AFTER_DEADLINES exhausted deadlines does the step
 *    skip — and a skip is COUNTED: graduation with any skips does not mark the
 *    player tutorial-complete (see tutorialMasteryAchieved).
 */

/** A single tutorial drill. */
export interface TutorialStep {
  /** Stable id — names the server-side objective AND the checklist label. */
  id: 'move' | 'attack' | 'strip' | 'burn' | 'cast' | 'buy' | 'tap' | 'ice'
  /** Command types this step unlocks (cumulative across steps). */
  unlocks: readonly Command['type'][]
  /** One-line hint surfaced to the player while this step is active. */
  hint: string
  /** Sharper guidance pushed when the step outlasts a deadline (with a nudge). */
  help: string
  /** Reinforcement pushed the moment the objective is achieved. */
  done: string
  /** Shown if the step skips after repeated deadlines (last resort). */
  skipNote: string
}

/**
 * How many cycles a step may sit unachieved before the tutorial escalates
 * help (a nudge that makes the objective practicable). 15 cycles ≈ 60s at the
 * 4s batch clock.
 */
export const TUTORIAL_STEP_DEADLINE_CYCLES = 15

/**
 * After this many exhausted deadlines on ONE step, the step skips (counted —
 * see module doc). The nudges are designed to make every objective achievable,
 * so this is a dead-end escape hatch, not a grading policy.
 */
export const TUTORIAL_SKIP_AFTER_DEADLINES = 3

/** Ordered tutorial flow. */
export const TUTORIAL_FLOW: readonly TutorialStep[] = [
  {
    id: 'move',
    unlocks: ['move'],
    // The player spawns in the fountain. Movement auto-paths one zone per
    // cycle, so a single command walks the whole way. Send them to their OWN
    // T1 ice: the river is neutral and both enemy bots are pinned to mid, so
    // arriving alone past your own ice gets a level-1 newcomer killed.
    hint: '🎓 Walk to your ice — type `move coldstore-t1-chaff`. You move one zone per cycle: the clock commits every order at once, four seconds wide.',
    help: '🎓 Still home? One command walks the whole way: `move coldstore-t1-chaff`. Watch the CYCLE clock — your order commits when it hits zero.',
    done: '🎓 On the route. Stay behind your own ICE — the crossing is contested ground.',
    skipNote:
      'Movement: `move <zone>` auto-paths one zone per cycle. Stay behind your own ICE — the crossing is contested.',
  },
  {
    id: 'attack',
    unlocks: ['attack'],
    hint: '🎓 Meet the traffic — `attack wave:0` swings at the first enemy unit in your zone.',
    help: '🎓 A wave just reached you — swing at it: `attack wave:0`.',
    done: '🎓 Contact. Damage is a means — the payload is what counts. Next: the strip.',
    skipNote: 'Attacking: `attack wave:N` hits a wave unit; bare `attack` picks the nearest enemy.',
  },
  {
    id: 'strip',
    unlocks: [],
    hint: '🎓 THE STRIP: a unit at or under 35% INTEG goes down to ANY swing. Watch the bars, time it, `attack wave:N` — the payload is yours.',
    help: '🎓 Timing, not damage: wait until a unit’s INTEG is low (≤35%), THEN swing. One of them is in the window right now.',
    done: '🎓 Strip taken (+scrip). That timing is the entire economy — a wave that dies to a wave pays nobody.',
    skipNote:
      'The strip: swing (`attack wave:N`) at a unit at ≤35% INTEG to take its payload, whatever your attack is worth.',
  },
  {
    id: 'burn',
    unlocks: ['burn'],
    hint: '🎓 THE BURN: your OWN unit under 50% can be torched — `burn wave:N`. You get a cut; the enemy gets nothing.',
    help: '🎓 Burn works on YOUR units only, inside their window. One of yours is low right now — `burn wave:N`.',
    done: '🎓 Burned. Reduced pay for you, zero for them — denial wins lanes.',
    skipNote: 'The burn: `burn wave:N` torches your own low unit so the enemy cannot strip it.',
  },
  {
    id: 'cast',
    unlocks: ['cast'],
    hint: '🎓 Your kit: `cast q` (w/e/r unlock as you level). Most Qs need an enemy in your zone — close in first.',
    help: '🎓 `status` shows cooldowns and BW (yours was just refilled). If your Q needs a target, stand where the enemy is — the crossing — then `cast q`.',
    done: '🎓 Ability fired. MAIN and RIG are separate slots — later, an item active (`use <item>`) can fire in the SAME cycle as a cast.',
    skipNote:
      'Abilities: `cast q|w|e|r`; many need an enemy in your zone. `status` shows cooldowns.',
  },
  {
    id: 'buy',
    unlocks: ['buy', 'sell'],
    hint: '🎓 Cash out — walk home (`move rookery-terminal`) and `buy edge_kit` (430sc). The shop works from your base or fountain.',
    help: '🎓 Short on scrip? Training stipend granted. From your base: `buy edge_kit`.',
    done: '🎓 Chrome fitted. Stats apply immediately — items are most of your power curve.',
    skipNote:
      'Shopping: `buy <item>` from your base or fountain; the shop lists what you can afford.',
  },
  {
    id: 'tap',
    unlocks: ['tap'],
    hint: '🎓 Fog: you see your zone and its neighbours, nothing else. `buy camtap` (75sc), then `tap <zone>` on your zone or a neighbour — it watches for you.',
    help: '🎓 The camtap comes first (`buy camtap` from base — stipend granted if short), then `tap` your zone or a neighbour.',
    done: '🎓 Eyes placed. Vision wins fights before they start — CAMTAP for presence, SNIFFER for the invisible.',
    skipNote:
      'Vision: buy a camtap or sniffer, then `tap <zone>` (current or adjacent) to watch it.',
  },
  {
    id: 'ice',
    unlocks: [],
    hint: '🎓 The objective: push WITH your wave and hit their ICE — `attack ice:coldstore-t1-audit`. It falls zone by zone; behind the last of it, their TERMINAL.',
    help: '🎓 Don’t tank the ICE alone — arrive with your wave, then `attack ice:coldstore-t1-audit`. One clean hit completes the drill.',
    done: '🎓 That’s the war: take the payload, burn the rest, place eyes, and trade INTEG into ICE until the TERMINAL is open. Practice complete.',
    skipNote:
      'The objective: `attack ice:<zone>` with a wave beside you; ICE, then more ICE, then the TERMINAL.',
  },
]

/** The number of scripted steps in the tutorial. */
export const TUTORIAL_STEP_COUNT = TUTORIAL_FLOW.length

/** The hint for the current step (null once the tutorial is complete). */
export function tutorialHint(step: number): string | null {
  return TUTORIAL_FLOW[step]?.hint ?? null
}

/** Whether the player has finished the scripted flow. */
export function isTutorialComplete(step: number): boolean {
  return step >= TUTORIAL_STEP_COUNT
}
