import type { Command } from '~~/shared/types/commands'
import type { GameState, PlayerState, TeamId, WaveUnitState } from '~~/shared/types/game'
import type { GameEngineEvent } from '~~/server/game/protocol/events'
import {
  TUTORIAL_FLOW,
  TUTORIAL_STEP_DEADLINE_CYCLES,
  TUTORIAL_SKIP_AFTER_DEADLINES,
  TUTORIAL_FIRST_MOVE_ZONE,
  TUTORIAL_SKIP_CLOCK_ON_FIRST_ORDER,
  TUTORIAL_IDLE_END_CYCLES,
  TUTORIAL_IDLE_END_NOTICE,
  tutorialEnrouteNotice,
  liveIceDrillZone,
  withIceDrillZone,
  TRAINING_WAVE_PREFIX,
  isTrainingWave,
  type TutorialStep,
} from '~~/shared/constants/tutorial'
import { findPath, pathDistance } from '~~/shared/pathfinding'
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
 * Drills that need the world set up (an enemy unit to swing at, an enemy hero
 * to breach) carry `earlyNudgeCycles`: the setup arrives early, not after the
 * full deadline. The cast drill is "breach, then cast" — see objectiveMet.
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
    case 'cast': {
      // "Breach, then cast": an ability fired while an enemy hero the human
      // opened is STILL open (breach lasts several cycles; an auto-breach — a
      // control cast converted into a breach — opens it just the same). Hard-
      // control heroes otherwise only ever landed a fraction of their casts,
      // because nothing taught BREACH — so the drill is the combo, not a lone
      // cast. Escape hatch: a few cycles in (opening notice pushed, target held in
      // the zone — see plainCastAfterCycles) a plain cast (the foe is held in their zone) also clears it —
      // a player who only ever typed `cast q` is not stranded, and not skipped.
      const cast = events.some((e) => e._tag === 'ability_used' && e.playerId === humanId)
      if (!cast) return false
      const opened = Object.values(state.players).some(
        (p) =>
          p.id !== humanId &&
          p.alive !== false &&
          (p.buffs ?? []).some(
            (b) => b.id === 'breached' && b.source === humanId && b.cyclesRemaining > 0,
          ),
      )
      if (opened) return true
      const elapsed = state.cycle - (state.tutorialStepSince ?? 0)
      const human = state.players[humanId]
      return (
        elapsed >= (step.plainCastAfterCycles ?? Infinity) && !!human && !isHomeGround(human.zone)
      )
    }
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

/** A training wave unit (inert to the NPC pass — see TRAINING_WAVE_PREFIX). */
function practiceUnit(team: TeamId, zone: string, cycle: number, integ?: number): WaveUnitState {
  const full = waveUnitMaxHp('line', 0)
  return {
    id: `${TRAINING_WAVE_PREFIX}${team}-${cycle}`,
    team,
    zone,
    integ: integ ?? full,
    maxInteg: full,
    type: 'line',
  }
}

/** The drills that act on a wave unit standing in the player's zone. */
type UnitDrill = 'attack' | 'strip' | 'burn'
const UNIT_DRILLS: ReadonlySet<TutorialStep['id']> = new Set<TutorialStep['id']>([
  'attack',
  'strip',
  'burn',
])
const isUnitDrill = (id: TutorialStep['id']): id is UnitDrill => UNIT_DRILLS.has(id)

/** The unit a drill needs as `wave:0`, as (team, INTEG ceiling as a fraction of max | null). */
function drillTarget(
  drill: UnitDrill,
  humanTeam: TeamId,
): { team: TeamId; window: number | null; verb: 'attack' | 'burn' } {
  const enemy: TeamId = humanTeam === 'chaff' ? 'audit' : 'chaff'
  switch (drill) {
    case 'attack':
      return { team: enemy, window: null, verb: 'attack' }
    case 'strip':
      return { team: enemy, window: STRIP_HP_THRESHOLD, verb: 'attack' }
    case 'burn':
      return { team: humanTeam, window: BURN_HP_THRESHOLD, verb: 'burn' }
  }
}

