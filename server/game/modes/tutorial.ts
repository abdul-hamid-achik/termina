import type { Command } from '~~/shared/types/commands'
import type { GameState, TeamId, WaveUnitState } from '~~/shared/types/game'
import type { GameEngineEvent } from '~~/server/game/protocol/events'
import {
  TUTORIAL_FLOW,
  TUTORIAL_STEP_DEADLINE_CYCLES,
  TUTORIAL_SKIP_AFTER_DEADLINES,
  type TutorialStep,
} from '~~/shared/constants/tutorial'
import { HERO_IDS } from '~~/shared/constants/heroes'
import { ZONE_MAP } from '~~/shared/constants/zones'
import { ITEMS } from '~~/shared/constants/items'
import { STRIP_HP_THRESHOLD, BURN_HP_THRESHOLD, waveUnitMaxHp } from '~~/shared/constants/balance'

/**
 * Tutorial mode — objective-gated drills (server side).
 *
 * The player learns one thing at a time: only the commands unlocked so far
 * (plus always-allowed informational commands) pass validation, and a step
 * completes ONLY when its objective actually happened in the engine — a
 * wave_strip event, damage on ICE, a ward placed — never merely because the
 * taught command was typed and accepted.
 *
 * Deadlines escalate help instead of advancing: at each exhausted deadline the
 * step's sharper `help` copy is pushed together with a controlled NUDGE that
 * makes the objective practicable (a unit weakened into the strip window, BW
 * refilled, a training stipend). Only after TUTORIAL_SKIP_AFTER_DEADLINES
 * deadlines does a step skip, and the skip is counted in `tutorialSkips`:
 * graduation with skips ends the game normally but does NOT mark the player
 * tutorial-complete (tutorialMasteryAchieved) — the funnel keeps offering
 * practice until every drill was genuinely performed.
 *
 * The flow DATA (steps, copy) lives in shared/constants/tutorial so the client
 * can render it; this module owns the gate, the objectives and the nudges.
 */

// Re-export the shared flow so existing server-side imports keep one source.
export {
  TUTORIAL_FLOW,
  TUTORIAL_STEP_COUNT,
  TUTORIAL_STEP_DEADLINE_CYCLES,
  tutorialHint,
  tutorialUnlockedCommands,
  isCommandAllowedInTutorial,
} from '~~/shared/constants/tutorial'

/** Teaching rejection message for a command that's still locked at this step. */
export function tutorialLockMessage(step: number): string {
  const current = TUTORIAL_FLOW[Math.min(step, TUTORIAL_FLOW.length - 1)]
  return current ? current.hint : '🎓 Tutorial: follow the current step first.'
}

/**
 * Whether graduation should mark the player tutorial-complete. A run where
 * every drill was genuinely performed masters the tutorial; a run where any
 * step skipped itself on exhausted deadlines does not — the game still ends,
 * but the funnel keeps offering practice.
 */
export function tutorialMasteryAchieved(state: GameState): boolean {
  return (state.tutorialSkips ?? 0) === 0
}

export interface TutorialRosterPlayer {
  playerId: string
  team: TeamId
  heroId: string
}

/**
 * The roster for a tutorial game: a calm 2v2 on the one-lane map — the human
 * plus one ally bot versus two enemy bots, all with distinct heroes. The caller
 * pins the bots to mid via registerBots({ forceLane: 'coldstore' }). Pure so the shape
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
  /** Announcement to push to the human this cycle, or null. */
  notice: string | null
}

/** Zone types that count as home ground (the move drill holds until left). */
function isHomeGround(zoneId: string | undefined): boolean {
  const type = ZONE_MAP[zoneId ?? '']?.type
  return type === 'base' || type === 'anchor'
}

/**
 * Did this step's objective ACTUALLY happen this tick (or hold in state)?
 * Evaluated against engine truth: resolution events for everything the engine
 * emits, current state for the one positional drill (move).
 */
