import { GLYPH_COOLDOWN_TICKS, SURRENDER_MIN_TICK } from '~~/shared/constants/balance'
import { pickDenyTargetString } from '~/composables/useCommands'
import type { PlayerState, CreepState, RuneState, TeamState, TeamId } from '~~/shared/types/game'

export interface SituationalAction {
  cmd: string
  label: string
  aria: string
}

/** The slice of game state that decides which contextual actions are offerable. */
export interface SituationalContext {
  player: PlayerState | null
  isAlive: boolean
  creeps: CreepState[]
  aegis: { zone: string; holderId: string | null } | null
  runes: RuneState[]
  teams: Record<TeamId, TeamState> | null
  tick: number
}

/**
 * Which situational commands (ward / deny / aegis / rune / glyph / surrender) a
 * living player can take right now, given their items, zone and the world state.
 * Pure — extracted from GameScreen so the availability rules are unit-tested
 * independently of the in-game component. Returns [] when dead or no player.
 */
export function computeSituationalActions(ctx: SituationalContext): SituationalAction[] {
  const p = ctx.player
  if (!p || !ctx.isAlive) return []
  const out: SituationalAction[] = []

  if (p.items.some((i) => i === 'observer_ward' || i === 'sentry_ward')) {
    out.push({ cmd: 'ward', label: 'WARD', aria: `Place a ward in ${p.zone}` })
  }
  if (!('error' in pickDenyTargetString(p, ctx.creeps))) {
    out.push({ cmd: 'deny', label: 'DENY', aria: 'Deny a low-HP allied creep' })
  }
  if (ctx.aegis && ctx.aegis.zone === p.zone && !ctx.aegis.holderId) {
    out.push({ cmd: 'aegis', label: 'AEGIS', aria: 'Pick up the Aegis of the Immortal' })
  }
  if (ctx.runes.some((r) => r.zone === p.zone)) {
    out.push({ cmd: 'rune', label: 'RUNE', aria: 'Grab the rune in your zone' })
  }
  const teamState = ctx.teams?.[p.team] ?? null
  const glyphReady =
    !teamState ||
    teamState.glyphUsedTick == null ||
    ctx.tick - teamState.glyphUsedTick >= GLYPH_COOLDOWN_TICKS
  if (glyphReady) {
    out.push({ cmd: 'glyph', label: 'GLYPH', aria: 'Activate team glyph (fortify structures)' })
  }
  if (ctx.tick >= SURRENDER_MIN_TICK) {
    out.push({ cmd: 'surrender', label: 'SURRENDER', aria: 'Vote to surrender the match' })
  }
  return out
}