/** Whether `w` is a valid target for the drill (right team, alive, inside the window). */
function fitsDrill(w: WaveUnitState, target: ReturnType<typeof drillTarget>): boolean {
  if (w.team !== target.team || w.integ <= 0) return false
  if (target.window === null) return true
  return w.integ <= (w.maxInteg ?? waveUnitMaxHp(w.type, 0)) * target.window
}

/**
 * Keep a TRAINING UNIT for the attack / strip / burn drill standing in the
 * player's zone as `wave:0`.
 *
 * Why this exists (live playtest, Oct 2026): a level-1 hero parked at their T2
 * almost never sees a unit in the window — the lines meet and die at the
 * crossing, the player's own ICE finishes any leaker, and an own unit walks
 * through. The old once-per-deadline nudge planted a unit that the SAME tick's
 * NPC pass then shot dead (enemy) or walked off (own) before anything was shown.
 * The planted unit is now inert (isTrainingWave) and re-checked EVERY cycle: if
 * the zone's first unit already fits the drill (a natural one — or the planted
 * one) nothing changes; otherwise stale training units in the zone are swept and
 * a fresh one is put in front, so it is always `wave:0`.
 *
 * Returns the planted unit when the world changed (the caller tells the player),
 * null when nothing needed doing. A player on home ground, or dead, gets nothing:
 * there is no lane to put a unit on.
 */
function upkeepTrainingUnit(
  state: GameState,
  drill: UnitDrill,
  humanId: string,
): { state: GameState; planted: WaveUnitState | null } {
  const human = state.players[humanId]
  if (!human || human.alive === false || isHomeGround(human.zone)) return { state, planted: null }
  const waves = state.waves ?? []
  const target = drillTarget(drill, human.team)
  const first = waves.find((w) => w.zone === human.zone)
  if (first && fitsDrill(first, target)) return { state, planted: null }

  const fraction = target.window === null ? 1 : target.window * 0.8
  const full = waveUnitMaxHp('line', 0)
  const integ = target.window === null ? full : Math.max(1, Math.floor(full * fraction))
  const planted = practiceUnit(target.team, human.zone, state.cycle, integ)
  const kept = waves.filter((w) => !(isTrainingWave(w) && w.zone === human.zone))
  return { state: { ...state, waves: [planted, ...kept] }, planted }
}

/** What the player is told about the unit waiting in their zone — state-true: built
 *  from the unit that is actually there at the end of this tick's tutorial pass. */
function unitLine(drill: UnitDrill, state: GameState, humanId: string): string | null {
  const human = state.players[humanId]
  if (!human) return null
  if (human.alive === false || isHomeGround(human.zone)) {
    return `Step out of your base first — \`move ${TUTORIAL_FIRST_MOVE_ZONE}\`; the training unit is kept for you on the lane.`
  }
  const target = drillTarget(drill, human.team)
  const inZone = state.waves.filter((w) => w.zone === human.zone)
  const index = inZone.findIndex((w) => fitsDrill(w, target))
  if (index < 0) return null
  const w = inZone[index]!
  const max = w.maxInteg ?? waveUnitMaxHp(w.type, 0)
  const command = `\`${target.verb} wave:${index}\``
  switch (drill) {
    case 'attack':
      return `A wave unit is in your zone — swing at it: ${command}.`
    case 'strip':
      return `A unit in your zone is at ${w.integ}/${max} INTEG — inside the strip window (≤${Math.round(STRIP_HP_THRESHOLD * 100)}%). Swing now: ${command}.`
    case 'burn':
      return `One of YOUR units here is at ${w.integ}/${max} INTEG — inside the burn window (≤${Math.round(BURN_HP_THRESHOLD * 100)}%). Torch it: ${command}.`
  }
}