function objectiveMet(
  step: TutorialStep,
  state: GameState,
  humanId: string,
  events: readonly GameEngineEvent[],
): boolean {
  switch (step.id) {
    case 'move':
      return !isHomeGround(state.players[humanId]?.zone)
    case 'attack':
      // Any damage the human landed on a wave unit (spawner ids are `wave-N`;
      // tutorial-spawned practice units keep the prefix).
      return events.some(
        (e) =>
          e._tag === 'damage' && e.sourceId === humanId && String(e.targetId).startsWith('wave-'),
      )
    case 'strip':
      return events.some((e) => e._tag === 'wave_strip' && e.playerId === humanId)
    case 'burn':
      return events.some((e) => e._tag === 'wave_burn' && e.playerId === humanId)
    case 'cast':
      return events.some((e) => e._tag === 'ability_used' && e.playerId === humanId)
    case 'buy':
      return events.some((e) => e._tag === 'item_purchased' && e.playerId === humanId)
    case 'tap':
      return events.some((e) => e._tag === 'ward_placed' && e.playerId === humanId)
    case 'ice':
      return events.some(
        (e) =>
          e._tag === 'damage' && e.sourceId === humanId && String(e.targetId).startsWith('ice_'),
      )
  }
}

/** A practice wave unit for nudges, prefix-compatible with spawner ids. */
function practiceUnit(team: TeamId, zone: string, cycle: number, integ?: number): WaveUnitState {
  const full = waveUnitMaxHp('line', 0)
  return {
    id: `wave-tut-${team}-${cycle}`,
    team,
    zone,
    integ: integ ?? full,
    maxInteg: full,
    type: 'line',
  }
}

/** Top a player's scrip up to `target`, if short. */
function grantStipend(state: GameState, humanId: string, target: number): GameState {
  const human = state.players[humanId]
  if (!human || human.scrip >= target) return state
  return {
    ...state,
    players: { ...state.players, [humanId]: { ...human, scrip: target } },
  }
}

/**
 * The controlled nudge for a stalled step: change the WORLD so the objective
 * is practicable, never fake the objective itself. Idempotent enough to apply
 * at each exhausted deadline.
 */
function applyNudge(state: GameState, step: TutorialStep, humanId: string): GameState {
  const human = state.players[humanId]
  if (!human) return state
  const enemyTeam: TeamId = human.team === 'chaff' ? 'audit' : 'chaff'

  // World nudges that place or weaken wave units only make sense where waves
  // belong. A player still parked on home ground (never completed the move
  // drill) gets copy-only help — no enemy units spawn in a fountain.
  const wavesNudgeable = !isHomeGround(human.zone)
  if (!wavesNudgeable && (step.id === 'attack' || step.id === 'strip' || step.id === 'burn')) {
    return state
  }

  switch (step.id) {
    case 'attack': {
      // Ensure there is an enemy unit to swing at where the player stands.
      const hasTarget = state.waves.some(
        (w) => w.zone === human.zone && w.team === enemyTeam && w.integ > 0,
      )
      if (hasTarget) return state
      return { ...state, waves: [...state.waves, practiceUnit(enemyTeam, human.zone, state.cycle)] }
    }
    case 'strip': {
      // Ensure an enemy unit in the player's zone sits INSIDE the strip window.
      const inZone = state.waves.filter(
        (w) => w.zone === human.zone && w.team === enemyTeam && w.integ > 0,
      )
      const window = (w: WaveUnitState) =>
        w.integ <= (w.maxInteg ?? waveUnitMaxHp(w.type, 0)) * STRIP_HP_THRESHOLD
      if (inZone.some(window)) return state
      const lowest = inZone.sort((a, b) => a.integ - b.integ)[0]
      if (!lowest) {
        const low = Math.max(1, Math.floor(waveUnitMaxHp('line', 0) * STRIP_HP_THRESHOLD * 0.8))
        return {
          ...state,
          waves: [...state.waves, practiceUnit(enemyTeam, human.zone, state.cycle, low)],
        }
      }
      const spawn = lowest.maxInteg ?? waveUnitMaxHp(lowest.type, 0)
      const weakened = {
        ...lowest,
        integ: Math.max(1, Math.floor(spawn * STRIP_HP_THRESHOLD * 0.8)),
      }
      return { ...state, waves: state.waves.map((w) => (w.id === lowest.id ? weakened : w)) }
    }
    case 'burn': {
      // Same shape as strip, on the player's OWN units and the burn window.
      const inZone = state.waves.filter(
        (w) => w.zone === human.zone && w.team === human.team && w.integ > 0,
      )
      const window = (w: WaveUnitState) =>
        w.integ <= (w.maxInteg ?? waveUnitMaxHp(w.type, 0)) * BURN_HP_THRESHOLD
      if (inZone.some(window)) return state
      const lowest = inZone.sort((a, b) => a.integ - b.integ)[0]
      if (!lowest) {
        const low = Math.max(1, Math.floor(waveUnitMaxHp('line', 0) * BURN_HP_THRESHOLD * 0.8))
        return {
          ...state,
          waves: [...state.waves, practiceUnit(human.team, human.zone, state.cycle, low)],
        }
      }
      const spawn = lowest.maxInteg ?? waveUnitMaxHp(lowest.type, 0)
      const weakened = {
        ...lowest,
        integ: Math.max(1, Math.floor(spawn * BURN_HP_THRESHOLD * 0.8)),
      }
      return { ...state, waves: state.waves.map((w) => (w.id === lowest.id ? weakened : w)) }
    }
    case 'cast':
      // The commonest silent blocker is an empty BW pool. Refill it.
      return {
        ...state,
        players: { ...state.players, [humanId]: { ...human, bw: human.maxBw } },
      }
    case 'buy':
      return grantStipend(state, humanId, ITEMS.edge_kit?.cost ?? 430)
    case 'tap': {
      // The camtap item comes first; make sure it's affordable.
      const owns = (human.items ?? []).some((i) => i === 'camtap' || i === 'sniffer')
      if (owns) return state
      return grantStipend(state, humanId, ITEMS.camtap?.cost ?? 75)
    }
    case 'move':
    case 'ice':
      // Positional drills — sharper copy is the whole nudge.
      return state
  }
}

