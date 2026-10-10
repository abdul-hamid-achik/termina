import { Effect, Data, type Exit } from 'effect'
import type { GameState, PlayerState, BuffState, GameEvent } from '~~/shared/types/game'
import type { TargetRef } from '~~/shared/types/commands'
import type { AbilityDef, DamageType } from '~~/shared/types/hero'
import { HEROES } from '~~/shared/constants/heroes'
import {
  absorbShield,
  applyIncomingHit,
  calculateEffectiveDamage,
  getIncomingDamageMultiplier,
  isBreached,
  isDamageImmune,
} from '~~/shared/utils/damageCalc'
import { getEffectivePlate, getEffectiveIce } from '~~/shared/utils/effectiveStats'
import { getTalentTree } from '~~/shared/constants/talents'
import { getAbilityLevel } from '~~/shared/constants/balance'
import { abilityBwTable, abilityTargetError } from '~~/shared/utils/ability'
import { ZONE_MAP } from '~~/shared/constants/zones'
import { isTrainingWave } from '~~/shared/constants/tutorial'
import type { GameEngineEvent } from '~~/server/game/protocol/events'

// The mitigation helpers live in shared/utils/damageCalc; hero modules keep
// reaching them through _base.
export { absorbShield, isBreached }

// ── Typed Errors ──────────────────────────────────────────────────
/* eslint-disable unicorn/throw-new-error */

export class InsufficientBwError extends Data.TaggedError('InsufficientBwError')<{
  readonly required: number
  readonly current: number
}> {}

export class CooldownError extends Data.TaggedError('CooldownError')<{
  readonly ability: string
  readonly cyclesRemaining: number
}> {}

export class InvalidTargetError extends Data.TaggedError('InvalidTargetError')<{
  readonly target: string
  readonly reason: string
}> {}
/* eslint-enable unicorn/throw-new-error */

export type AbilityError = InsufficientBwError | CooldownError | InvalidTargetError

// ── Types ─────────────────────────────────────────────────────────

export type AbilitySlot = 'q' | 'w' | 'e' | 'r'

export interface AbilityResult {
  state: GameState
  events: GameEvent[]
}

export interface CombatStats {
  attack: number
  plate: number
  ice: number
}

// ── Hero Resolver Registry ────────────────────────────────────────

export type HeroAbilityResolver = (
  state: GameState,
  player: PlayerState,
  slot: AbilitySlot,
  abilityLevel: number,
  target?: TargetRef,
  /** Deterministic per-tick rng (see server/game/engine/rng.ts) for the rare
   *  ability that rolls a chance/random target (e.g. kernel's R). Optional —
   *  most hero resolvers ignore it entirely. */
  rng?: () => number,
) => Effect.Effect<AbilityResult, AbilityError>

export type HeroPassiveResolver = (
  state: GameState,
  playerId: string,
  event: GameEvent,
) => GameState

const heroRegistry = new Map<
  string,
  { ability: HeroAbilityResolver; passive: HeroPassiveResolver }
>()

// Per-hero event-type filter for passives. If a hero is not in this map, it
// receives all event types (safe default). If present, `resolvePassive` skips
// the call entirely for event types not in the set — avoiding the O(players)
// spread in `runHeroPassives` for events the passive no-ops on anyway.
const heroPassiveEventTypes = new Map<string, ReadonlySet<GameEvent['type']>>()

export function registerHero(
  heroId: string,
  ability: HeroAbilityResolver,
  passive: HeroPassiveResolver,
  eventTypes?: GameEvent['type'][],
): void {
  heroRegistry.set(heroId, { ability, passive })
  if (eventTypes) {
    heroPassiveEventTypes.set(heroId, new Set(eventTypes))
  }
}

export function getHeroResolver(heroId: string) {
  return heroRegistry.get(heroId)
}

/** Returns true if the hero's passive might act on this event type. */
function passiveCaresAboutEvent(heroId: string, eventType: GameEvent['type']): boolean {
  const types = heroPassiveEventTypes.get(heroId)
  if (!types) return true // no filter registered → safe default
  return types.has(eventType)
}
// ── Ability Level Scaling ─────────────────────────────────────────

/**
 * Rank of an ability at a given player level — 0 means "not learned yet", which
 * resolveAbility rejects. Defined in shared/ so the client answers identically
 * (the ability buttons must not advertise an unlearned ultimate as ready, and
 * /learn must state the schedule the engine enforces). Re-exported here because
 * the engine and every hero module import it from this path.
 */
export { getAbilityLevel }

/**
 * Per-rank BW costs, read from the hero registry. Re-exported here for the
 * same reason as getAbilityLevel: every hero module reads its costs through
 * this path, and the client has to be able to quote the same number before the
 * cast is submitted. The resolvers kept private tables until the two diverged.
 */
