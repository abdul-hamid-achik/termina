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
  /**
   * Cycles into the step after which, if the world still lacks what the drill
   * needs (an enemy unit to swing at, an enemy hero to breach), the tutorial
   * sets it up and pushes `help` — instead of leaving the player idle for the
   * full deadline. Always shorter than TUTORIAL_STEP_DEADLINE_CYCLES.
   */
  earlyNudgeCycles?: number
  /**
   * Said when the drill's ACTION happened but not the way it teaches (a cast
   * that fired without a breach): the step stays open and this explains the
   * missing half. `<hero>` is replaced with the target's handle at runtime.
   */
  almost?: string
  /** The cast drill's line for a cast that never touched an enemy hero (a
   *  self-heal, a shield, a buff on an ally): nothing CLOSED was met, so the
   *  `almost` copy would be wrong — it only asks for the breach half. */
  almostNoFoe?: string
  /**
   * Cast drill only: from this many cycles into the step, a plain cast at the
   * held target also clears it (the player has been told how to breach twice —
   * the opening notice and the "that cast met a CLOSED hero" one). Without it a
   * player who only ever types the "try" button's `cast q` never finishes.
   */
  plainCastAfterCycles?: number
  /** The command the feed's "try" button offers, when it is not the first backticked one. */
  tryCommand?: string
}

/**
 * Where the first move sends the player: their OWN T2 ice, behind T1. One
 * constant so the hint and the "you are on your way" notice can never name
 * different zones (they once did: T2 in the hint, T1 — the suicide tile — in
 * the notice).
 */
const TUTORIAL_FIRST_MOVE_ZONE = 'coldstore-t2-chaff'

/** The notice pushed while the opening walk is still on home ground. */
export const TUTORIAL_ENROUTE_NOTICE = `🎓 On your way — the order stands. You keep walking toward \`${TUTORIAL_FIRST_MOVE_ZONE}\`, one zone per cycle; no need to retype it.`

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
    // T2 ice — behind T1, still on the route. T1 is the first tile enemy bots
    // dive; a level-1 walk onto T1 is a suicide (first-play finding). T2 has
    // friendly ice cover and is not the contested lip.
    hint: `🎓 Walk to your ice — type \`move ${TUTORIAL_FIRST_MOVE_ZONE}\`. You move one zone per cycle: the clock commits every order at once, four seconds wide. Stay behind your T1.`,
    help: `🎓 Still home? One command walks the whole way: \`move ${TUTORIAL_FIRST_MOVE_ZONE}\`. Watch the CYCLE clock — your order commits when it hits zero.`,
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
    // The first wave does not reach T2 on its own for a while (the lines meet at
    // T1, which is not where a level-1 hero should stand): bring a practice unit
    // instead of letting the player idle.
    earlyNudgeCycles: 4,
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
    unlocks: ['cast', 'breach'],
    // `<hero>` is filled in with the held target's handle by the notices the
    // server pushes (modes/tutorial.ts); the static hint can't know the handle.
    hint: '🎓 Your kit: control and code bounce off a CLOSED hero. `breach <hero>` opens one for 5 cycles (50 BW) — THEN `cast q` (w/e unlock as you level). The enemy hero must be in your zone; once you are out on the lane, one is held there for you.',
    help: '🎓 Close it, then fire: `breach <hero>` (BW refilled), and next cycle `cast q` — the opening lasts 5 cycles. Support kits cast on yourself or an ally.',
    almost:
      '🎓 That cast met a CLOSED hero — control fails and code damage is halved. `breach <hero>` first (50 BW), then cast again while they are open.',
    almostNoFoe:
      '🎓 Cast fired — now the combo: `breach <hero>` (50 BW) to open the enemy, then cast again while they are open.',
    done: '🎓 Breach, then ability — that is the whole combat loop. MAIN and RIG are separate slots — later, an item active (`use <item>`) can fire in the SAME cycle as a cast.',
    skipNote:
      'Abilities: `breach <hero>` opens a CLOSED enemy for 5 cycles, then `cast q|w|e|r` — hard control and code damage only land on an open hero.',
    tryCommand: 'cast q',
    plainCastAfterCycles: 6,
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

/** The first backticked command in the current hint — what the feed bar offers. */
export function tutorialTryCommand(step: number): string | null {
  const hint = tutorialHint(step)
  if (!hint) return null
  const explicit = TUTORIAL_FLOW[step]?.tryCommand
  if (explicit) return explicit
  const match = hint.match(/`([^`]+)`/)
  return match?.[1] ?? null
}

/** Whether the player has finished the scripted flow. */
export function isTutorialComplete(step: number): boolean {
  return step >= TUTORIAL_STEP_COUNT
}

/**
 * Commands always available in tutorial mode, regardless of step.
 * Lives here (not only on the server) so the HUD/coach can refuse to
 * advertise a verb the engine will lock.
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

/** Cumulative unlocks at `step`, plus the always-allowed set. */
export function tutorialUnlockedCommands(step: number): ReadonlySet<Command['type']> {
  const unlocked = new Set<Command['type']>(TUTORIAL_ALWAYS_ALLOWED)
  for (let i = 0; i <= step && i < TUTORIAL_FLOW.length; i++) {
    for (const cmd of TUTORIAL_FLOW[i]!.unlocks) unlocked.add(cmd)
  }
  return unlocked
}

/** Whether a command type is allowed at the current tutorial step. */
export function isCommandAllowedInTutorial(commandType: Command['type'], step: number): boolean {
  if (step >= TUTORIAL_STEP_COUNT) return true
  return tutorialUnlockedCommands(step).has(commandType)
}