/**
 * Advance the tutorial after a tick's actions resolve.
 *
 * Objective-gated: see the module doc. Pure: returns the same state reference
 * when nothing changed.
 */
export function advanceTutorialAfterTick(
  state: GameState,
  validActions: readonly { playerId: string; command: Command }[],
  _rejected: readonly { playerId: string }[],
  events: readonly GameEngineEvent[] = [],
): TutorialAdvance {
  if (state.mode !== 'tutorial') return { state, notice: null }
  let step = state.tutorialStep ?? 0
  if (step >= TUTORIAL_FLOW.length) return { state, notice: null }

  const humanId = Object.keys(state.players).find((id) => !id.startsWith('bot_'))
  if (!humanId) return { state, notice: null }

  // Objectives achieved this tick — several can land in one cycle (a swing
  // that both first-hits AND strips a unit), so advance through all of them.
  let current = state
  const notices: string[] = []
  while (
    step < TUTORIAL_FLOW.length &&
    objectiveMet(TUTORIAL_FLOW[step]!, current, humanId, events)
  ) {
    notices.push(TUTORIAL_FLOW[step]!.done)
    current = advanceTo(current, step + 1)
    step += 1
  }
  if (notices.length > 0) return { state: current, notice: notices.join(' ') }

  // Deadline machinery: at each exhausted deadline push the sharper help copy
  // and nudge the world; after the last one, skip — counted, never silent.
  const since = current.tutorialStepSince ?? 0
  const elapsed = current.cycle - since
  const stepDef = TUTORIAL_FLOW[step]!

  if (elapsed >= TUTORIAL_STEP_DEADLINE_CYCLES * TUTORIAL_SKIP_AFTER_DEADLINES) {
    const skipped = advanceTo(
      { ...current, tutorialSkips: (current.tutorialSkips ?? 0) + 1 },
      step + 1,
    )
    return { state: skipped, notice: `🎓 Moving on — ${stepDef.skipNote}` }
  }

  // Exactly-on-the-boundary check: this runs once per cycle, so each deadline
  // multiple fires its help+nudge exactly once.
  if (elapsed > 0 && elapsed % TUTORIAL_STEP_DEADLINE_CYCLES === 0) {
    return { state: applyNudge(current, stepDef, humanId), notice: stepDef.help }
  }

  // A move typed while still on home ground is the one objective miss that
  // deserves an immediate word: from the fountain the first hop only reaches
  // base, so the player who did exactly what the hint said would otherwise
  // watch nothing happen until the first deadline. Everything else waits for
  // the deadline help. (Runs after the skip/nudge checks so it can never
  // starve them.)
  if (
    stepDef.id === 'move' &&
    isHomeGround(current.players[humanId]?.zone) &&
    validActions.some((a) => a.playerId === humanId && a.command.type === 'move')
  ) {
    return {
      state: current,
      notice:
        '🎓 Still on home ground — keep going: `move coldstore-t1-chaff` walks the whole way.',
    }
  }

  return { state: current, notice: null }
}

/** Step the flow forward, stamping the tick so the next step gets a fresh deadline. */
function advanceTo(state: GameState, nextStep: number): GameState {
  return { ...state, tutorialStep: nextStep, tutorialStepSince: state.cycle }
}
