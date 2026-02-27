import { Effect, Data } from 'effect'
import type { GameState, PlayerState, BuffState, GameEvent } from '~~/shared/types/game'
import type { TargetRef } from '~~/shared/types/commands'
import type { DamageType } from '~~/shared/types/hero'
import { HEROES } from '~~/shared/constants/heroes'
import { calculateEffectiveDamage } from '../engine/DamageCalculator'

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

export function dealDamage(
  target: PlayerState,
  rawDamage: number,
  damageType: DamageType,
): PlayerState {
  const stats = getPlayerCombatStats(target)
  const effective = calculateEffectiveDamage(rawDamage, damageType, stats)
  // Check for Kernel passive (hardened: 10% reduction)
  const hardenedReduction = hasBuff(target, 'hardened') ? 0.9 : 1
  // Check for shield buff
  const shield = target.buffs.find((b) => b.id === 'shield')
  let remaining = Math.round(effective * hardenedReduction)

  if (shield && shield.stacks > 0) {
    if (shield.stacks >= remaining) {
      // Shield absorbs all damage
      const updatedBuffs = target.buffs.map((b) =>
        b.id === 'shield' ? { ...b, stacks: b.stacks - remaining } : b,
      )
      return { ...target, buffs: updatedBuffs }
    } else {
      remaining -= shield.stacks
      const updatedBuffs = target.buffs.filter((b) => b.id !== 'shield')
      target = { ...target, buffs: updatedBuffs }
    }
  }

  // Check Phase Shift (Echo W) — dodge attack
  if (hasBuff(target, 'phaseShift')) {
    return removeBuff(target, 'phaseShift')
  }

  // Check firewall damage reduction
  const firewallBuff = target.buffs.find((b) => b.id === 'firewallDefense')
  if (firewallBuff) {
    remaining = Math.round(remaining * 0.7) // 30% reduction
  }

  const newHp = Math.max(0, target.hp - remaining)
  return { ...target, hp: newHp, alive: newHp > 0 }
}

export function healPlayer(target: PlayerState, amount: number): PlayerState {
  return { ...target, hp: Math.min(target.maxHp, target.hp + amount) }
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

export function processDoTs(state: GameState): GameState {
  let updated = state
  for (const [_pid, player] of Object.entries(updated.players)) {
    if (!player.alive) continue
    const dotBuffs = player.buffs.filter(b => b.id.includes('dot'))
    if (dotBuffs.length === 0) continue
    let target = player
    for (const dot of dotBuffs) {
      const newHp = Math.max(0, target.hp - dot.stacks)
      target = { ...target, hp: newHp, alive: newHp > 0 }
    }
    updated = updatePlayer(updated, target)
  }
  return updated
}

export function tickAllBuffs(state: GameState): GameState {
  let updated = state
  for (const [_pid, player] of Object.entries(updated.players)) {
    if (!player.alive) continue
    const ticked = tickBuffs(player)
    if (ticked !== player) {
      updated = updatePlayer(updated, ticked)
    }
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

    return yield* resolver.ability(state, player, ability, abilityLevel, target)
  })
}