export { abilityBwTable }

/** Pick a scaled value from an array based on ability level. */
export function scaleValue(values: readonly number[], level: number): number {
  if (level <= 0) return 0
  const idx = Math.min(level - 1, values.length - 1)
  return values[idx] ?? values[0]!
}

// ── Combat Stats ──────────────────────────────────────────────────

export function getPlayerCombatStats(player: PlayerState): CombatStats {
  const hero = HEROES[player.heroId ?? '']
  if (!hero) return { attack: 0, plate: 0, ice: 0 }
  const lvl = player.level - 1
  return {
    attack: hero.baseStats.attack + (hero.growthPerLevel.attack ?? 0) * lvl,
    plate: hero.baseStats.plate + (hero.growthPerLevel.plate ?? 0) * lvl,
    ice: hero.baseStats.ice + (hero.growthPerLevel.ice ?? 0) * lvl,
  }
}

// ── Buff Utilities ────────────────────────────────────────────────

/**
 * Hard-control buff ids that require the target to be BREACHED (or they fizzle).
 * Shared with validateAction pre-rejection and BotAI so the three sites cannot drift.
 * Do NOT broaden this to self-buffs that share a name fragment.
 */
export const HARD_CONTROL_BUFF_IDS = [
  'stun',
  'silence',
  'root',
  'taunt',
  'feared',
  'hex',
  'cyclone',
] as const

export type HardControlBuffId = (typeof HARD_CONTROL_BUFF_IDS)[number]

const HARD_CONTROL_SET: ReadonlySet<string> = new Set(HARD_CONTROL_BUFF_IDS)

export function isHardControlBuffId(id: string): boolean {
  return HARD_CONTROL_SET.has(id)
}

/** One hard-control effect that fizzled on a CLOSED (non-breached) target. */
export interface ControlResisted {
  readonly targetId: string
  /** The buff id that failed to land (`stun`, `root`, `silence`, `taunt`, `feared`, ...). */
  readonly status: string
}

/** Why the control did not land — the line the player needs to learn BREACH. */
export const CONTROL_RESISTED_REASON = 'CLOSED — breach first'

// Collector for the cast currently being resolved, so every applyBuff site can
// report a fizzle without each resolver being edited (an AoE with six control
// sites would otherwise need six hand-written checks). It is only ever set
// inside `withControlTrace`, which runs the resolver to completion
// SYNCHRONOUSLY (runSyncExit) and restores the previous slot in `finally` — no
// other fiber or tick can run, and so none can attach to or steal this cast's
// trace, even when the caller itself is an async fiber that yields.
let controlTrace: ControlResisted[] | null = null

/** Run `resolve` with its own fresh fizzle trace; return the exit and the trace. */
function withControlTrace<A, E>(
  resolve: () => Effect.Effect<A, E>,
): { exit: Exit.Exit<A, E>; resisted: ControlResisted[] } {
  const resisted: ControlResisted[] = []
  const previous = controlTrace
  controlTrace = resisted
  try {
    return { exit: Effect.runSyncExit(Effect.suspend(resolve)), resisted }
  } finally {
    controlTrace = previous
  }
}

function recordControlResisted(targetId: string, status: string): void {
  if (!controlTrace) return
  if (controlTrace.some((r) => r.targetId === targetId && r.status === status)) return
  controlTrace.push({ targetId, status })
}

/**
 * Why cast-applied control disables (stun/silence/root/taunt) use cyclesRemaining
 * 2, not 1, to gate ONE future action: the debuff is applied during the resolve
 * phase, but the victim's action THIS tick was already validated at tick start,
 * and cycleAllBuffs reaps the debuff at the END of this same tick. So
 * cyclesRemaining:1 decrements to 0 and is gone before the next validateAction
 * ever sees it (a silent no-op). 2 survives the same-tick reap, gates the next
 * action, then expires. (See the `cyclesRemaining: 2 // one gated action` sites.)
 */
export function applyBuff(player: PlayerState, buff: BuffState): PlayerState {
  // AIRGAP closes a breach by definition — strip breached when airgap lands.
  if (buff.id === 'airgap') {
    player = removeBuff(player, 'breached')
  }

  // Hard control fails on a closed (non-breached) target. Kinetic never needs
  // access; this gate is control-only. Self-applied control (source === target
  // id) always lands — e.g. mutex Critical Section self-root. Non-control ids pass.
  // The fizzle is not silent: while a cast is resolving (see resolveAbility),
  // it is recorded so the cast can report WHO resisted WHAT and why.
  if (isHardControlBuffId(buff.id) && !isBreached(player) && buff.source !== player.id) {
    recordControlResisted(player.id, buff.id)
    return player
  }

  const idx = player.buffs.findIndex((b) => b.id === buff.id && b.source === buff.source)
  const buffs = [...player.buffs]
  if (idx >= 0) {
    buffs[idx] = {
      ...buffs[idx]!,
      stacks: buff.stacks,
      cyclesRemaining: Math.max(buffs[idx]!.cyclesRemaining, buff.cyclesRemaining),
    }
  } else {
    buffs.push(buff)
  }
  return { ...player, buffs }
}

