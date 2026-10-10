import {
  APPROACH_HOLD_DAMAGE_RATIO,
  ICE_ATTACK,
  LETHAL_PRESSURE_CYCLES,
  SILT_DWELLERS,
  TENANT_ATTACK,
  waveUnitAttack,
  type SiltDwellerType,
} from '~~/shared/constants/balance'
import { HEROES } from '~~/shared/constants/heroes'
import { isTrainingWave } from '~~/shared/constants/tutorial'
import { OBJECTIVE_LABELS } from '~~/shared/constants/world'
import type {
  FoggedPlayer,
  IceState,
  PlayerState,
  SiltDwellerState,
  TenantState,
  WaveUnitState,
} from '~~/shared/types/game'
import type { DamageType } from '~~/shared/types/hero'
import {
  applyIncomingHit,
  calculateCodeDamage,
  calculateKineticDamage,
  getIncomingDamageMultiplier,
  isDamageImmune,
} from './damageCalc'
import {
  getAttackMultiplier,
  getEffectiveAttack,
  getEffectiveIce,
  getEffectivePlate,
} from './effectiveStats'

/**
 * THE damage prediction: what one cycle standing in `zone` throws at a hero.
 * One implementation, two readers — the server's safe-by-default walk hold
 * (ActionResolver.approachHold) and the client's danger preview
 * (app/utils/dangerPreview) — so the warning a player reads and the hold the
 * engine applies can never disagree on a number.
 *
 * Both feed it ONLY what that player can see: the client its fog-filtered
 * cycle_state, the server the walker's filterStateForPlayer view. A zone the
 * player has no vision on contributes only what is public about it (its ICE,
 * THE TENANT in the Hollow) — never a guessed or leaked stack.
 *
 * Targeting mirrors the engine, not a raw sum (else every lane fight warns):
 * - a wave unit shoots enemy WAVES first (WaveAI priority 1): while a living
 *   unit of the hero's crew stands in the zone, theirs are busy with it;
 * - an ICE shoots a hero who struck an allied hero or the ICE itself first
 *   (IceAI priority 1), then enemy waves, then any hero present — so it is on
 *   the hero when `drawsIceAggro` OR nothing of the hero's crew can tank it;
 * - a Silt dweller swings at any hero in its camp (NeutralAI) — no escort;
 * - THE TENANT hits a hero in the Hollow every cycle (TenantAI);
 * - a visible enemy hero swings its effective basic attack (no crit roll).
 * Every hostile is assumed to pick THIS hero (worst case). Inert tutorial
 * training units are skipped.
 *
 * NPC hits run through applyIncomingHit — the engine's own mitigation chain
 * (effective plate with growth + items + talents + buffs, Kernel hardened, vuln
 * amps, an Echo phase-shift dodge, shields) — on a copy whose INTEG cannot run
 * out, so the number is the full incoming, not capped at what is left. Pure and
 * RNG-free: a replay predicts the same number.
 */

/** What the predictor reads — a vision-filtered state. */
export interface HopView {
  /** The cycle the hits LAND in (wave escalation is read at it). The server
   *  passes the cycle being resolved; the client, the one on screen + 1. */
  cycle: number
  waves: readonly WaveUnitState[]
  neutrals?: readonly SiltDwellerState[]
  ice: readonly IceState[]
  tenant?: TenantState | null
  players: Readonly<Record<string, PlayerState | FoggedPlayer>>
}

export interface HopDamage {
  /** Predicted INTEG loss, after the hero's own mitigation chain. */
  damage: number
  /** Enemy wave units that would shoot the hero. */
  units: number
  /** Whether an enemy ICE there would shoot the hero. */
  ice: boolean
  /** Visible enemy heroes there. */
  heroes: number
  /** Visible Silt dwellers there. */
  neutrals: number
  /** Whether THE TENANT would hit the hero. */
  tenant: boolean
}

const TENANT_ZONE = 'hollow'

/** One basic attack from `attacker` on `target` as the attack phase lands it,
 *  minus the dice (crit, Bulwark block, Arc Coil): effective attack ×
 *  multiplier, mitigated by plate (kinetic) or ice (code), vuln-amped, zero
 *  into immunity. */