/** Remove every training unit (the drills that needed them are over). */
function clearTrainingUnits(state: GameState): GameState {
  if (!(state.waves ?? []).some(isTrainingWave)) return state
  return { ...state, waves: state.waves.filter((w) => !isTrainingWave(w)) }
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

/** Living enemy heroes standing in `zone` (the human's side excluded). */
function foesIn(state: GameState, humanId: string, zone: string) {
  const human = state.players[humanId]
  return Object.values(state.players).filter(
    (p) => p.id !== humanId && p.team !== human?.team && p.alive !== false && p.zone === zone,
  )
}

/** The handle a player types to target a hero. */
function handleOf(p: { heroId?: string | null; name?: string; id: string }): string {
  return p.heroId ?? p.name ?? p.id
}

/**
 * Bring the nearest living enemy hero into the human's zone so there is
 * something to breach and cast at. A no-op when one is already there. Changes
 * the WORLD only — the breach and the cast stay the player's to perform.
 */
function pullNearestFoe(state: GameState, humanId: string): GameState {
  const human = state.players[humanId]
  if (!human) return state
  if (foesIn(state, humanId, human.zone).length > 0) return state
  const hasZone = (id: string) => id in state.zones
  const candidates = Object.values(state.players)
    .filter((p) => p.team !== human.team && p.alive !== false)
    .map((p) => ({ p, d: pathDistance(p.zone, human.zone, hasZone) }))
    .filter((c) => c.d >= 0)
    .sort((a, b) => a.d - b.d)
  const foe = candidates[0]?.p
  if (!foe) return state
  return {
    ...state,
    players: {
      ...state.players,
      [foe.id]: { ...foe, zone: human.zone, moveTarget: null, attackTarget: null },
    },
  }
}

/** Self-sourced stun: self-applied control always lands, CLOSED or not, and it
 *  is refreshed per cycle so it lapses the moment the drill that set it ends.
 *  cyclesRemaining 2: survives this cycle's end-of-tick reap and still gates the
 *  held hero's next action (see applyBuff's note on one-gated-action). */
function heldBuffs(p: PlayerState): PlayerState['buffs'] {
  return [
    ...(p.buffs ?? []).filter((b) => !(b.id === 'stun' && b.source === p.id)),
    { id: 'stun', stacks: 1, cyclesRemaining: 2, source: p.id },
  ]
}

/**
 * Keep a training target in the player's zone for the whole cast drill.
 *
 * A bot pulled in once simply walks, retreats or dies a cycle later (the probe
 * saw 17–39 consecutive "Requires a hero target" rejections), so every cycle of
 * the drill: bring the nearest foe back if none is in the zone, and HOLD every
 * enemy hero there with a self-sourced stun (self-applied control always lands,
 * CLOSED or not) — it can neither leave nor hit back while the player learns
 * breach-then-cast — and is topped up each cycle against the zone's own ICE. The stun is a per-cycle refresh, so it lapses the moment
 * the drill ends. Tutorial-only; never onto home ground.
 */
function pinTrainingFoe(
  state: GameState,
  humanId: string,
  refillBw: boolean,
): { state: GameState; pulled: boolean } {
  const human = state.players[humanId]
  if (!human || human.alive === false || isHomeGround(human.zone)) return { state, pulled: false }
  const before = foesIn(state, humanId, human.zone).length
  let next = pullNearestFoe(state, humanId)
  const pulled = before === 0 && next !== state
  const held = foesIn(next, humanId, human.zone)
  if (held.length > 0) {
    const players = { ...next.players }
    for (const f of held) {
      players[f.id] = {
        ...f,
        // The player's own ICE shoots any hero in its zone (the held foe died in
        // four cycles under T2) and a landed nuke can finish it — top the
        // training target up every cycle so the drill is never lost to the room
        // it is held in or to the very cast it teaches.
        integ: f.maxInteg,
        buffs: heldBuffs(f),
      }
    }
    next = { ...next, players }
  }
  if (refillBw && human.bw < human.maxBw) {
    next = {
      ...next,
      players: { ...next.players, [humanId]: { ...next.players[humanId]!, bw: human.maxBw } },
    }
  }
  return { state: next, pulled }
}

/** Id prefix of the friendly unit the ICE drill keeps beside the player. A REAL
 *  unit (not a TRAINING_WAVE_PREFIX one): the point is that the ICE and the
 *  enemy units shoot it instead of the player, which inert units never draw. */
const ICE_ESCORT_PREFIX = 'wave-escort-'

/**
 * The ICE drill, made survivable (playtest 2, Oct 2026): the player walked onto
 * the enemy T1 to read and type under four enemy units, the ICE itself and both
 * enemy heroes, and died three times. For the length of the drill, every cycle:
 *
 *  - the enemy crew is HELD where it stands (the cast drill's self-sourced
 *    stun, without the pull) — no enemy hero swings at the player;
 *  - a friendly line unit ESCORTS the player: when no healthy friendly unit
 *    stands in the player's zone (or the next zone of the walk they ordered),
 *    one is put there. It is a real unit, so the enemy units (which fight units
 *    before heroes) and the ICE (which shoots units before a hero that has not
 *    struck it) take it first — "push WITH your wave". An escort that walks off
 *    on its own is brought back rather than replaced, so a player who stands
 *    still never feeds a column of units into the ICE.
 *
 * Changes the WORLD only; the hit on the ICE stays the player's. Nothing on
 * home ground (no lane there), nothing for a dead player.
 */
function upkeepIceDrill(
  state: GameState,
  humanId: string,
): { state: GameState; escorted: boolean } {
  const human = state.players[humanId]
  if (!human) return { state, escorted: false }
  const players = { ...state.players }
  for (const p of Object.values(state.players)) {
    if (p.team !== human.team && p.alive !== false) players[p.id] = { ...p, buffs: heldBuffs(p) }
  }
  let next: GameState = { ...state, players }
  if (human.alive === false || isHomeGround(human.zone)) return { state: next, escorted: false }

  // Where the escort is needed: the player's zone, and the next zone of the walk
  // they ordered (an ICE order from range walks — see approachStructure). A unit
  // put only where the player stands arrives a cycle late: units and ICE pick
  // their targets from the zone as the cycle opens, so the zone the player
  // walks INTO must already hold one.
  const hasZone = (id: string) => id in state.zones
  const heading =
    human.moveTarget ?? (human.attackTarget?.kind === 'ice' ? human.attackTarget.zone : null)
  const nextHop = heading ? findPath(human.zone, heading, hasZone)[1] : undefined
  const zones = [human.zone, ...(nextHop && !isHomeGround(nextHop) ? [nextHop] : [])]

  const full = waveUnitMaxHp('line', 0)
  // Escorts that walked out of the zones they cover (a unit with nothing to
  // fight walks on down the lane). They are brought BACK, never replaced: a
  // fresh one every cycle behind a player who stands still marched a column of
  // units into T1 — the ICE the hint names.
  const isEscort = (w: WaveUnitState) => w.id.startsWith(ICE_ESCORT_PREFIX) && w.integ > 0
  const strays = (next.waves ?? []).filter((w) => isEscort(w) && !zones.includes(w.zone))
  const moved = new Map<string, string>()
  let planted: WaveUnitState[] = []
  let escorted = false
  for (const zone of zones) {
    // A unit about to drop (two ICE shots from gone) is no cover: the ICE
    // retargets the player the cycle it dies.
    const covered = (next.waves ?? []).some(
      (w) => w.team === human.team && w.zone === zone && w.integ > full / 2 && !isTrainingWave(w),
    )
    if (covered) continue
    const stray = strays.find((w) => !moved.has(w.id) && w.integ > full / 2)
    if (stray) {
      moved.set(stray.id, zone)
      continue
    }
    planted = [
      ...planted,
      {
        id: `${ICE_ESCORT_PREFIX}${human.team}-${state.cycle}-${zone}`,
        team: human.team,
        zone,
        integ: full,
        maxInteg: full,
        type: 'line',
      },
    ]
    escorted = true
  }
  const strayIds = new Set(strays.map((w) => w.id))
  const kept = (next.waves ?? []).flatMap((w) => {
    const to = moved.get(w.id)
    if (to) return [{ ...w, zone: to }]
    return strayIds.has(w.id) ? [] : [w]
  })
  next = { ...next, waves: [...kept, ...planted] }
  return { state: next, escorted }
}

/**
 * The controlled nudge for a stalled step: change the WORLD so the objective
 * is practicable, never fake the objective itself. Idempotent enough to apply
 * at each exhausted deadline.
 */
function applyNudge(state: GameState, step: TutorialStep, humanId: string): GameState {
  const human = state.players[humanId]
  if (!human) return state

  switch (step.id) {
    case 'attack':
    case 'strip':
    case 'burn':
      // Kept every cycle by upkeepTrainingUnit (an inert training unit), not
      // nudged once at a deadline: a planted normal unit did not survive the
      // same tick's NPC pass.
      return state
    case 'cast': {
      // Two silent blockers: an empty BW pool (refill it) and no enemy hero in
      // reach to breach (bring the nearest one to the player's zone — never onto
      // home ground, where there is nothing to fight).
      const refilled: GameState =
        human.bw < human.maxBw
          ? { ...state, players: { ...state.players, [humanId]: { ...human, bw: human.maxBw } } }
          : state
      return isHomeGround(human.zone) ? refilled : pullNearestFoe(refilled, humanId)
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

  // The ONE idle budget: no typed order for TUTORIAL_IDLE_END_CYCLES (from the
  // last order, else the start of the practice) ends the practice — mid-flow,
  // so game_over reads `left_early`. Checked before any drill can skip.
  const lastOrder = current.players[humanId]?.lastActionCycle
  if (current.cycle - (lastOrder ?? 0) >= TUTORIAL_IDLE_END_CYCLES) {
    const team = current.players[humanId]?.team
    return {
      state: {
        ...current,
        phase: 'ended',
        // As a surrender would: the other crew takes it. No completion is
        // banked — the flow never reached its end.
        winner: team === 'audit' ? 'chaff' : 'audit',
      },
      notice: TUTORIAL_IDLE_END_NOTICE,
    }
  }

  // The human's first order in this step (an order resolved on the very cycle
  // the step opened belonged to the step before — hence strictly after).
  if (
    current.tutorialFirstOrderCycle === undefined &&
    lastOrder !== undefined &&
    lastOrder > since
  ) {
    current = { ...current, tutorialFirstOrderCycle: lastOrder }
  }
  if (skipDue(stepDef, current, humanId)) {
    const skipped = advanceTo(
      {
        ...current,
        tutorialSkips: (current.tutorialSkips ?? 0) + 1,
        tutorialSkipped: [...(current.tutorialSkipped ?? []), stepDef.id],
      },
      step + 1,
    )
    return { state: skipped, notice: `🎓 Moving on — ${stepDef.skipNote}` }
  }

  // The cast drill needs an enemy hero to breach: hold one in the player's zone
  // from the first cycle on (see pinTrainingFoe). Its handle goes into the
  // notices — `breach <hero>` takes a name the player has to read off the screen.
  let pinnedNew = false
  if (stepDef.id === 'cast' && elapsed >= 1) {
    const pin = pinTrainingFoe(current, humanId, elapsed === 1)
    current = pin.state
    pinnedNew = pin.pulled
  }
  // The ICE drill holds the enemy crew and keeps an escort beside the player
  // (see upkeepIceDrill) — every cycle of the step.
  let escortedFirst = false
  if (stepDef.id === 'ice' && elapsed >= 1) {
    const hadEscort = (current.waves ?? []).some((w) => w.id.startsWith(ICE_ESCORT_PREFIX))
    const up = upkeepIceDrill(current, humanId)
    current = up.state
    escortedFirst = up.escorted && !hadEscort
  }
  // The attack / strip / burn drills keep an inert training unit in the player's
  // zone (see upkeepTrainingUnit) — every cycle once armed, so it is there on the
  // screen when the player reads and types, however slowly.
  let planted: WaveUnitState | null = null
  if (isUnitDrill(stepDef.id) && elapsed >= (stepDef.earlyNudgeCycles ?? 0)) {
    const up = upkeepTrainingUnit(current, stepDef.id, humanId)
    current = up.state
    planted = up.planted
  }
  // Coaching about a unit is built from the unit that is ACTUALLY there at the
  // end of this pass — never a claim the zone cannot back up.
  const withUnitLine = (text: string, st: GameState): string => {
    if (!isUnitDrill(stepDef.id)) return text
    const line = unitLine(stepDef.id, st, humanId)
    return line ? `${text} ${line}` : text
  }
  const withHandle = (text: string, st: GameState): string => {
    if (stepDef.id !== 'cast') return withUnitLine(text, st)
    const human = st.players[humanId]
    // No target is ever held on home ground (pinTrainingFoe) — say where it is.
    if (human && isHomeGround(human.zone)) {
      return `${text} Step out of your base first — the training target is held for you on the lane.`
    }
    const foes = human ? foesIn(st, humanId, human.zone) : []
    if (foes.length === 0) return text
    const handle = handleOf(foes[0]!)
    return text.includes('<hero>')
      ? text.replaceAll('<hero>', handle)
      : `${text} In your zone: ${foes.map(handleOf).join(', ')}.`
  }
  // The ICE drill names the ICE that is actually standing (waves may have razed
  // the drill's T1 already) — the same pick the client's chip makes.
  const iceZone = (st: GameState): string =>
    liveIceDrillZone(st.ice, st.players[humanId]?.team ?? 'chaff')
  const helpWith = (st: GameState): string =>
    stepDef.id === 'ice'
      ? withIceDrillZone(withHandle(stepDef.help, st), iceZone(st))
      : withHandle(stepDef.help, st)

  // Exactly-on-the-boundary check: this runs once per cycle, so each deadline
  // multiple fires its help+nudge exactly once. The nudge (BW refill, a pulled
  // target) is applied before any other notice is chosen, so a cast typed on a
  // deadline cycle cannot cost the player that deadline's refill.
  const atDeadline = elapsed > 0 && elapsed % TUTORIAL_STEP_DEADLINE_CYCLES === 0
  if (atDeadline) current = applyNudge(current, stepDef, humanId)

  // A cast that fired without the breach half: the drill stays open and says
  // why — "met a CLOSED hero" only when the cast actually touched an enemy hero.
  if (
    stepDef.id === 'cast' &&
    stepDef.almost &&
    events.some((e) => e._tag === 'ability_used' && e.playerId === humanId)
  ) {
    const metFoe = castTouchedEnemyHero(current, humanId, events)
    const text = metFoe ? stepDef.almost : (stepDef.almostNoFoe ?? stepDef.almost)
    return { state: current, notice: withHandle(text, current) }
  }

  if (atDeadline) return { state: current, notice: helpWith(current) }

  // A training unit was just put in front of the player: say exactly what and where.
  if (planted && isUnitDrill(stepDef.id)) {
    const line = unitLine(stepDef.id, current, humanId)
    if (line) return { state: current, notice: `🎓 ${line}` }
  }

  // Early nudge: a drill that needs the world set up (an enemy unit to swing at,
  // an enemy hero to breach) doesn't make the player wait out the whole
  // deadline. If the setup is already there the nudge changes nothing and the
  // player hears nothing.
  if (stepDef.earlyNudgeCycles !== undefined && elapsed === stepDef.earlyNudgeCycles) {
    const nudged = applyNudge(current, stepDef, humanId)
    if (nudged !== current) return { state: nudged, notice: helpWith(nudged) }
  }

  // The first escort just fell in beside the player: say so, and what it is for.
  if (escortedFirst) {
    return {
      state: current,
      notice: `🎓 A wave unit falls in beside you and the enemy crew is held at their posts for this drill — the ICE and their units shoot your escort first. One order does the rest: \`attack ice:${iceZone(current)}\`.`,
    }
  }

  // The held target just arrived (or the drill just opened): tell the player who.
  if (pinnedNew || (stepDef.id === 'cast' && elapsed === 1)) {
    return { state: current, notice: helpWith(current) }
  }

  // A move typed while still on home ground is the one objective miss that
  // deserves an immediate word: from the fountain the first hop only reaches
  // base, so the player who did exactly what the hint said would otherwise
  // watch nothing happen until the first deadline. Everything else waits for
  // the deadline help. (Runs after the skip/nudge checks so it can never
  // starve them.) A move toward the lane is an order that STANDS (auto-path) —
  // the notice says so, naming the same zone the hint did; a move to another
  // home tile gets the step's own guidance instead.
  if (stepDef.id === 'move' && isHomeGround(current.players[humanId]?.zone)) {
    const typed = validActions.find((a) => a.playerId === humanId && a.command.type === 'move')
    if (typed && typed.command.type === 'move') {
      // Name the walk's real destination (the held auto-path target, else the
      // typed zone) — never the hint's zone: the player may have ordered another.
      const destination = current.players[humanId]?.moveTarget ?? typed.command.zone
      return {
        state: current,
        notice: isHomeGround(typed.command.zone)
          ? stepDef.help
          : tutorialEnrouteNotice(destination),
      }
    }
  }

  return { state: current, notice: null }
}

/** Did the human's cast this cycle reach an enemy HERO — aimed at one, damaging
 *  one, or a control resisted by one? (A self-heal/shield/ally buff did not.) */
function castTouchedEnemyHero(
  state: GameState,
  humanId: string,
  events: readonly GameEngineEvent[],
): boolean {
  const team = state.players[humanId]?.team
  const isEnemyHero = (id: unknown) => {
    const p = typeof id === 'string' ? state.players[id] : undefined
    return !!p && p.team !== team
  }
  return events.some(
    (e) =>
      (e._tag === 'ability_used' && e.playerId === humanId && isEnemyHero(e.targetId)) ||
      (e._tag === 'damage' && e.sourceId === humanId && isEnemyHero(e.targetId)) ||
      (e._tag === 'control_resisted' && e.playerId === humanId),
  )
}

/**
 * Whether the stalled step's last deadline is spent and it skips now.
 *
 * The skip clock runs from the step's start — or, for
 * TUTORIAL_SKIP_CLOCK_ON_FIRST_ORDER drills, from the player's first order in
 * the step (the ICE drill: their LATEST order in it). No order yet: never — only
 * the deadline help, and the tutorial-wide idle budget (TUTORIAL_IDLE_END_CYCLES)
 * for a player who has gone. The ICE drill also never skips under a live ICE /
 * Terminal order: the player is doing the drill, and its skip ends the game
 * (graduation).
 */
function skipDue(step: TutorialStep, state: GameState, humanId: string): boolean {
  const from = skipClockFrom(step, state, humanId)
  if (from === undefined) return false
  if (state.cycle - from < TUTORIAL_STEP_DEADLINE_CYCLES * TUTORIAL_SKIP_AFTER_DEADLINES) {
    return false
  }
  const held = state.players[humanId]?.attackTarget?.kind
  return !(step.id === 'ice' && (held === 'ice' || held === 'terminal'))
}

/** Where the step's skip clock starts (see skipDue); undefined = not running. */
function skipClockFrom(step: TutorialStep, state: GameState, humanId: string): number | undefined {
  const since = state.tutorialStepSince ?? 0
  if (!TUTORIAL_SKIP_CLOCK_ON_FIRST_ORDER.has(step.id)) return since
  if (step.id !== 'ice') return state.tutorialFirstOrderCycle
  // The drill whose skip ENDS the game restarts its clock on every order: an
  // order resolved on the step's opening cycle belonged to the step before.
  const last = state.players[humanId]?.lastActionCycle
  return last !== undefined && last > since ? last : undefined
}

/** Step the flow forward, stamping the tick so the next step gets a fresh deadline. */
function advanceTo(state: GameState, nextStep: number): GameState {
  const next = TUTORIAL_FLOW[nextStep]
  // Training units belong to the unit drills only — sweep them on the way out.
  const swept = next && isUnitDrill(next.id) ? state : clearTrainingUnits(state)
  const { tutorialFirstOrderCycle: _spent, ...rest } = swept
  return { ...rest, tutorialStep: nextStep, tutorialStepSince: state.cycle }
}
