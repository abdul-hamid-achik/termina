import { Effect } from 'effect'
import type { GameState, PlayerState, GameEvent } from '~~/shared/types/game'
import type { TargetRef } from '~~/shared/types/commands'
import {
  type AbilitySlot,
  type AbilityResult,
  type AbilityError,
  InsufficientManaError,
  InvalidTargetError,
  registerHero,
  scaleValue,
  findTargetPlayer,
  getEnemiesInZone,
  dealDamage,
  deductMana,
  setCooldown,
  applyBuff,
  removeBuff,
  getBuffStacks,
  updatePlayer,
  updatePlayers,
} from './_base'

// ── Scaling Values ────────────────────────────────────────────────

const Q_DAMAGE = [80, 120, 160, 200] as const
const Q_MANA = [55, 70, 85, 100] as const
const Q_COOLDOWN = 8
const Q_CACHED_BONUS = 0.5

const W_MANA = [60, 75, 90, 105] as const
const W_COOLDOWN = 12

const E_DAMAGE = [70, 105, 140, 175] as const
const E_MANA = [65, 80, 95, 110] as const
const E_COOLDOWN = 10
const E_ANTIHEAL_DURATION = 3

const R_MANA = [180, 250, 320] as const
const R_COOLDOWN = 50
const R_SLOW_DURATION = 2

const CACHED_ENERGY_RATIO = 0.15
const CACHED_ENERGY_MAX_RATIO = 0.3

// ── Ability Resolver ──────────────────────────────────────────────

function resolveHeroAbility(
  state: GameState,
  player: PlayerState,
  slot: AbilitySlot,
  level: number,
  target?: TargetRef,
): Effect.Effect<AbilityResult, AbilityError> {
  switch (slot) {
    case 'q':
      return resolveQ(state, player, level, target)
    case 'w':
      return resolveW(state, player, level)
    case 'e':
      return resolveE(state, player, level, target)
    case 'r':
      return resolveR(state, player, level)
  }
}

// Q: Cache Hit — physical damage + bonus from cached energy (does NOT consume)
function resolveQ(
  state: GameState,
  player: PlayerState,
  level: number,
  target?: TargetRef,
): Effect.Effect<AbilityResult, AbilityError> {
  return Effect.gen(function* () {
    if (!target || target.kind !== 'hero') {
      return yield* Effect.fail(
        new InvalidTargetError({ target: 'none', reason: 'Requires a hero target' }),
      )
    }

    const manaCost = scaleValue(Q_MANA, level)
    if (player.mp < manaCost) {
      return yield* Effect.fail(
        new InsufficientManaError({ required: manaCost, current: player.mp }),
      )
    }

    const targetPlayer = findTargetPlayer(state, target)
    if (!targetPlayer || !targetPlayer.alive || targetPlayer.zone !== player.zone) {
      return yield* Effect.fail(
        new InvalidTargetError({ target: target.name, reason: 'Target not in same zone or dead' }),
      )
    }

    let caster = deductMana(player, manaCost)
    caster = setCooldown(caster, 'q', Q_COOLDOWN)

    const cached = getBuffStacks(player, 'cachedEnergy')
    const baseDamage = scaleValue(Q_DAMAGE, level)
    const totalDamage = baseDamage + Math.round(cached * Q_CACHED_BONUS)
    const updatedTarget = dealDamage(targetPlayer, totalDamage, 'physical')

    return {
      state: updatePlayers(state, [caster, updatedTarget]),
      events: [
        {
          tick: state.tick,
          type: 'ability_cast',
          payload: {
            playerId: player.id,
            ability: 'q',
            targetId: targetPlayer.id,
            damage: totalDamage,
            damageType: 'physical',
            cachedBonus: Math.round(cached * Q_CACHED_BONUS),
          },
        },
      ],
    }
  })
}

// W: Flush — consume ALL cached energy, convert to shield
function resolveW(
  state: GameState,
  player: PlayerState,
  level: number,
): Effect.Effect<AbilityResult, AbilityError> {
  return Effect.gen(function* () {
    const manaCost = scaleValue(W_MANA, level)
    if (player.mp < manaCost) {
      return yield* Effect.fail(
        new InsufficientManaError({ required: manaCost, current: player.mp }),
      )
    }

    const cached = getBuffStacks(player, 'cachedEnergy')

    let caster = deductMana(player, manaCost)
    caster = setCooldown(caster, 'w', W_COOLDOWN)
    caster = removeBuff(caster, 'cachedEnergy')

    if (cached > 0) {
      caster = applyBuff(caster, {
        id: 'shield',
        stacks: cached,
        ticksRemaining: 3,
        source: player.id,
      })
    }

    return {
      state: updatePlayer(state, caster),
      events: [
        {
          tick: state.tick,
          type: 'ability_cast',
          payload: {
            playerId: player.id,
            ability: 'w',
            shield: cached,
            effect: 'flush',
          },
        },
      ],
    }
  })
}

