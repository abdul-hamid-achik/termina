import { Effect, Data } from 'effect'
import type { GameState, PlayerState, BuffState, GameEvent } from '~~/shared/types/game'
import type { TargetRef } from '~~/shared/types/commands'
import type { DamageType } from '~~/shared/types/hero'
import { HEROES } from '~~/shared/constants/heroes'
import {
  calculateEffectiveDamage,
  getIncomingDamageMultiplier,
  isDamageImmune,
} from '~~/server/game/engine/DamageCalculator'
import { getEffectiveDefense, getEffectiveMagicResist } from '~~/server/game/engine/EffectiveStats'
import { TALENT_TREES } from '~~/shared/constants/talents'
import type { GameEngineEvent } from '~~/server/game/protocol/events'

// ── Typed Errors ──────────────────────────────────────────────────
/* eslint-disable unicorn/throw-new-error */

export class InsufficientManaError extends Data.TaggedError('InsufficientManaError')<{
  readonly required: number
  readonly current: number
}> {}

export class CooldownError extends Data.TaggedError('CooldownError')<{
  readonly ability: string
  readonly ticksRemaining: number
}> {}

export class InvalidTargetError extends Data.TaggedError('InvalidTargetError')<{
  readonly target: string
  readonly reason: string
}> {}
/* eslint-enable unicorn/throw-new-error */

export type AbilityError = InsufficientManaError | CooldownError | InvalidTargetError

// ── Types ─────────────────────────────────────────────────────────

export type AbilitySlot = 'q' | 'w' | 'e' | 'r'

export interface AbilityResult {
  state: GameState
  events: GameEvent[]
}

export interface CombatStats {
  attack: number
  defense: number
  magicResist: number
}

// ── Hero Resolver Registry ────────────────────────────────────────

