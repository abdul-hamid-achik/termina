import { isNpcSourceId, npcKind } from './combatLog'

// Shared tactical derivations for the current zone — used by the rig line and StatusLines
// (the detailed unit list) and the rig line in the stream so the
// threat verdict can never drift between the two surfaces.

export type ThreatTone = 'safe' | 'warn' | 'danger'
export type ThreatLabel = 'CLEAR' | 'ICE' | 'DANGER' | 'CONTESTED' | 'FAVORED' | 'DOWN'

export interface ZoneThreat {
  label: ThreatLabel
  tone: ThreatTone
}

/** At or under this INTEG fraction the player is "low": no fight is favored. */
const LOW_INTEG_FRACTION = 0.35
/** A fight is only FAVORED for a hero above this INTEG fraction. */
const FAVORED_MIN_FRACTION = 0.5
/** Cycles of last cycle's incoming damage that would finish you — at or under
 *  this many, you are being burst down whatever the headcount says. */
const LETHAL_PRESSURE_CYCLES = 3
/** Wave / ICE fire is "sustained" — and the fight is no longer yours — once a
 *  single cycle of it costs this fraction of max INTEG... */
const SUSTAINED_NPC_FRACTION = 0.15
/** ...or once, repeated, it would finish you within this many cycles. */
const SUSTAINED_NPC_CYCLES = 4
/** The honest line for a hero being ground down by waves / ICE (playtest2 32.png
 *  read "You have the advantage — press it" under "Waves hit You ×4 for 118"). */
const WAVE_PRESSURE_ACTION = 'Waves are chewing you — step back or clear them'
/** The same, when the fire is the enemy ICE in your zone. */
const ICE_PRESSURE_ACTION = 'Their ICE is chewing you — step back out of its zone'
/** At an EQUAL headcount the stronger side is only FAVORED by this INTEG ratio —
 *  a full-INTEG hero against one enemy at 8% INTEG is not an "even fight". */
const EQUAL_FIGHT_MARGIN = 1.5

/**
 * What the player's own state adds to the zone verdict. Every field is
 * optional so the headcount-only call (and its tests) keeps working, but the
 * live HUD passes all of it: a headcount advantage at 24% INTEG with two
 * enemies on you is not an advantage, and the banner used to say it was.
 */
export interface ThreatContext {
  /** False = the local hero is down. The verdict is DOWN, never FAVORED. */
  alive?: boolean
  /** Current INTEG as a fraction of max (0..1). */
  hpFraction?: number
  /** Current INTEG (absolute) — paired with incomingLastCycle. */
  integ?: number
  /** INTEG the local hero lost in the last resolved cycle. */
  incomingLastCycle?: number
  /** The part of incomingLastCycle dealt by waves, ICE, the Silt, the Tenant. */
  npcIncomingLastCycle?: number
  /** Max INTEG — what the sustained-NPC-fire fraction is measured against. */
  maxInteg?: number
  /** Summed current INTEG of allied heroes in the zone, self included. */
  allyPower?: number
  /** Summed current INTEG of the visible enemy heroes in the zone. */
  enemyPower?: number
}

/** True when last cycle's incoming damage, repeated, finishes you within
 *  LETHAL_PRESSURE_CYCLES cycles. */
function underLethalPressure(ctx: ThreatContext): boolean {
  const incoming = ctx.incomingLastCycle ?? 0
  if (incoming <= 0 || ctx.integ === undefined) return false
  return incoming * LETHAL_PRESSURE_CYCLES >= ctx.integ
}

/** True when last cycle's wave / ICE fire is heavy enough that no fight in
 *  this zone is "favored": ≥ SUSTAINED_NPC_FRACTION of max INTEG, or a
 *  time-to-death at that rate of ≤ SUSTAINED_NPC_CYCLES. */
function underSustainedNpcFire(ctx: {
  npcIncomingLastCycle?: number
  integ?: number
  maxInteg?: number
}): boolean {
  const npc = ctx.npcIncomingLastCycle ?? 0
  if (npc <= 0) return false
  if (
    ctx.maxInteg !== undefined &&
    ctx.maxInteg > 0 &&
    npc >= ctx.maxInteg * SUSTAINED_NPC_FRACTION
  )
    return true
  return ctx.integ !== undefined && ctx.integ <= npc * SUSTAINED_NPC_CYCLES
}