// E: Invalidate — magic damage + anti-heal debuff (50% reduced healing for 3 ticks)
function resolveE(
  state: GameState,
  player: PlayerState,
  level: number,
  target?: TargetRef,
): Effect.Effect<AbilityResult, AbilityError> {
  return Effect.gen(function* () {
    if (!target || target.kind !== 'hero') {
      return yield* Effect.fail(
        new InvalidTargetError({ target: 'none', reason: 'Requires a hero target' }),
      )
    }

    const manaCost = scaleValue(E_MANA, level)
    if (player.mp < manaCost) {
      return yield* Effect.fail(
        new InsufficientManaError({ required: manaCost, current: player.mp }),
      )
    }

    const targetPlayer = findTargetPlayer(state, target)
    if (!targetPlayer || !targetPlayer.alive || targetPlayer.zone !== player.zone) {
      return yield* Effect.fail(
        new InvalidTargetError({ target: target.name, reason: 'Target not in same zone or dead' }),
      )
    }

    let caster = deductMana(player, manaCost)
    caster = setCooldown(caster, 'e', E_COOLDOWN)

    const damage = scaleValue(E_DAMAGE, level)
    let updatedTarget = dealDamage(targetPlayer, damage, 'magical')
    updatedTarget = applyBuff(updatedTarget, {
      id: 'antiHeal',
      stacks: 50, // 50% reduced healing
      ticksRemaining: E_ANTIHEAL_DURATION,
      source: player.id,
    })

    return {
      state: updatePlayers(state, [caster, updatedTarget]),
      events: [
        {
          tick: state.tick,
          type: 'ability_cast',
          payload: {
            playerId: player.id,
            ability: 'e',
            targetId: targetPlayer.id,
            damage,
            damageType: 'magical',
            effect: 'antiHeal',
            duration: E_ANTIHEAL_DURATION,
          },
        },
      ],
    }
  })
}

// R: Eviction — consume ALL cached energy, AoE pure damage + slow
function resolveR(
  state: GameState,
  player: PlayerState,
  level: number,
): Effect.Effect<AbilityResult, AbilityError> {
  return Effect.gen(function* () {
    const manaCost = scaleValue(R_MANA, level)
    if (player.mp < manaCost) {
      return yield* Effect.fail(
        new InsufficientManaError({ required: manaCost, current: player.mp }),
      )
    }

    const cached = getBuffStacks(player, 'cachedEnergy')

    let caster = deductMana(player, manaCost)
    caster = setCooldown(caster, 'r', R_COOLDOWN)
    caster = removeBuff(caster, 'cachedEnergy')

    const enemies = getEnemiesInZone(state, player)
    const updatedEnemies = enemies.map((e) => {
      let updated = cached > 0 ? dealDamage(e, cached, 'pure') : e
      updated = applyBuff(updated, {
        id: 'slow',
        stacks: 35, // 35% slow
        ticksRemaining: R_SLOW_DURATION,
        source: player.id,
      })
      return updated
    })

    return {
      state: updatePlayers(state, [caster, ...updatedEnemies]),
      events: [
        {
          tick: state.tick,
          type: 'ability_cast',
          payload: {
            playerId: player.id,
            ability: 'r',
            damage: cached,
            damageType: 'pure',
            effect: 'eviction',
            slowDuration: R_SLOW_DURATION,
            targets: enemies.map((e) => e.id),
          },
        },
      ],
    }
  })
}

// ── Passive: Write-Back ──────────────────────────────────────────
// On damage_taken, store 15% of damage as cachedEnergy buff stacks, max 30% of maxHP.

function resolveHeroPassive(state: GameState, playerId: string, event: GameEvent): GameState {
  if (event.type !== 'damage_taken' || event.payload['targetId'] !== playerId) return state

  const player = state.players[playerId]
  if (!player || !player.alive) return state

  const damage = event.payload['damage'] as number
  if (!damage || damage <= 0) return state

  const energyGain = Math.round(damage * CACHED_ENERGY_RATIO)
  const currentEnergy = getBuffStacks(player, 'cachedEnergy')
  const maxEnergy = Math.round(player.maxHp * CACHED_ENERGY_MAX_RATIO)
  const newEnergy = Math.min(currentEnergy + energyGain, maxEnergy)

  const updated = applyBuff(player, {
    id: 'cachedEnergy',
    stacks: newEnergy,
    ticksRemaining: 9999,
    source: playerId,
  })

  return updatePlayer(state, updated)
}

/** Get current cached energy stacks for a Cache player. */
export function getCachedEnergy(player: PlayerState): number {
  return getBuffStacks(player, 'cachedEnergy')
}

registerHero('cache', resolveHeroAbility, resolveHeroPassive)

export { resolveHeroAbility, resolveHeroPassive }