export type HeroAbilityResolver = (
  state: GameState,
  player: PlayerState,
  slot: AbilitySlot,
  abilityLevel: number,
  target?: TargetRef,
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

export function registerHero(
  heroId: string,
  ability: HeroAbilityResolver,
  passive: HeroPassiveResolver,
): void {
  heroRegistry.set(heroId, { ability, passive })
}

export function getHeroResolver(heroId: string) {
  return heroRegistry.get(heroId)
}

// ── Ability Level Scaling ─────────────────────────────────────────

/** Q/W/E level at player levels 1,3,5,7. R level at player levels 6,12,18. */
export function getAbilityLevel(playerLevel: number, slot: AbilitySlot): number {
  if (slot === 'r') {
    if (playerLevel >= 18) return 3
    if (playerLevel >= 12) return 2
    if (playerLevel >= 6) return 1
    return 0
  }
  if (playerLevel >= 7) return 4
  if (playerLevel >= 5) return 3
  if (playerLevel >= 3) return 2
  if (playerLevel >= 1) return 1
  return 0
}

/** Pick a scaled value from an array based on ability level. */
export function scaleValue(values: readonly number[], level: number): number {
  if (level <= 0) return 0
  const idx = Math.min(level - 1, values.length - 1)
  return values[idx] ?? values[0]!
}

// ── Combat Stats ──────────────────────────────────────────────────

export function getPlayerCombatStats(player: PlayerState): CombatStats {
  const hero = HEROES[player.heroId ?? '']
  if (!hero) return { attack: 0, defense: 0, magicResist: 0 }
  const lvl = player.level - 1
  return {
    attack: hero.baseStats.attack + (hero.growthPerLevel.attack ?? 0) * lvl,
    defense: hero.baseStats.defense + (hero.growthPerLevel.defense ?? 0) * lvl,
    magicResist: hero.baseStats.magicResist + (hero.growthPerLevel.magicResist ?? 0) * lvl,
  }
}

// ── Buff Utilities ────────────────────────────────────────────────

export function applyBuff(player: PlayerState, buff: BuffState): PlayerState {
  const idx = player.buffs.findIndex((b) => b.id === buff.id && b.source === buff.source)
  const buffs = [...player.buffs]
  if (idx >= 0) {
    buffs[idx] = {
      ...buffs[idx]!,
      stacks: buff.stacks,
      ticksRemaining: Math.max(buffs[idx]!.ticksRemaining, buff.ticksRemaining),
    }
  } else {
    buffs.push(buff)
  }
  return { ...player, buffs }
}

export function tickBuffs(player: PlayerState): PlayerState {
  const buffs = player.buffs
    .map((b) => ({ ...b, ticksRemaining: b.ticksRemaining - 1 }))
    .filter((b) => b.ticksRemaining > 0)
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
 * Run damage through a buff list's 'shield' buff (if any).
 * Returns the post-absorption buff list and the damage remaining.
 * Shared by ability damage (dealDamage) and the basic-attack path.
 */
export function absorbShield(
  buffs: BuffState[],
  damage: number,
): { buffs: BuffState[]; remaining: number } {
  const shield = buffs.find((b) => b.id === 'shield')
  if (!shield || shield.stacks <= 0) return { buffs, remaining: damage }
  if (shield.stacks >= damage) {
    // Shield absorbs all damage
    return {
      buffs: buffs.map((b) => (b.id === 'shield' ? { ...b, stacks: b.stacks - damage } : b)),
      remaining: 0,
    }
  }
  return {
    buffs: buffs.filter((b) => b.id !== 'shield'),
    remaining: damage - shield.stacks,
  }
}

export function dealDamage(
  target: PlayerState,
  rawDamage: number,
  damageType: DamageType,
): PlayerState {
  // Immunity (Proxy R / Eul's invulnerable; BKB magic_immune; Ethereal/Ghost
  // physical) ignores the hit entirely — no HP lost, buff left for tickBuffs to
  // expire (NOT consumed like phaseShift).
  if (isDamageImmune(target, damageType)) return target

  // Effective stats include items, talents, and engine-consumed buffs
  const effective = calculateEffectiveDamage(rawDamage, damageType, {
    defense: getEffectiveDefense(target),
    magicResist: getEffectiveMagicResist(target),
  })
  // Check for Kernel passive (hardened: 10% reduction)
  const hardenedReduction = hasBuff(target, 'hardened') ? 0.9 : 1
  let remaining = Math.round(effective * hardenedReduction)

  // Target-side vuln debuffs amplify incoming damage (magic-vuln for magical:
  // regex Q / Veil / Ethereal Blade; thread Yield for all types). Applied before
  // shield so the shield soaks the amplified amount ("takes more damage").
  remaining = Math.round(remaining * getIncomingDamageMultiplier(target, damageType))

  // Check for shield buff
  const shield = target.buffs.find((b) => b.id === 'shield')
  if (shield && shield.stacks > 0) {
    const absorbed = absorbShield(target.buffs, remaining)
    if (absorbed.remaining === 0) {
      return { ...target, buffs: absorbed.buffs }
    }
    remaining = absorbed.remaining
    target = { ...target, buffs: absorbed.buffs }
  }

  // Check Phase Shift (Echo W) — dodge attack
  if (hasBuff(target, 'phaseShift')) {
    return removeBuff(target, 'phaseShift')
  }

  const newHp = Math.max(0, target.hp - remaining)
  return { ...target, hp: newHp, alive: newHp > 0 }
}

/** Mystical Staff (Arcane Power): +15% to all magical damage the owner deals. */
const MYSTICAL_STAFF_MAGIC_AMP = 0.15

/** Caster-side outgoing magical-damage multiplier from equipped items. */
export function getMagicAmp(caster: PlayerState): number {
  return caster.items.includes('mystical_staff') ? 1 + MYSTICAL_STAFF_MAGIC_AMP : 1
}

/**
 * Deal ability damage crediting the casting hero, so caster-side amplifiers
 * (currently Mystical Staff's +15% magical) are applied before the target's
 * mitigation in dealDamage. Non-magical damage passes through unchanged. Hero
 * ability/passive damage should route through here; `dealDamage` remains the
 * lower-level target-only primitive.
 */
export function dealAbilityDamage(
  caster: PlayerState,
  target: PlayerState,
  rawDamage: number,
  damageType: DamageType,
): PlayerState {
  const amped = damageType === 'magical' ? Math.round(rawDamage * getMagicAmp(caster)) : rawDamage
  return dealDamage(target, amped, damageType)
}

export function healPlayer(target: PlayerState, amount: number): PlayerState {
  // cache Invalidate (antiHeal) reduces incoming healing by its % (stored in stacks).
  const antiHealPct = Math.min(100, getBuffStacks(target, 'antiHeal'))
  const effective = Math.round(amount * (1 - antiHealPct / 100))
  return { ...target, hp: Math.min(target.maxHp, target.hp + effective) }
}

// ── Mana & Cooldown ───────────────────────────────────────────────

export function deductMana(player: PlayerState, amount: number): PlayerState {
  return { ...player, mp: Math.max(0, player.mp - amount) }
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
  return resolver.passive(state, playerId, event)
}

// ── Level Up ──────────────────────────────────────────────────────

export function levelUpHero(player: PlayerState): PlayerState {
  const heroDef = HEROES[player.heroId ?? '']
  if (!heroDef) return player
  const g = heroDef.growthPerLevel
  const newMaxHp = player.maxHp + (g.hp ?? 0)
  const newMaxMp = player.maxMp + (g.mp ?? 0)
  return {
    ...player,
    level: player.level + 1,
    maxHp: newMaxHp,
    hp: Math.min(player.hp + (g.hp ?? 0), newMaxHp),
    maxMp: newMaxMp,
    mp: Math.min(player.mp + (g.mp ?? 0), newMaxMp),
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
      const damageType: DamageType = dot.id.includes('phys') ? 'physical' : 'magical'
      // Immunity skips the tick (e.g. BKB magic_immune ignores a magical DoT).
      if (isDamageImmune(target, damageType)) continue
      const mitigated = calculateEffectiveDamage(dot.stacks, damageType, {
        defense: getEffectiveDefense(target),
        magicResist: getEffectiveMagicResist(target),
      })
      // Target-side vuln amps (magic-vuln / Yield) raise DoT damage too.
      const effectiveDamage = Math.round(
        mitigated * getIncomingDamageMultiplier(target, damageType),
      )
      const newHp = Math.max(0, target.hp - effectiveDamage)
      target = { ...target, hp: newHp, alive: newHp > 0 }
      // Emitting per-dot damage events feeds kill/assist credit and inCombat
      events.push({
        _tag: 'damage',
        tick: state.tick,
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

export function tickAllBuffs(state: GameState): GameState {
  let updated = state
  const events: GameEvent[] = []

  for (const [_pid, player] of Object.entries(updated.players)) {
    if (!player.alive) continue

    const tpChannelingBuff = player.buffs.find((b) => b.id === 'tp_channeling')
    const tpDestBuff = player.buffs.find((b) => b.id === 'tp_destination')
    // Return shadows: a buff that records a zone and snaps the caster back when
    // it expires (last tick) — Traceroute's Next Hop (nextHopShadow) and Lambda's
    // Return (returnMark). Both stash the origin zone in buff.destination.
    const returnShadow = player.buffs.find((b) => b.id === 'nextHopShadow' || b.id === 'returnMark')

    if (tpChannelingBuff && tpChannelingBuff.ticksRemaining === 1 && tpDestBuff?.destination) {
      const tpDestination = tpDestBuff.destination
      const ticked = tickBuffs(player)
      const teleported: PlayerState = {
        ...ticked,
        zone: tpDestination,
        buffs: ticked.buffs.filter((b) => b.id !== 'tp_channeling' && b.id !== 'tp_destination'),
      }
      updated = updatePlayer(updated, teleported)

      events.push({
        tick: state.tick,
        type: 'teleport_complete',
        payload: {
          playerId: player.id,
          destination: tpDestination,
        },
      })
    } else if (
      returnShadow &&
      returnShadow.ticksRemaining === 1 &&
      returnShadow.destination &&
      returnShadow.destination !== player.zone
    ) {
      const returnZone = returnShadow.destination
      // tickBuffs decrements + drops the expiring shadow; then snap the zone.
      const ticked = tickBuffs(player)
      const teleported: PlayerState = { ...ticked, zone: returnZone }
      updated = updatePlayer(updated, teleported)

      events.push({
        tick: state.tick,
        type: 'teleport_complete',
        payload: {
          playerId: player.id,
          destination: returnZone,
          source: returnShadow.id === 'returnMark' ? 'return' : 'next_hop',
        },
      })
    } else {
      const ticked = tickBuffs(player)
      if (ticked !== player) {
        updated = updatePlayer(updated, ticked)
      }
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
): Effect.Effect<AbilityResult, AbilityError> {
  return Effect.gen(function* () {
    const player = state.players[playerId]
    if (!player?.heroId || !player.alive) {
      return yield* Effect.fail(
        new InvalidTargetError({ target: playerId, reason: 'Player not found or dead' }),
      )
    }

    if (hasBuff(player, 'stun')) {
      return yield* Effect.fail(new InvalidTargetError({ target: ability, reason: 'Stunned' }))
    }

    if (hasBuff(player, 'silence')) {
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
          ticksRemaining: cd,
        }),
      )
    }

    const resolver = heroRegistry.get(player.heroId)
    if (!resolver) {
      return yield* Effect.fail(
        new InvalidTargetError({ target: player.heroId, reason: 'No resolver registered' }),
      )
    }

    const result = yield* resolver.ability(state, player, ability, abilityLevel, target)
    const withTalents = applyAbilityTalents(state, result, player, ability)
    const withLatency = applyLatencyPenalty(withTalents, player, ability)
    return applyArcaneRefund(withLatency, player)
  })
}

/**
 * Generic ability-talent application — runs after the hero resolver succeeds,
 * gated on talent.abilityId === cast slot. Never edits hero files:
 * - cooldownReduction: subtract ticks from the resolver-set cooldown (floor 1)
 * - manaCostReduction: refund a % of the mana the resolver actually spent
 * - damageBoost: amplify the cast by an extra % of each enemy's HP lost
 *   (post-mitigation approximation, clamped at 0 with alive recomputed)
 * Talents of type 'special'/'ability_boost' carrying only specialEffect
 * strings (e.g. double_cast_chance_25, global_ultimate) are explicit no-ops —
 * implementing them requires per-hero work and is out of scope.
 */
function applyAbilityTalents(
  preState: GameState,
  result: AbilityResult,
  caster: PlayerState,
  slot: AbilitySlot,
): AbilityResult {
  if (!caster.heroId) return result
  const tree = TALENT_TREES[caster.heroId]
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
    if (talent.manaCostReduction !== undefined && talent.manaCostReduction > 0) {
      const current = players[caster.id]!
      const manaSpent = Math.max(0, caster.mp - current.mp)
      const refund = Math.round((manaSpent * talent.manaCostReduction) / 100)
      if (refund > 0) {
        players = {
          ...players,
          [caster.id]: { ...current, mp: Math.min(current.maxMp, current.mp + refund) },
        }
      }
    }
    if (talent.damageBoost !== undefined && talent.damageBoost > 0) {
      for (const [pid, post] of Object.entries(players)) {
        if (pid === caster.id) continue
        const pre = preState.players[pid]
        if (!pre) continue
        const hpLost = pre.hp - post.hp
        if (hpLost <= 0) continue
        const extra = Math.round((hpLost * talent.damageBoost) / 100)
        if (extra <= 0) continue
        const newHp = Math.max(0, post.hp - extra)
        players = { ...players, [pid]: { ...post, hp: newHp, alive: newHp > 0 } }
      }
    }
    // 'special' / 'ability_boost' specialEffect-only talents: intentional no-op
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
 * Arcane rune: refund 40% of the mana a cast spent. Runs in the cast pipeline
 * (NOT applyAbilityTalents, which short-circuits when no talents are chosen).
 */
function applyArcaneRefund(result: AbilityResult, caster: PlayerState): AbilityResult {
  if (!caster.buffs.some((b) => b.id === 'arcane')) return result
  const current = result.state.players[caster.id]
  if (!current) return result
  const manaSpent = Math.max(0, caster.mp - current.mp)
  const refund = Math.round(manaSpent * 0.4)
  if (refund <= 0) return result
  return {
    ...result,
    state: {
      ...result.state,
      players: {
        ...result.state.players,
        [caster.id]: { ...current, mp: Math.min(current.maxMp, current.mp + refund) },
      },
    },
  }
}
