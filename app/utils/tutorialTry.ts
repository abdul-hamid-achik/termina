import {
  TUTORIAL_FIRST_MOVE_ZONE,
  TUTORIAL_FLOW,
  tutorialHint,
  tutorialTryCommand,
  withIceDrillZone,
} from '~~/shared/constants/tutorial'
import { BURN_HP_THRESHOLD } from '~~/shared/constants/balance'
import { ZONE_MAP } from '~~/shared/constants/zones'
import { pathDistance } from '~~/shared/pathfinding'
import type { IceState, PlayerState, TeamId, WaveUnitState } from '~~/shared/types/game'
import { pickDenyTargetString, waveFullHp } from '~/composables/useCommands'
import { stripTargetString } from '~/utils/situationalActions'

/** What the player has right now — enough to tell a done sub-step from a live one. */
export interface TutorialTryContext {
  /** The zone the hero stands in. */
  zone?: string
  /** Inventory (nulls are empty slots). */
  items?: readonly (string | null)[]
  /** Standing in a base or anchor — the shop works from either. */
  inShopZone?: boolean
  /** The ICE the drill should name right now (liveIceDrillZone) — the static
   *  drill ICE may already be down. */
  iceDrillZone?: string
  /** The hero's crew and the visible waves: a `wave:N` chip names a unit that
   *  is really there (and the right index), or the walk to one. Without them
   *  the chip keeps the step's static command. */
  team?: TeamId
  waves?: readonly WaveUnitState[]
  /** Live ICE: a walk chip never leads into a zone a live enemy ICE covers.
   *  Without it every enemy ICE zone counts as covered. */
  ice?: readonly IceState[]
}

/**
 * The `try:` chip for the current drill, judged against the live state.
 *
 * A step's hint can name several commands in order — "walk home (`move
 * rookery-terminal`) and `buy edge_kit`", "`buy camtap`, then `tap <zone>`".
 * The static chip offered the first one forever, so it said "try: move
 * rookery-terminal" to a player standing in rookery-terminal and "try: buy
 * camtap" to one holding a camtap (playtest2 #4). This offers the first command
 * the player has NOT already satisfied, with `<zone>` filled in.
 */
export function liveTutorialTryCommand(step: number, ctx: TutorialTryContext): string | null {
  const cmd = stepCommand(step, ctx)
  return cmd ? liveWaveCommand(cmd, ctx) : cmd
}

/**
 * A `attack|burn wave:N` chip judged against the units actually in the zone.
 * The static `attack wave:0` was offered with no wave in the zone and the
 * server rejected it (playtest 3). Offers the index of a unit the order is
 * legal on right now (strip: an enemy unit, in the window first; burn: one of
 * YOUR units at or under the burn window); with none here, the walk to the
 * nearest SAFE zone that has one (never the crossing, never under a live enemy
 * ICE — a level-1 learner was offered `move coldstore-t1-audit`, round-4
 * review); with none there, the walk out to the lane — or no chip at all once
 * on it (the wave comes to them). Any other command passes through.
 */
function liveWaveCommand(cmd: string, ctx: TutorialTryContext): string | null {
  const m = /^(attack|burn) wave:\d+$/.exec(cmd)
  if (!m || ctx.waves === undefined || ctx.zone === undefined || ctx.team === undefined) return cmd
  const verb = m[1] as 'attack' | 'burn'
  const zone = ctx.zone
  const me = { zone, team: ctx.team } as PlayerState
  const waves = ctx.waves as WaveUnitState[]
  const here =
    verb === 'attack' ? stripTargetString(me, waves) : targetOf(pickDenyTargetString(me, waves))
  if (here) return `${verb} ${here}`

  const fits = (w: WaveUnitState) =>
    w.integ > 0 &&
    (verb === 'attack'
      ? w.team !== ctx.team
      : w.team === ctx.team && w.integ <= waveFullHp(w) * BURN_HP_THRESHOLD)
  let best: { zone: string; d: number } | null = null
  for (const w of waves) {
    if (w.zone === zone || !fits(w) || !safeForLearner(w.zone, ctx.team, ctx.ice)) continue
    const d = pathDistance(zone, w.zone)
    if (d >= 0 && (best === null || d < best.d)) best = { zone: w.zone, d }
  }
  if (best) return `move ${best.zone}`
  // Nothing in sight: the lane is where units walk — home ground walks out.
  const type = ZONE_MAP[zone]?.type
  const home = type === 'base' || type === 'anchor'
  return home && zone !== TUTORIAL_FIRST_MOVE_ZONE ? `move ${TUTORIAL_FIRST_MOVE_ZONE}` : null
}

/** A zone a learner may be walked into: not contested ground (the crossing),
 *  not the enemy's home, and not under a live enemy ICE (ICE unknown: every
 *  enemy ICE zone counts as covered). */
function safeForLearner(zone: string, team: TeamId, ice?: readonly IceState[]): boolean {
  const z = ZONE_MAP[zone]
  if (!z || z.type === 'cross') return false
  if (z.team === team || z.team === 'neutral') return true
  if (z.type === 'base' || z.type === 'anchor') return false
  if (!z.ice) return true
  if (!ice || ice.length === 0) return false
  return !ice.some((t) => t.zone === zone && t.alive && t.team !== team)
}

function targetOf(r: { target: string } | { error: string }): string | null {
  return 'target' in r ? r.target : null
}

/** The step's command, judged against zone/items/ICE (not yet the waves). */
function stepCommand(step: number, ctx: TutorialTryContext): string | null {
  const raw = tutorialTryCommand(step)
  if (!raw) return null
  const base = ctx.iceDrillZone ? withIceDrillZone(raw, ctx.iceDrillZone) : raw
  // An explicit drill command is the drill itself (strip/burn/cast) — keep it.
  if (TUTORIAL_FLOW[step]?.tryCommand) return base
  const hint = ctx.iceDrillZone
    ? withIceDrillZone(tutorialHint(step) ?? '', ctx.iceDrillZone)
    : (tutorialHint(step) ?? '')
  const commands = [...hint.matchAll(/`([^`]+)`/g)].map((m) => m[1]!)
  if (ctx.zone === undefined || commands.length === 0) return base

  const zone = ctx.zone
  const items = ctx.items ?? []
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i]!.replace('<zone>', zone)
    const [verb, arg] = cmd.split(/\s+/)
    if (verb === 'move' && arg) {
      if (arg === zone) continue
      // The walk home is only there to reach a shop — already in one, skip it.
      if (ctx.inShopZone && commands.slice(i + 1).some((c) => c.startsWith('buy '))) continue
    }
    if (verb === 'buy' && arg && items.includes(arg)) continue
    // `attack ice:<zone>` needs no walk first: from range the server walks the
    // order there and swings on arrival (ActionResolver.approachStructure).
    if (cmd.includes('<')) return base
    return cmd
  }
  return base
}

/**
 * The drill id a server skip notice stands for, or null. A step that times out
 * is advanced with "🎓 Moving on — <skipNote>" (server modes/tutorial.ts) and
 * counted as a skip — the only sign of it the client receives, so the
 * graduation screen reads skipped drills off these notices.
 */
export function skippedDrillFromNotice(message: string): string | null {
  const step = TUTORIAL_FLOW.find((s) => message === `🎓 Moving on — ${s.skipNote}`)
  return step?.id ?? null
}