/**
 * Color-coded threat verdict for the player's current zone.
 * @param enemyCount    enemy heroes present in the zone
 * @param allyHeadcount allied heroes present INCLUDING the local player
 * @param enemyIcePresent an alive enemy ice is in the zone
 * @param ctx           the local hero's own state (INTEG, incoming, power)
 */
export function computeThreat(
  enemyCount: number,
  allyHeadcount: number,
  enemyIcePresent: boolean,
  ctx: ThreatContext = {},
): ZoneThreat {
  if (ctx.alive === false) return { label: 'DOWN', tone: 'danger' }
  const low = ctx.hpFraction !== undefined && ctx.hpFraction <= LOW_INTEG_FRACTION
  const pressured = low || underLethalPressure(ctx)
  // Waves / ICE grinding you down caps the verdict at CONTESTED: neither CLEAR
  // nor FAVORED is true of a hero losing a sixth of their INTEG a cycle.
  const ground = underSustainedNpcFire(ctx)
  if (enemyCount === 0) {
    // No enemy HEROES is not safety: a low hero under ICE fire, or one a wave /
    // the Tenant is bursting down, is in danger whatever the hero headcount says.
    if (pressured && (enemyIcePresent || (ctx.incomingLastCycle ?? 0) > 0)) {
      return { label: 'DANGER', tone: 'danger' }
    }
    if (enemyIcePresent) return { label: 'ICE', tone: 'warn' }
    if (ground) return { label: 'CONTESTED', tone: 'warn' }
    return { label: 'CLEAR', tone: 'safe' }
  }
  if (enemyCount > allyHeadcount || pressured) {
    return { label: 'DANGER', tone: 'danger' }
  }
  // More bodies is not an advantage on its own: the side with more INTEG
  // standing in the zone, and a hero healthy enough to commit, are.
  const healthy = ctx.hpFraction === undefined || ctx.hpFraction > FAVORED_MIN_FRACTION
  if (enemyCount === allyHeadcount) {
    // Equal headcount is CONTESTED unless INTEG says otherwise — and only when
    // both sides' INTEG is actually known, by a clear margin.
    const dominant =
      ctx.allyPower !== undefined &&
      ctx.enemyPower !== undefined &&
      ctx.allyPower >= ctx.enemyPower * EQUAL_FIGHT_MARGIN
    if (healthy && dominant && !ground) return { label: 'FAVORED', tone: 'safe' }
    return { label: 'CONTESTED', tone: 'warn' }
  }
  const outweighs =
    ctx.allyPower === undefined || ctx.enemyPower === undefined || ctx.allyPower > ctx.enemyPower
  if (healthy && outweighs && !ground) return { label: 'FAVORED', tone: 'safe' }
  return { label: 'CONTESTED', tone: 'warn' }
}

/** Tailwind text-color class for a threat tone. */
export function threatToneClass(tone: ThreatTone): string {
  switch (tone) {
    case 'danger':
      return 'text-audit'
    case 'warn':
      return 'text-gold'
    default:
      return 'text-chaff'
  }
}

export interface RecommendationContext {
  alive: boolean
  /** Current INTEG as a fraction of max (0..1). */
  hpFraction: number
  threat: ZoneThreat
  /** At least one ability is off cooldown. */
  hasReadyAbility: boolean
  /** False before the first cycle_state — do not call that "dead". */
  hasHero?: boolean
  /** Current INTEG (absolute) — with incomingLastCycle, detects a burst. */
  integ?: number
  /** INTEG lost in the last resolved cycle. */
  incomingLastCycle?: number
  /** The wave / ICE / Silt / Tenant share of incomingLastCycle. */
  npcIncomingLastCycle?: number
  /** Max INTEG (for the sustained-NPC-fire fraction). */
  maxInteg?: number
  /** The enemy-ICE share of npcIncomingLastCycle — names the fire. */
  iceIncomingLastCycle?: number
  /** An alive enemy ICE stands in the zone — the fallback when the ICE share
   *  is not known. */
  enemyIcePresent?: boolean
}