export function cycleBuffs(player: PlayerState): PlayerState {
  const buffs = player.buffs
    .map((b) => ({ ...b, cyclesRemaining: b.cyclesRemaining - 1 }))
    // Preserve the backup buff at cyclesRemaining === 0 so handleDeaths can proc
    // the resurrection even if the buff would have expired this cycle. If the
    // player survives this cycle, the backup is removed as expired at the end of
    // handleDeaths (see GameLoop.handleDeaths' backup-expiry sweep).
    .filter((b) => b.cyclesRemaining > 0 || b.id === 'backup')
  return { ...player, buffs }
}

export function removeBuff(player: PlayerState, buffId: string): PlayerState {
  return { ...player, buffs: player.buffs.filter((b) => b.id !== buffId) }
}

export function hasBuff(player: PlayerState, buffId: string): boolean {
  return player.buffs.some((b) => b.id === buffId)
}

export function getBuffStacks(player: PlayerState, buffId: string): number {
  return player.buffs.find((b) => b.id === buffId)?.stacks ?? 0
}

// ── State Update Helpers ──────────────────────────────────────────

export function updatePlayer(state: GameState, player: PlayerState): GameState {
  return { ...state, players: { ...state.players, [player.id]: player } }
}

export function updatePlayers(state: GameState, players: PlayerState[]): GameState {
  const updated = { ...state.players }
  for (const p of players) {
    updated[p.id] = p
  }
  return { ...state, players: updated }
}

export function addEvent(state: GameState, event: GameEvent): GameState {
  return { ...state, events: [...state.events, event] }
}

// ── Target Resolution ─────────────────────────────────────────────

export function findTargetPlayer(state: GameState, target: TargetRef): PlayerState | undefined {
  if (target.kind === 'hero') {
    return Object.values(state.players).find(
      (p) => p.heroId === target.name || p.name === target.name || p.id === target.name,
    )
  }
  return undefined
}

export function getPlayersInZone(state: GameState, zone: string): PlayerState[] {
  return Object.values(state.players).filter((p) => p.zone === zone && p.alive)
}

export function getEnemiesInZone(
  state: GameState,
  player: PlayerState,
  zone?: string,
): PlayerState[] {
  return getPlayersInZone(state, zone ?? player.zone).filter((p) => p.team !== player.team)
}

/**
 * The zones an ability reaches: the caster's own, plus every adjacent one when
 * the AOE+ exotic talent is in play. Single source for the widened footprint so
 * the hero-facing target list and the NPC damage pass can never disagree.
 */
export function zonesInAbilityRange(zone: string, includeAdjacent: boolean): string[] {
  return includeAdjacent ? [zone, ...(ZONE_MAP[zone]?.adjacentTo ?? [])] : [zone]
}

/**
 * Alive enemies in the player's zone AND every adjacent zone — the AOE+ exotic
 * talent widens an ability's reach this way (deduped by id so a target is only
 * hit once even if it somehow appears in two listed zones).
 */
export function getEnemiesInZoneAndAdjacent(state: GameState, player: PlayerState): PlayerState[] {
  const zoneIds = zonesInAbilityRange(player.zone, true)
  const seen = new Set<string>()
  const out: PlayerState[] = []
  for (const zoneId of zoneIds) {
    for (const p of getPlayersInZone(state, zoneId)) {
      if (p.team !== player.team && !seen.has(p.id)) {
        seen.add(p.id)
        out.push(p)
      }
    }
  }
  return out
}

export function getAlliesInZone(
  state: GameState,
  player: PlayerState,
  zone?: string,
): PlayerState[] {
  return getPlayersInZone(state, zone ?? player.zone).filter(
    (p) => p.team === player.team && p.id !== player.id,
  )
}

export function getAllEnemyPlayers(state: GameState, player: PlayerState): PlayerState[] {
  return Object.values(state.players).filter((p) => p.team !== player.team && p.alive)
}

// ── Damage Application ────────────────────────────────────────────

/**
 * Apply one hit to a hero through the full mitigation chain — the single
 * implementation lives in shared/utils/damageCalc (applyIncomingHit) so the
 * danger prediction (shared/utils/hopDamage) runs the very same chain.
 */
