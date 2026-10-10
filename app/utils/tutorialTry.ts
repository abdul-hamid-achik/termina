import {
  TUTORIAL_FLOW,
  tutorialHint,
  tutorialTryCommand,
  withIceDrillZone,
} from '~~/shared/constants/tutorial'

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
