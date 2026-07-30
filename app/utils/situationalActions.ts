import { HARDEN_COOLDOWN_TICKS, SURRENDER_MIN_TICK } from '~~/shared/constants/balance'
import { pickDenyTargetString } from '~/composables/useCommands'
import type {
  PlayerState,
  WaveUnitState,
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
  waves: WaveUnitState[]
  backup: { zone: string; holderId: string | null } | null
  caches: CacheState[]
  teams: Record<TeamId, TeamState> | null
  tick: number
  /** Game mode — the tutorial is exempt from the surrender tick gate. */
  mode?: GameMode
}

/**
 * The lowest-HP hostile wave in the player's zone as a `wave:<index>` string —
 * the STRIP action (attack the easiest last-hit). Mirrors the server's
 * waveInZoneByIndex ordering (position among ALL waves in the zone, corpses
 * included, so the index matches what `attack wave:<i>` resolves to).
 * Returns null when nothing hostile stands here.
 */
export function stripTargetString(player: PlayerState, waves: WaveUnitState[]): string | null {
  const inZone = waves.filter((c) => c.zone === player.zone)
  let best: { hp: number; index: number } | null = null
  for (let index = 0; index < inZone.length; index++) {
    const c = inZone[index]!
    if (c.team === player.team || c.hp <= 0) continue
    if (best === null || c.hp < best.hp) best = { hp: c.hp, index }
  }
  return best === null ? null : `wave:${best.index}`
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
  const strip = stripTargetString(p, ctx.waves)
  if (strip !== null) {
    out.push({ cmd: `attack ${strip}`, label: 'STRIP', aria: 'Attack the lowest-HP hostile wave' })
  }
  if (!('error' in pickDenyTargetString(p, ctx.waves))) {
    out.push({ cmd: 'burn', label: 'BURN', aria: 'Burn a low-HP allied wave' })
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