/** Is the sustained NPC fire mostly the enemy ICE? Judged from the damage
 *  itself when it is known (an ICE can be shooting your escort while waves
 *  chew you), else from whether one stands in the zone — never from the
 *  verdict label, which reads CONTESTED the moment an enemy hero is present. */
function iceIsTheFire(ctx: RecommendationContext): boolean {
  if (ctx.iceIncomingLastCycle !== undefined) {
    return ctx.iceIncomingLastCycle * 2 >= (ctx.npcIncomingLastCycle ?? 0)
  }
  return ctx.enemyIcePresent ?? ctx.threat.label === 'ICE'
}

/**
 * A single "what do I do now" line for the focus banner. Priority order:
 * dead → low INTEG → the zone's threat verdict. Kept deliberately short so it
 * reads at a glance on a 4-second tick.
 */
export function recommendAction(ctx: RecommendationContext): string {
  if (ctx.hasHero === false) return 'Waiting for the first cycle'
  if (!ctx.alive) return 'Dead — wait for respawn or buy back'
  if (ctx.hpFraction <= LOW_INTEG_FRACTION) return 'Low INTEG — retreat and heal'
  // Healthy-looking but melting: the bar lags the burst by a cycle.
  if (underLethalPressure(ctx)) return 'Under heavy fire — retreat now'
  // The verdict above is only as honest as its reason: a hero the waves are
  // grinding down is told so, not "press it" / "farm" / "even fight".
  if (ctx.threat.label !== 'DANGER' && underSustainedNpcFire(ctx)) {
    return iceIsTheFire(ctx) ? ICE_PRESSURE_ACTION : WAVE_PRESSURE_ACTION
  }
  switch (ctx.threat.label) {
    case 'DANGER':
      return 'Outnumbered — retreat to safety'
    case 'CONTESTED':
      return ctx.hasReadyAbility
        ? 'Even fight — an ability can swing it'
        : 'Even fight — play it safe'
    case 'FAVORED':
      return 'You have the advantage — press it'
    case 'ICE':
      return 'Enemy ice here — bring waves before diving'
    case 'CLEAR':
    default:
      return 'Clear — farm, push, or rotate'
  }
}

/** The minimal event shape the incoming-damage sum reads. */
interface DamageEventLike {
  type: string
  cycle: number
  payload: Record<string, unknown>
}

/**
 * INTEG the local hero lost in the most recent resolved cycle — the newest
 * event cycle no older than one cycle behind `currentCycle`. Zero when nothing
 * that recent resolved (a quiet cycle must not keep reporting an old burst).
 */
export function incomingDamageLastCycle(
  events: readonly DamageEventLike[],
  playerId: string | null,
  currentCycle: number,
): number {
  return incomingDamageBreakdownLastCycle(events, playerId, currentCycle).total
}

/**
 * incomingDamageLastCycle, split: `total` is every hit on me, `npc` the part
 * dealt by waves, ICE, the Silt, the Tenant or a Terminal (isNpcSourceId) —
 * the fire that vetoes FAVORED without any enemy hero being involved — and
 * `ice` the ICE part of `npc` (what the pressure line names).
 */