export function dealDamage(
  target: PlayerState,
  rawDamage: number,
  damageType: DamageType,
): PlayerState {
  return applyIncomingHit(target, rawDamage, damageType)
}

/** Amp Stack (Arcane Power): +15% to all code damage the owner deals. */
const MYSTICAL_STAFF_MAGIC_AMP = 0.15

/** Caster-side outgoing code-damage multiplier from equipped items. */
export function getMagicAmp(caster: PlayerState): number {
  return caster.items.includes('amp_stack') ? 1 + MYSTICAL_STAFF_MAGIC_AMP : 1
}

/**
 * Deal ability damage crediting the casting hero, so caster-side amplifiers
 * (currently Amp Stack's +15% code) are applied before the target's
 * mitigation in dealDamage. Non-code damage passes through unchanged. Hero
 * ability/passive damage should route through here; `dealDamage` remains the
 * lower-level target-only primitive.
 */
export function dealAbilityDamage(
  caster: PlayerState,
  target: PlayerState,
  rawDamage: number,
  damageType: DamageType,
): PlayerState {
  const amped = damageType === 'code' ? Math.round(rawDamage * getMagicAmp(caster)) : rawDamage
  return dealDamage(target, amped, damageType)
}

/**
 * Ability damage to the NPCs standing in the caster's zone — enemy lane waves
 * and neutrals, which are hostile to both teams. Until this existed no ability
 * could touch a wave, so standing in lane with a wave in front of you and no
 * enemy hero present made all four of your abilities dead weight: no waveclear,
 * no silt clearing, no securing a last hit with a nuke.
 *
 * Waves carry no plate or ice stat, so the target-side mitigation
 * in `dealDamage` has nothing to read — only the CASTER-side amplifier
 * (Amp Stack's +15% code) applies, matching `dealAbilityDamage` so the
 * two damage paths can't diverge on the same item.
 *
 * Dead NPCs are left in the array at 0 INTEG (`alive: false` for neutrals) rather
 * than filtered out: the cast bridge credits the kill by diffing INTEG against the
 * pre-cast buffer, and WaveAI reaps them at the end of the same tick. ICE,
 * Tenant and the Terminal are deliberately untouched — a second pass.
 */
export function damageEnemyNpcsInZone(
  state: GameState,
  caster: PlayerState,
  amount: number,
  damageType: DamageType,
  zones: readonly string[] = [caster.zone],
): GameState {
  const damage =
    damageType === 'code' ? Math.round(amount * getMagicAmp(caster)) : Math.round(amount)
  if (damage <= 0) return state

  const zoneIds = new Set(zones)
  let hitAny = false
  // Tutorial training units belong to the human's drill: a bot's AoE passes
  // through them (else it strips the drill unit and banks its payload). Same
  // `bot_` rule as BotManager.isBot — importing it here would be a cycle.
  const sparesTraining = caster.id.startsWith('bot_')

  const waves = (state.waves ?? []).map((c) => {
    if (c.team === caster.team || c.integ <= 0 || !zoneIds.has(c.zone)) return c
    if (sparesTraining && isTrainingWave(c)) return c
    hitAny = true
    return { ...c, integ: Math.max(0, c.integ - damage) }
  })

  const neutrals = (state.neutrals ?? []).map((n) => {
    if (!n.alive || n.integ <= 0 || !zoneIds.has(n.zone)) return n
    hitAny = true
    const integ = Math.max(0, n.integ - damage)
    return { ...n, integ, alive: integ > 0 }
  })

  // Preserve reference equality when nothing was in range — the cast bridge
  // uses it to skip the diff.
  if (!hitAny) return state
  return { ...state, waves, neutrals }
}

export function healPlayer(target: PlayerState, amount: number): PlayerState {
  // cache Invalidate (antiHeal) reduces incoming healing by its % (stored in stacks).
  const antiHealPct = Math.min(100, getBuffStacks(target, 'antiHeal'))
  const effective = Math.round(amount * (1 - antiHealPct / 100))
  return { ...target, integ: Math.min(target.maxInteg, target.integ + effective) }
}

// ── BW & Cooldown ───────────────────────────────────────────────

export function deductBandwidth(player: PlayerState, amount: number): PlayerState {
  return { ...player, bw: Math.max(0, player.bw - amount) }
}

export function setCooldown(player: PlayerState, slot: AbilitySlot, ticks: number): PlayerState {
  return { ...player, cooldowns: { ...player.cooldowns, [slot]: ticks } }
}

export function resetAllCooldowns(player: PlayerState): PlayerState {
  return { ...player, cooldowns: { q: 0, w: 0, e: 0, r: 0 } }
}

// ── Passive Resolution ────────────────────────────────────────────

