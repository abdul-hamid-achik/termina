import { HARDEN_COOLDOWN_TICKS, SURRENDER_MIN_TICK } from '~~/shared/constants/balance'
import { pickDenyTargetString } from '~/composables/useCommands'
import type {
  PlayerState,
  CreepState,
  CacheState,
  TeamState,
  TeamId,
  GameMode,
} from '~~/shared/types/game'

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
  backup: { zone: string; holderId: string | null } | null
  caches: CacheState[]
  teams: Record<TeamId, TeamState> | null
  tick: number
  /** Game mode — the tutorial is exempt from the surrender tick gate. */
  mode?: GameMode
}

/**
 * Which situational commands (ward / burn / backup / cache / harden / surrender) a
 * living player can take right now, given their items, zone and the world state.
 * Pure — extracted from GameScreen so the availability rules are unit-tested
 * independently of the in-game component. Returns [] when dead or no player.
 */
export function computeSituationalActions(ctx: SituationalContext): SituationalAction[] {
  const p = ctx.player
  if (!p || !ctx.isAlive) return []
  const out: SituationalAction[] = []

  if (p.items.some((i) => i === 'camtap' || i === 'sniffer')) {
    out.push({ cmd: 'ward', label: 'WARD', aria: `Place a ward in ${p.zone}` })
  }
  if (!('error' in pickDenyTargetString(p, ctx.creeps))) {
    out.push({ cmd: 'burn', label: 'BURN', aria: 'Burn a low-HP allied creep' })
  }
  if (ctx.backup && ctx.backup.zone === p.zone && !ctx.backup.holderId) {
    out.push({ cmd: 'backup', label: 'BACKUP', aria: 'Pick up the Backup of the Immortal' })
  }
  if (ctx.caches.some((r) => r.zone === p.zone)) {
    out.push({ cmd: 'cache', label: 'CACHE', aria: 'Grab the cache in your zone' })
  }
  const teamState = ctx.teams?.[p.team] ?? null
  const glyphReady =
    !teamState ||
    teamState.hardenUsedTick == null ||
    ctx.tick - teamState.hardenUsedTick >= HARDEN_COOLDOWN_TICKS
  if (glyphReady) {
    out.push({ cmd: 'harden', label: 'HARDEN', aria: 'Activate team harden (fortify structures)' })
  }
  // Mirrors SurrenderSystem.canSurrender: the tutorial has no tick gate, so a
  // learner always has a visible way out of a practice game.
  if (ctx.mode === 'tutorial' || ctx.tick >= SURRENDER_MIN_TICK) {
    out.push({
      cmd: 'surrender',
      label: ctx.mode === 'tutorial' ? 'END PRACTICE' : 'SURRENDER',
      aria: ctx.mode === 'tutorial' ? 'End this practice game' : 'Vote to surrender the match',
    })
  }
  return out
}