export function incomingDamageBreakdownLastCycle(
  events: readonly DamageEventLike[],
  playerId: string | null,
  currentCycle: number,
): { total: number; npc: number; ice: number } {
  if (!playerId) return { total: 0, npc: 0, ice: 0 }
  let latest = -Infinity
  for (const e of events) {
    if (e.cycle <= currentCycle && e.cycle >= currentCycle - 1 && e.cycle > latest) {
      latest = e.cycle
    }
  }
  if (latest === -Infinity) return { total: 0, npc: 0, ice: 0 }
  // What I dealt this cycle, by (target, amount): Spite Plate returns 100% of the
  // INTEG its wearer lost as black damage, so a black hit on me that exactly
  // mirrors one of my own hits on that attacker is my reflect, not their attack.
  const dealt = new Map<string, number>()
  for (const e of events) {
    if (e.cycle !== latest || e.type !== 'damage' || e.payload.sourceId !== playerId) continue
    const key = `${String(e.payload.targetId)}:${Number(e.payload.amount)}`
    dealt.set(key, (dealt.get(key) ?? 0) + 1)
  }
  let sum = 0
  let npc = 0
  let ice = 0
  for (const e of events) {
    if (e.cycle !== latest || e.type !== 'damage' || e.payload.targetId !== playerId) continue
    // Self-inflicted INTEG loss (Malloc's Stack Overflow cost) is a cost, not fire.
    if (e.payload.sourceId === playerId) continue
    const amount = Number(e.payload.amount)
    if (!(amount > 0)) continue
    if (e.payload.damageType === 'black') {
      const key = `${String(e.payload.sourceId)}:${amount}`
      const mine = dealt.get(key) ?? 0
      if (mine > 0) {
        dealt.set(key, mine - 1)
        continue
      }
    }
    sum += amount
    if (isNpcSourceId(e.payload.sourceId)) npc += amount
    if (npcKind(String(e.payload.sourceId)) === 'ICE') ice += amount
  }
  return { total: sum, npc, ice }
}

/** The minimal hero shape the zone verdict reads. */
interface HeroLike {
  id: string
  zone?: string
  alive: boolean
  integ?: number
  maxInteg?: number
  team: string
}

export interface ZoneVerdict {
  threat: ZoneThreat
  action: string
  enemyCount: number
  allyHeadcount: number
}

/**
 * The ONE verdict both the rig line and the HUD hop line print — computed once
 * from the live roster so the two surfaces cannot disagree.
 */
export function zoneVerdict(input: {
  me: HeroLike & { integ: number; maxInteg: number }
  allies: readonly HeroLike[]
  enemies: readonly HeroLike[]
  enemyIcePresent: boolean
  incomingLastCycle: number
  /** The wave / ICE share of incomingLastCycle (incomingDamageBreakdownLastCycle). */
  npcIncomingLastCycle?: number
  /** The enemy-ICE share of npcIncomingLastCycle (same breakdown). */
  iceIncomingLastCycle?: number
  hasReadyAbility: boolean
}): ZoneVerdict {
  const { me } = input
  const here = (h: HeroLike) => h.zone === me.zone && h.alive
  const enemiesHere = input.enemies.filter(here)
  const alliesHere = input.allies.filter((a) => a.id !== me.id && here(a))
  // A dead hero is not a body in the fight — counting yourself while down is
  // how "Dead · FAVORED" used to happen.
  const allyHeadcount = alliesHere.length + (me.alive ? 1 : 0)
  const power = (hs: readonly HeroLike[]) => hs.reduce((s, h) => s + Math.max(0, h.integ ?? 0), 0)
  // maxInteg 0 = INTEG not known yet (pre-first-cycle / fogged): that is neither
  // "0% — low" nor a lethal burst, so leave the fraction and the absolute out.
  const integKnown = me.maxInteg > 0
  const hpFraction = integKnown ? me.integ / me.maxInteg : undefined
  const ctx: ThreatContext = {
    alive: me.alive,
    hpFraction,
    integ: integKnown ? me.integ : undefined,
    incomingLastCycle: input.incomingLastCycle,
    npcIncomingLastCycle: input.npcIncomingLastCycle,
    maxInteg: integKnown ? me.maxInteg : undefined,
    allyPower: power(alliesHere) + (me.alive ? Math.max(0, me.integ) : 0),
    enemyPower: power(enemiesHere),
  }
  const threat = computeThreat(enemiesHere.length, allyHeadcount, input.enemyIcePresent, ctx)
  const action = recommendAction({
    alive: me.alive,
    hpFraction: hpFraction ?? 1,
    threat,
    hasReadyAbility: input.hasReadyAbility,
    integ: integKnown ? me.integ : undefined,
    incomingLastCycle: input.incomingLastCycle,
    npcIncomingLastCycle: input.npcIncomingLastCycle,
    maxInteg: integKnown ? me.maxInteg : undefined,
    iceIncomingLastCycle: input.iceIncomingLastCycle,
    enemyIcePresent: input.enemyIcePresent,
  })
  return { threat, action, enemyCount: enemiesHere.length, allyHeadcount }
}