export function resolvePassive(state: GameState, playerId: string, event: GameEvent): GameState {
  const player = state.players[playerId]
  if (!player?.heroId || !player.alive) return state
  const resolver = heroRegistry.get(player.heroId)
  if (!resolver) return state
  // Skip the call entirely if this hero's passive doesn't care about this
  // event type — avoids the O(players) spread in runHeroPassives for no-ops.
  if (!passiveCaresAboutEvent(player.heroId, event.type)) return state
  return resolver.passive(state, playerId, event)
}

// ── Level Up ──────────────────────────────────────────────────────

export function levelUpHero(player: PlayerState): PlayerState {
  const heroDef = HEROES[player.heroId ?? '']
  if (!heroDef) return player
  const g = heroDef.growthPerLevel
  const newMaxHp = player.maxInteg + (g.integ ?? 0)
  const newMaxMp = player.maxBw + (g.bw ?? 0)
  return {
    ...player,
    level: player.level + 1,
    maxInteg: newMaxHp,
    integ: Math.min(player.integ + (g.integ ?? 0), newMaxHp),
    maxBw: newMaxMp,
    bw: Math.min(player.bw + (g.bw ?? 0), newMaxMp),
  }
}

// ── DoT & Buff Tick Helpers ───────────────────────────────────────

export function processDoTs(state: GameState): { state: GameState; events: GameEngineEvent[] } {
  let updated = state
  const events: GameEngineEvent[] = []
  for (const [_pid, player] of Object.entries(updated.players)) {
    if (!player.alive) continue
    const dotBuffs = player.buffs.filter((b) => b.id.includes('dot'))
    if (dotBuffs.length === 0) continue
    let target = player
    for (const dot of dotBuffs) {
      const damageType: DamageType = dot.id.includes('phys') ? 'kinetic' : 'code'
      // Immunity skips the tick (e.g. BKB airgap ignores a code DoT).
      if (isDamageImmune(target, damageType)) continue
      // Caster-side amplifiers (Amp Stack +15% code) apply to DoTs
      // too — the DoT is still the caster's outgoing code damage.
      const caster = dot.source ? state.players[dot.source] : undefined
      const amp = damageType === 'code' && caster ? getMagicAmp(caster) : 1
      const rawDamage = Math.round(dot.stacks * amp)
      const mitigated = calculateEffectiveDamage(rawDamage, damageType, {
        plate: getEffectivePlate(target),
        ice: getEffectiveIce(target),
      })
      // Target-side vuln amps (magic-vuln / Yield) raise DoT damage too.
      const effectiveDamage = Math.round(
        mitigated * getIncomingDamageMultiplier(target, damageType),
      )
      const newInteg = Math.max(0, target.integ - effectiveDamage)
      target = { ...target, integ: newInteg, alive: newInteg > 0 }
      // Emitting per-dot damage events feeds kill/assist credit and inCombat
      events.push({
        _tag: 'damage',
        cycle: state.cycle,
        sourceId: dot.source,
        targetId: player.id,
        amount: effectiveDamage,
        damageType,
      })
    }
    updated = updatePlayer(updated, target)
  }
  return { state: updated, events }
}