function heroBasicAttackOn(attacker: PlayerState, target: PlayerState): number {
  const type: DamageType =
    (attacker.heroId ? HEROES[attacker.heroId]?.attackType : undefined) ?? 'kinetic'
  if (isDamageImmune(target, type)) return 0
  const raw = Math.round(getEffectiveAttack(attacker) * getAttackMultiplier(attacker))
  const mitigated =
    type === 'code'
      ? calculateCodeDamage(raw, getEffectiveIce(target))
      : calculateKineticDamage(raw, getEffectivePlate(target))
  return Math.max(0, Math.round(mitigated * getIncomingDamageMultiplier(target, type)))
}

function isFogged(p: PlayerState | FoggedPlayer): p is FoggedPlayer {
  return 'fogged' in p && p.fogged === true
}

/** INTEG one cycle in `zone` takes off `me`, judged from `view`. */
export function predictHopDamage(
  view: HopView,
  me: PlayerState,
  zone: string,
  drawsIceAggro: boolean,
): HopDamage {
  const live = view.waves.filter((w) => w.zone === zone && w.integ > 0 && !isTrainingWave(w))
  const escorted = live.some((w) => w.team === me.team)
  const hostile = escorted ? [] : live.filter((w) => w.team !== me.team)
  const enemyIce = view.ice.some((t) => t.zone === zone && t.alive && t.team !== me.team)
  const iceOn = enemyIce && (drawsIceAggro || !escorted)
  const dwellers = (view.neutrals ?? []).filter(
    (n) => n.zone === zone && n.alive && n.type in SILT_DWELLERS,
  )
  const tenantOn = zone === TENANT_ZONE && view.tenant?.alive === true

  const hits = hostile.map((w) => waveUnitAttack(w.type, view.cycle))
  if (iceOn) hits.push(ICE_ATTACK)
  for (const n of dwellers) hits.push(SILT_DWELLERS[n.type as SiltDwellerType].attack)
  if (tenantOn) hits.push(TENANT_ATTACK)

  const UNBOUNDED = Number.MAX_SAFE_INTEGER / 4
  let target: PlayerState = { ...me, integ: UNBOUNDED, alive: true }
  let damage = 0
  for (const raw of hits) {
    const after = applyIncomingHit(target, raw, 'kinetic')
    damage += target.integ - after.integ
    target = after
  }

  let heroes = 0
  for (const e of Object.values(view.players)) {
    if (isFogged(e) || e.id === me.id || e.team === me.team || !e.alive || e.zone !== zone) {
      continue
    }
    heroes++
    damage += heroBasicAttackOn(e, me)
  }

  return {
    damage,
    units: hostile.length,
    ice: iceOn,
    heroes,
    neutrals: dwellers.length,
    tenant: tenantOn,
  }
}

/** "4 enemy units + ICE + 2 enemy heroes + 3 camp units + THE TENANT". */
export function describeHopSources(h: HopDamage): string {
  const parts: string[] = []
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`
  if (h.units > 0) parts.push(n(h.units, 'enemy unit', 'enemy units'))
  if (h.ice) parts.push('ICE')
  if (h.heroes > 0) parts.push(n(h.heroes, 'enemy hero', 'enemy heroes'))
  if (h.neutrals > 0) parts.push(n(h.neutrals, 'camp unit', 'camp units'))
  if (h.tenant) parts.push(OBJECTIVE_LABELS.tenant)
  return parts.join(' + ')
}

// ── Policy: the two readers' thresholds, side by side ────────────────

/** Client warning (⚠): at this rate you are dead within
 *  LETHAL_PRESSURE_CYCLES cycles — the threat line's own burst rule. */
export function warnsOfDanger(predicted: number, integ: number): boolean {
  return predicted > 0 && predicted * LETHAL_PRESSURE_CYCLES >= integ
}

/** Server walk hold: the next hop costs at least APPROACH_HOLD_DAMAGE_RATIO of
 *  the walker's CURRENT INTEG. Stricter than the warning on purpose — the warn
 *  only informs, the hold takes the walk away. */
export function holdsWalk(predicted: number, integ: number): boolean {
  return predicted > 0 && predicted >= integ * APPROACH_HOLD_DAMAGE_RATIO
}
