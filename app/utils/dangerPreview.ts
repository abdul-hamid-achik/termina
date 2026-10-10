import { ZONE_MAP } from '~~/shared/constants/zones'
import { findPath } from '~~/shared/pathfinding'
import { structureZone } from '~~/shared/utils/structureRules'
import {
  describeHopSources,
  predictHopDamage,
  warnsOfDanger,
  type HopDamage,
} from '~~/shared/utils/hopDamage'
import type { Command } from '~~/shared/types/commands'
import type {
  FoggedPlayer,
  IceState,
  PlayerState,
  SiltDwellerState,
  TenantState,
  WaveUnitState,
} from '~~/shared/types/game'

/**
 * The danger preview: what a zone will throw at the local hero NEXT cycle,
 * judged from what the HUD can already see. The number is the SHARED
 * prediction (shared/utils/hopDamage — the very code the server's walk hold
 * runs), fed the HUD's own vision-filtered state, so the prompt preview, the
 * threat line, the move picker, the stream warning and the server's "Holding
 * at …" notice all read the same number (a live playtester walked into a
 * 12-unit stack at an enemy T2 — 550 → 10 in one cycle — with nothing on
 * screen saying so).
 *
 * It WARNS, it never blocks: the server-side walk hold is the block. This
 * module only adds the client's side of it — which zones an order puts you in,
 * the warning threshold, and the words.
 */

/** What the preview reads — the store's vision-filtered state. */
export interface DangerState {
  me: PlayerState
  waves: readonly WaveUnitState[]
  neutrals?: readonly SiltDwellerState[]
  ice: readonly IceState[]
  tenant?: TenantState | null
  players: Readonly<Record<string, PlayerState | FoggedPlayer>>
  /** The cycle on screen. A fresh order resolves in the NEXT one. */
  cycle: number
  /** This game's map (subset maps prune the graph), as findPath reads it. */
  hasZone?: (id: string) => boolean
}

export interface ZoneIncoming extends Omit<HopDamage, 'damage'> {
  zone: string
  /** Total predicted INTEG loss next cycle, after the hero's mitigation. */
  total: number
}

/**
 * INTEG `zone` takes off the local hero next cycle. `drawsIceAggro`: the order
 * strikes that ICE or an enemy hero in its zone (IceAI priority 1).
 */
export function predictIncoming(
  zone: string,
  s: DangerState,
  opts: { drawsIceAggro?: boolean } = {},
): ZoneIncoming {
  const { damage, ...rest } = predictHopDamage(
    {
      cycle: s.cycle + 1,
      waves: s.waves,
      neutrals: s.neutrals,
      ice: s.ice,
      tenant: s.tenant,
      players: s.players,
    },
    s.me,
    zone,
    opts.drawsIceAggro === true,
  )
  return { zone, total: damage, ...rest }
}

/** Large relative to INTEG: the client's warning threshold (hopDamage's
 *  warnsOfDanger — the policy lives beside the server's hold threshold). */
export function isDangerous(predicted: number, integ: number): boolean {
  return warnsOfDanger(predicted, integ)
}

/** One cycle of it finishes you. */
export function isLethal(predicted: number, integ: number): boolean {
  return predicted > 0 && predicted >= integ
}

function zoneLabel(zone: string): string {
  return ZONE_MAP[zone]?.name ?? zone
}

/** "⚠ Coldstore T2 (AUDIT): 12 enemy units (~540/cycle) — you have 550". */
export function formatDangerWarning(z: ZoneIncoming, integ: number): string {
  const lethal = isLethal(z.total, integ) ? ' — lethal' : ''
  return `⚠ ${zoneLabel(z.zone)}: ${describeHopSources({ ...z, damage: z.total })} (~${z.total}/cycle) — you have ${integ}${lethal}`
}

export interface CommandDanger {
  incoming: ZoneIncoming
  text: string
}

/** The zones an order puts the hero in next, with whether each draws ICE aggro. */
function zonesFor(command: Command, s: DangerState): { zone: string; aggro: boolean }[] {
  const { me } = s
  const walk = (to: string, aggroAtEnd: boolean) =>
    findPath(me.zone, to, s.hasZone)
      .slice(1)
      .map((zone) => ({ zone, aggro: aggroAtEnd && zone === to }))

  if (command.type === 'move') return walk(command.zone, false)
  if (command.type === 'burn') return [{ zone: me.zone, aggro: false }]
  if (command.type !== 'attack') return []
  const t = command.target
  if (t.kind === 'ice' || t.kind === 'terminal') {
    const at = structureZone(me.team, t)
    const aggro = t.kind === 'ice'
    if (at && at !== me.zone) return walk(at, aggro)
    return [{ zone: me.zone, aggro }]
  }
  // A hero struck in an ICE's zone draws that ICE (IceAI priority 1).
  if (t.kind === 'hero') return [{ zone: me.zone, aggro: true }]
  if (t.kind === 'wave' || t.kind === 'neutral' || t.kind === 'tenant' || t.kind === 'zone') {
    return [{ zone: me.zone, aggro: false }]
  }
  return []
}

/**
 * The warning for an order that takes the hero INTO, or keeps it IN, a zone
 * whose predicted fire is large against current INTEG — the first such zone
 * along the way. Null when the order is safe as far as the HUD can see.
 */
export function commandDanger(command: Command, s: DangerState): CommandDanger | null {
  if (!s.me.alive || s.me.integ <= 0) return null
  for (const { zone, aggro } of zonesFor(command, s)) {
    const incoming = predictIncoming(zone, s, { drawsIceAggro: aggro })
    if (isDangerous(incoming.total, s.me.integ)) {
      return { incoming, text: formatDangerWarning(incoming, s.me.integ) }
    }
  }
  return null
}