export function cycleAllBuffs(state: GameState): GameState {
  let updated = state
  const events: GameEvent[] = []
  // DMZ explosions are collected here and applied AFTER the per-player tick loop:
  // the loop writes each player's own ticked state back from a snapshot, which
  // would clobber cross-player (enemy) damage applied mid-loop.
  const explosions: {
    casterId: string
    zone: string
    damage: number
    trigger: 'expired' | 'broken'
  }[] = []

  for (const [_pid, player] of Object.entries(updated.players)) {
    if (!player.alive) continue

    const tpChannelingBuff = player.buffs.find((b) => b.id === 'tp_channeling')
    const tpDestBuff = player.buffs.find((b) => b.id === 'tp_destination')
    // Return shadows: a buff that records a zone and snaps the caster back when
    // it expires (last tick) — Traceroute's Next Hop (nextHopShadow) and Lambda's
    // Return (returnMark). Both stash the origin zone in buff.destination.
    const returnShadow = player.buffs.find((b) => b.id === 'nextHopShadow' || b.id === 'returnMark')
    // Firewall DMZ: a marker riding alongside the W shield; when the shield
    // expires (marker runs out) OR breaks (no shield HP left while the marker
    // still has time) it explodes for code damage to enemies in the caster's
    // zone. "Breaks" = the whole shield pool is spent, so a second shield held
    // at the same time (item, Sentry) keeps the DMZ armed until that one goes too.
    const dmz = player.buffs.find((b) => b.id === 'dmz')
    const dmzExpiring = dmz !== undefined && dmz.cyclesRemaining === 1
    const dmzBroken =
      dmz !== undefined &&
      !dmzExpiring &&
      !player.buffs.some((b) => b.id === 'shield' && b.stacks > 0)

    if (tpChannelingBuff && tpChannelingBuff.cyclesRemaining === 1 && tpDestBuff?.destination) {
      const tpDestination = tpDestBuff.destination
      const ticked = cycleBuffs(player)
      const teleported: PlayerState = {
        ...ticked,
        zone: tpDestination,
        buffs: ticked.buffs.filter((b) => b.id !== 'tp_channeling' && b.id !== 'tp_destination'),
      }
      updated = updatePlayer(updated, teleported)

      events.push({
        cycle: state.cycle,
        type: 'teleport_complete',
        payload: {
          playerId: player.id,
          destination: tpDestination,
        },
      })
    } else if (
      returnShadow &&
      returnShadow.cyclesRemaining === 1 &&
      returnShadow.destination &&
      returnShadow.destination !== player.zone
    ) {
      const returnZone = returnShadow.destination
      // cycleBuffs decrements + drops the expiring shadow; then snap the zone.
      const ticked = cycleBuffs(player)
      const teleported: PlayerState = { ...ticked, zone: returnZone }
      updated = updatePlayer(updated, teleported)

      events.push({
        cycle: state.cycle,
        type: 'teleport_complete',
        payload: {
          playerId: player.id,
          destination: returnZone,
          source: returnShadow.id === 'returnMark' ? 'return' : 'next_hop',
        },
      })
    } else if (dmz && (dmzExpiring || dmzBroken)) {
      // Drop the dmz (+ shield) now; queue the blast for after the loop.
      updated = updatePlayer(updated, removeBuff(cycleBuffs(player), 'dmz'))
      explosions.push({
        casterId: player.id,
        zone: player.zone,
        damage: dmz.stacks,
        trigger: dmzExpiring ? 'expired' : 'broken',
      })
    } else {
      const ticked = cycleBuffs(player)
      if (ticked !== player) {
        updated = updatePlayer(updated, ticked)
      }
    }
  }

  // Apply DMZ explosions after every player has ticked (so enemy INTEG loss sticks).
  for (const ex of explosions) {
    const caster = updated.players[ex.casterId]
    if (!caster) continue
    let hitAny = false
    // Per-victim INTEG loss so GameLoop can bridge each into a _tag:'damage' engine
    // event — without it the explosion mutates INTEG but emits no damage event, so
    // a lethal blast gives NO kill credit/bounty/XP and the victim's damage-taken
    // passives (cache energy, firewall/proxy reflect, daemon stealth-break) never
    // fire. Same fix shape as the item-active synthesize-from-HP-diff loop.
    const victims: { id: string; amount: number }[] = []
    for (const enemy of Object.values(updated.players)) {
      if (enemy.team === caster.team || !enemy.alive || enemy.zone !== ex.zone) continue
      const preInteg = enemy.integ
      updated = updatePlayer(updated, dealAbilityDamage(caster, enemy, ex.damage, 'code'))
      const integLost = Math.max(0, preInteg - (updated.players[enemy.id]?.integ ?? preInteg))
      if (integLost > 0) victims.push({ id: enemy.id, amount: integLost })
      hitAny = true
    }
    if (hitAny) {
      events.push({
        cycle: state.cycle,
        type: 'ability_used',
        payload: {
          playerId: ex.casterId,
          ability: 'w',
          effect: 'dmz_explosion',
          trigger: ex.trigger,
          damage: ex.damage,
          victims,
        },
      })
    }
  }

  if (events.length > 0) {
    updated = { ...updated, events: [...updated.events, ...events] }
  }

  return updated
}

// ── Core Ability Resolver ─────────────────────────────────────────

