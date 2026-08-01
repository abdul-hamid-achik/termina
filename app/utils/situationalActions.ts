import {
  HARDEN_COOLDOWN_CYCLES,
  SURRENDER_MIN_CYCLE,
  STRIP_HP_THRESHOLD,
} from '~~/shared/constants/balance'
import { pickDenyTargetString, waveFullHp } from '~/composables/useCommands'
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
  cycle: number
  /** Game mode — the tutorial is exempt from the surrender cycle gate. */
  mode?: GameMode
}

/**
 * The hostile wave in the player's zone worth swinging at, as a
 * `wave:<index>` string — the STRIP action. Mirrors the server's
 * waveInZoneByIndex ordering (position among ALL waves in the zone, corpses
 * included, so the index matches what `attack wave:<i>` resolves to).
 * Returns null when nothing hostile stands here.
 *
 * Units already inside the strip window come first, because those go down to
 * THIS swing whatever the hero's attack is worth. Lowest-absolute-INTEG is not
 * the same unit: types spawn with different INTEG and the window is a fraction
 * of what each one SPAWNED with, so the button used to aim at a unit the
 * player could not actually take.
 */
export function stripTargetString(player: PlayerState, waves: WaveUnitState[]): string | null {
  const inZone = waves.filter((c) => c.zone === player.zone)
  let best: { integ: number; index: number; ready: boolean } | null = null
  for (let index = 0; index < inZone.length; index++) {
    const c = inZone[index]!
    if (c.team === player.team || c.integ <= 0) continue
    const ready = c.integ <= waveFullHp(c) * STRIP_HP_THRESHOLD
    // A strippable unit always beats a non-strippable one, however low the
    // other is; between two of a kind, take the lower.
    if (best === null || (ready && !best.ready) || (ready === best.ready && c.integ < best.integ)) {
      best = { integ: c.integ, index, ready }
    }
  }
  return best === null ? null : `wave:${best.index}`
}

/** Whether any hostile wave here is inside the strip window right now. */
export function hasStrippableWave(player: PlayerState, waves: WaveUnitState[]): boolean {
  return waves.some(
    (c) =>
      c.zone === player.zone &&
      c.team !== player.team &&
      c.integ > 0 &&
      c.integ <= waveFullHp(c) * STRIP_HP_THRESHOLD,
  )
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
    out.push({ cmd: 'tap', label: 'TAP', aria: `Place a camtap in ${p.zone}` })
  }
  const strip = stripTargetString(p, ctx.waves)
  if (strip !== null) {
    // The label carries the one fact that decides the swing: whether this unit
    // is low enough to take outright, or whether the swing is just chip.
    const ready = hasStrippableWave(p, ctx.waves)
    out.push({
      cmd: `attack ${strip}`,
      label: ready ? 'STRIP' : 'HIT',
      aria: ready
        ? 'Take the payload off a wave unit that is low enough to strip'
        : 'Chip the weakest hostile wave — none are low enough to strip yet',
    })
  }
  if (!('error' in pickDenyTargetString(p, ctx.waves))) {
    out.push({ cmd: 'burn', label: 'BURN', aria: 'Burn a low-INTEG allied wave' })
  }
  if (ctx.backup && ctx.backup.zone === p.zone && !ctx.backup.holderId) {
    out.push({ cmd: 'backup', label: 'BACKUP', aria: 'Pick up the Backup of the Immortal' })
  }
  if (ctx.caches.some((r) => r.zone === p.zone)) {
    out.push({ cmd: 'grab', label: 'CACHE', aria: 'Grab the cache in your zone' })
  }
  const teamState = ctx.teams?.[p.team] ?? null
  const glyphReady =
    !teamState ||
    teamState.hardenUsedCycle == null ||
    ctx.cycle - teamState.hardenUsedCycle >= HARDEN_COOLDOWN_CYCLES
  if (glyphReady) {
    out.push({ cmd: 'harden', label: 'HARDEN', aria: 'Activate team harden (fortify structures)' })
  }
  // R4-11: flush own BREACH early (same verb, self-target).
  if (p.buffs?.some((b) => b.id === 'breached' && b.cyclesRemaining > 0)) {
    out.push({
      cmd: 'breach self',
      label: 'FLUSH',
      aria: 'Flush your BREACH early (costs this cycle and BW)',
    })
  }
  // Mirrors SurrenderSystem.canSurrender: the tutorial has no cycle gate, so a
  // learner always has a visible way out of a practice game.
  if (ctx.mode === 'tutorial' || ctx.cycle >= SURRENDER_MIN_CYCLE) {
    out.push({
      cmd: 'surrender',
      label: ctx.mode === 'tutorial' ? 'END PRACTICE' : 'SURRENDER',
      aria: ctx.mode === 'tutorial' ? 'End this practice game' : 'Vote to surrender the match',
    })
  }
  return out
}