export function resolveAbility(
  state: GameState,
  playerId: string,
  ability: AbilitySlot,
  target?: TargetRef,
  /** Deterministic per-tick rng (see rng.ts). Defaults to Math.random for
   *  back-compat with existing direct callers/tests. */
  rng: () => number = Math.random,
): Effect.Effect<AbilityResult, AbilityError> {
  return Effect.gen(function* () {
    const player = state.players[playerId]
    if (!player?.heroId || !player.alive) {
      return yield* Effect.fail(
        new InvalidTargetError({ target: playerId, reason: 'Player not found or dead' }),
      )
    }

    // Hardshell (airgap) grants debuff immunity, so a BKB hero casts
    // through stun/silence (mirrors the validateAction bypass). Cyclone/Hex still
    // hard-disable via validateAction (they pierce magic immunity).
    const debuffImmune = hasBuff(player, 'airgap')

    if (!debuffImmune && hasBuff(player, 'stun')) {
      return yield* Effect.fail(new InvalidTargetError({ target: ability, reason: 'Stunned' }))
    }

    if (!debuffImmune && hasBuff(player, 'silence')) {
      return yield* Effect.fail(new InvalidTargetError({ target: ability, reason: 'Silenced' }))
    }

    const abilityLevel = getAbilityLevel(player.level, ability)
    if (abilityLevel <= 0) {
      return yield* Effect.fail(
        new InvalidTargetError({ target: ability, reason: 'Ability not yet learned' }),
      )
    }

    const cd = player.cooldowns[ability]
    if (cd > 0) {
      const heroDef = HEROES[player.heroId]
      return yield* Effect.fail(
        new CooldownError({
          ability: heroDef?.abilities[ability].name ?? ability,
          cyclesRemaining: cd,
        }),
      )
    }

    const resolver = heroRegistry.get(player.heroId)
    if (!resolver) {
      return yield* Effect.fail(
        new InvalidTargetError({ target: player.heroId, reason: 'No resolver registered' }),
      )
    }

    // Aim the cast at the right SIDE before anything is spent: a heal thrown at
    // an enemy or a stun thrown at a team-mate is a rejected order, not a
    // resolved cast that burns the cycle, the BW and the cooldown.
    const abilityDef = HEROES[player.heroId]?.abilities[ability]
    if (abilityDef) {
      const rejection = checkAbilityTarget(state, player, abilityDef, target)
      if (rejection) {
        return yield* Effect.fail(
          new InvalidTargetError({ target: targetLabel(target), reason: rejection }),
        )
      }
    }

    // Hard control that fizzles on a CLOSED target is collected while the
    // resolver runs (see applyBuff) and reported on the way out.
    const { exit, resisted } = withControlTrace(() =>
      resolver.ability(state, player, ability, abilityLevel, target, rng),
    )
    const result = yield* exit
    const withTalents = applyAbilityTalents(state, result, player, ability)
    const withLatency = applyLatencyPenalty(withTalents, player, ability)
    return reportControlResisted(
      applyArcaneRefund(withLatency, player),
      player,
      ability,
      resisted,
      state.cycle,
    )
  })
}

/** A short label for a rejected target, for the InvalidTargetError. */
function targetLabel(target?: TargetRef): string {
  if (!target) return 'none'
  if (target.kind === 'hero') return target.name
  if (target.kind === 'zone') return target.zone
  return target.kind
}

/**
 * The side/shape check every targeted hero ability shares (the rule itself lives
 * in shared/utils/ability.ts so the client pre-flight asks the same question).
 * The per-hero resolvers own range, liveness and BW; this owns which TEAM the
 * target may be on and whether a zone-typed ability was aimed at a real zone.
 * Returns the rejection text, or null when the cast may proceed.
 */
export function checkAbilityTarget(
  state: GameState,
  caster: PlayerState,
  ability: AbilityDef,
  target?: TargetRef,
): string | null {
  return abilityTargetError(
    ability,
    caster.team,
    target,
    {
      hero: (ref) => findTargetPlayer(state, ref),
      zoneExists: (zone) => !!state.zones[zone],
    },
    caster.id,
  )
}

/**
 * Make a fizzled hard control honest. The resolver's own `ability_cast` payload
 * still names the stun/root/silence it TRIED to apply, so the cast is annotated
 * with `resisted` and each fizzle also gets a `control_resisted` event naming
 * the target, the effect and the fix. The cast still costs what it costs — the
 * order was legal, the target was closed, and now the player is told so.
 */
function reportControlResisted(
  result: AbilityResult,
  caster: PlayerState,
  slot: AbilitySlot,
  resisted: readonly ControlResisted[],
  cycle: number,
): AbilityResult {
  if (resisted.length === 0) return result
  let annotated = false
  const events: GameEvent[] = result.events.map((e) => {
    if (annotated || e.type !== 'ability_cast' || e.payload['playerId'] !== caster.id) return e
    annotated = true
    return {
      ...e,
      payload: { ...e.payload, resisted: resisted.map((r) => ({ ...r })) },
    }
  })
  for (const r of resisted) {
    events.push({
      cycle,
      type: 'control_resisted',
      payload: {
        playerId: caster.id,
        ability: slot,
        targetId: r.targetId,
        status: r.status,
        reason: CONTROL_RESISTED_REASON,
      },
    })
  }
  return { ...result, events }
}

/**
 * Generic ability-talent application — runs after the hero resolver succeeds,
 * gated on talent.abilityId === cast slot. Never edits hero files:
 * - cooldownReduction: subtract ticks from the resolver-set cooldown (floor 1)
 * - bwCostReduction: refund a % of the BW the resolver actually spent
 * - damageBoost: amplify the cast by an extra % of each enemy's INTEG lost
 *   (post-mitigation approximation, clamped at 0 with alive recomputed)
 * `specialEffect` on a talent is a DISPLAY string only. The exotic mechanics
 * (double cast, spell lifesteal, global ultimate, AOE+ ...) are carried by the
 * talent's `castEffect` and applied where the cast is bridged
 * (ActionResolver.resolveHeroCast) or read via hasTalentCastEffect — not here.
 */
function applyAbilityTalents(
  preState: GameState,
  result: AbilityResult,
  caster: PlayerState,
  slot: AbilitySlot,
): AbilityResult {
  if (!caster.heroId) return result
  const tree = getTalentTree(caster.heroId)
  if (!tree) return result
  const chosen = [
    caster.talents?.tier10,
    caster.talents?.tier15,
    caster.talents?.tier20,
    caster.talents?.tier25,
  ].filter((id): id is string => id !== null && id !== undefined)
  if (chosen.length === 0) return result

  const selected = Object.values(tree.tiers)
    .flat()
    .filter((t) => chosen.includes(t.id) && t.abilityId === slot)
  if (selected.length === 0) return result

  let players = result.state.players
  const postCaster = players[caster.id]
  if (!postCaster) return result

  for (const talent of selected) {
    if (talent.cooldownReduction !== undefined && talent.cooldownReduction > 0) {
      const current = players[caster.id]!
      const cd = current.cooldowns[slot]
      if (cd > 0) {
        players = {
          ...players,
          [caster.id]: {
            ...current,
            cooldowns: { ...current.cooldowns, [slot]: Math.max(1, cd - talent.cooldownReduction) },
          },
        }
      }
    }
    if (talent.bwCostReduction !== undefined && talent.bwCostReduction > 0) {
      const current = players[caster.id]!
      const manaSpent = Math.max(0, caster.bw - current.bw)
      const refund = Math.round((manaSpent * talent.bwCostReduction) / 100)
      if (refund > 0) {
        players = {
          ...players,
          [caster.id]: { ...current, bw: Math.min(current.maxBw, current.bw + refund) },
        }
      }
    }
    if (talent.damageBoost !== undefined && talent.damageBoost > 0) {
      for (const [pid, post] of Object.entries(players)) {
        if (pid === caster.id) continue
        const pre = preState.players[pid]
        if (!pre) continue
        const integLost = pre.integ - post.integ
        if (integLost <= 0) continue
        const extra = Math.round((integLost * talent.damageBoost) / 100)
        if (extra <= 0) continue
        const newInteg = Math.max(0, post.integ - extra)
        players = { ...players, [pid]: { ...post, integ: newInteg, alive: newInteg > 0 } }
      }
    }
    // castEffect talents (double cast, lifesteal, global ult, AOE+) are applied
    // by the cast bridge / hero resolvers, not by this generic stat pass.
  }

  return { ...result, state: { ...result.state, players } }
}

/**
 * Ping's Latency passive: a 'latency' debuff on the caster adds +1 tick to the
 * cooldown of their NEXT ability and is consumed on that cast. Runs in the cast
 * pipeline. Previously the debuff was applied on Ping's attacks but nothing read
 * it, so it did nothing. Only delays a cast that actually set a cooldown (a cast
 * that fizzled or refunded keeps the debuff to spend on the next real cast).
 */
function applyLatencyPenalty(
  result: AbilityResult,
  caster: PlayerState,
  slot: AbilitySlot,
): AbilityResult {
  if (!caster.buffs.some((b) => b.id === 'latency')) return result
  const current = result.state.players[caster.id]
  if (!current) return result
  const cd = current.cooldowns[slot]
  if (cd <= 0) return result
  return {
    ...result,
    state: {
      ...result.state,
      players: {
        ...result.state.players,
        [caster.id]: {
          ...current,
          cooldowns: { ...current.cooldowns, [slot]: cd + 1 },
          buffs: current.buffs.filter((b) => b.id !== 'latency'),
        },
      },
    },
  }
}

/**
 * Arcane cache: refund 40% of the BW a cast spent. Runs in the cast pipeline
 * (NOT applyAbilityTalents, which short-circuits when no talents are chosen).
 */
function applyArcaneRefund(result: AbilityResult, caster: PlayerState): AbilityResult {
  if (!caster.buffs.some((b) => b.id === 'arcane')) return result
  const current = result.state.players[caster.id]
  if (!current) return result
  const manaSpent = Math.max(0, caster.bw - current.bw)
  const refund = Math.round(manaSpent * 0.4)
  if (refund <= 0) return result
  return {
    ...result,
    state: {
      ...result.state,
      players: {
        ...result.state.players,
        [caster.id]: { ...current, bw: Math.min(current.maxBw, current.bw + refund) },
      },
    },
  }
}
