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
  hasBuff,
  getBuffStacks,
  updatePlayer,
  updatePlayers,
} from './_base'

// ── Scaling Values ────────────────────────────────────────────────

const Q_DAMAGE = [75, 110, 145, 180] as const
const Q_MANA = [40, 50, 60, 70] as const
const Q_COOLDOWN = 5

const W_MANA = [70, 85, 100, 115] as const
const W_COOLDOWN = 14

const E_DAMAGE = [70, 100, 130, 160] as const
const E_MANA = [80, 95, 110, 125] as const
const E_COOLDOWN = 10
const E_SLOW_PERCENT = 30
const E_SLOW_DURATION = 2

const R_DAMAGE = [300, 450, 600] as const
const R_MANA = [250, 350, 450] as const
const R_COOLDOWN = 50

const CLOSURE_CASTS_REQUIRED = 3
const CLOSURE_WINDOW_TICKS = 4
const CLOSURE_BONUS_DAMAGE = 0.3

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
      return resolveE(state, player, level)
    case 'r':
      return resolveR(state, player, level, target)
  }
}

// Q: Invoke — magic damage to target
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

    const closureActive = hasBuff(player, 'closureActive')
    const manaCost = closureActive ? 0 : scaleValue(Q_MANA, level)
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

    let caster = manaCost > 0 ? deductMana(player, manaCost) : player
    caster = setCooldown(caster, 'q', Q_COOLDOWN)

    const baseDamage = scaleValue(Q_DAMAGE, level)
    const damage = closureActive
      ? Math.round(baseDamage * (1 + CLOSURE_BONUS_DAMAGE))
      : baseDamage

    // Consume closureActive after use
    if (closureActive) {
      caster = removeBuff(caster, 'closureActive')
      caster = removeBuff(caster, 'closureCasts')
    }

    const updatedTarget = dealDamage(targetPlayer, damage, 'magical')

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
            damage,
            damageType: 'magical',
            closureActive,
          },
        },
      ],
    }
  })
}

// W: Return — apply returnMark buff to self recording current zone
function resolveW(
  state: GameState,
  player: PlayerState,
  level: number,
): Effect.Effect<AbilityResult, AbilityError> {
  return Effect.gen(function* () {
    const closureActive = hasBuff(player, 'closureActive')
    const manaCost = closureActive ? 0 : scaleValue(W_MANA, level)
    if (player.mp < manaCost) {
      return yield* Effect.fail(
        new InsufficientManaError({ required: manaCost, current: player.mp }),
      )
    }

    let caster = manaCost > 0 ? deductMana(player, manaCost) : player
    caster = setCooldown(caster, 'w', W_COOLDOWN)

    // Consume closureActive after use
    if (closureActive) {
      caster = removeBuff(caster, 'closureActive')
      caster = removeBuff(caster, 'closureCasts')
    }

    caster = applyBuff(caster, {
      id: 'returnMark',
      stacks: 1,
      ticksRemaining: 6,
      source: player.zone, // Store the zone in source for retrieval
    })

    return {
      state: updatePlayer(state, caster),
      events: [
        {
          tick: state.tick,
          type: 'ability_cast',
          payload: {
            playerId: player.id,
            ability: 'w',
            buff: 'returnMark',
            zone: player.zone,
          },
        },
      ],
    }
  })
}

// E: Map — AoE slow + magic damage to all enemies in zone
function resolveE(
  state: GameState,
  player: PlayerState,
  level: number,
): Effect.Effect<AbilityResult, AbilityError> {
  return Effect.gen(function* () {
    const closureActive = hasBuff(player, 'closureActive')
    const manaCost = closureActive ? 0 : scaleValue(E_MANA, level)
    if (player.mp < manaCost) {
      return yield* Effect.fail(
        new InsufficientManaError({ required: manaCost, current: player.mp }),
      )
    }

    let caster = manaCost > 0 ? deductMana(player, manaCost) : player
    caster = setCooldown(caster, 'e', E_COOLDOWN)

    const enemies = getEnemiesInZone(state, player)
    const baseDamage = scaleValue(E_DAMAGE, level)
    const damage = closureActive
      ? Math.round(baseDamage * (1 + CLOSURE_BONUS_DAMAGE))
      : baseDamage

    // Consume closureActive after use
    if (closureActive) {
      caster = removeBuff(caster, 'closureActive')
      caster = removeBuff(caster, 'closureCasts')
    }

    const updatedEnemies = enemies.map((e) => {
      let updated = dealDamage(e, damage, 'magical')
      updated = applyBuff(updated, {
        id: 'slow',
        stacks: E_SLOW_PERCENT,
        ticksRemaining: E_SLOW_DURATION,
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
            ability: 'e',
            damage,
            damageType: 'magical',
            targets: enemies.map((e) => e.id),
            slow: E_SLOW_PERCENT,
            slowDuration: E_SLOW_DURATION,
          },
        },
      ],
    }
  })
}

// R: Reduce — big single-target magic burst. Stun for 1 tick if closureActive.
function resolveR(
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

    const closureActive = hasBuff(player, 'closureActive')
    const manaCost = closureActive ? 0 : scaleValue(R_MANA, level)
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

    let caster = manaCost > 0 ? deductMana(player, manaCost) : player
    caster = setCooldown(caster, 'r', R_COOLDOWN)

    const baseDamage = scaleValue(R_DAMAGE, level)
    const damage = closureActive
      ? Math.round(baseDamage * (1 + CLOSURE_BONUS_DAMAGE))
      : baseDamage

    let updatedTarget = dealDamage(targetPlayer, damage, 'magical')

    // Stun for 1 tick if closureActive
    if (closureActive) {
      updatedTarget = applyBuff(updatedTarget, {
        id: 'stun',
        stacks: 1,
        ticksRemaining: 1,
        source: player.id,
      })
    }

    // Consume closureActive after use
    if (closureActive) {
      caster = removeBuff(caster, 'closureActive')
      caster = removeBuff(caster, 'closureCasts')
    }

    return {
      state: updatePlayers(state, [caster, updatedTarget]),
      events: [
        {
          tick: state.tick,
          type: 'ability_cast',
          payload: {
            playerId: player.id,
            ability: 'r',
            targetId: targetPlayer.id,
            damage,
            damageType: 'magical',
            closureActive,
            stun: closureActive,
          },
        },
      ],
    }
  })
}

// ── Passive: Closure ──────────────────────────────────────────────
// Track casts. After 3 casts within 4 ticks, next ability costs no mana
// and deals 30% bonus damage.

function resolveHeroPassive(state: GameState, playerId: string, event: GameEvent): GameState {
  if (event.type !== 'ability_cast' || event.payload['playerId'] !== playerId) return state

  const player = state.players[playerId]
  if (!player || !player.alive) return state

  // Don't track if closureActive is already present
  if (hasBuff(player, 'closureActive')) return state

  const currentCasts = getBuffStacks(player, 'closureCasts')
  const newCasts = currentCasts + 1

  let updated: PlayerState
  if (newCasts >= CLOSURE_CASTS_REQUIRED) {
    // Activate Closure — next ability is free + bonus damage
    updated = applyBuff(player, {
      id: 'closureActive',
      stacks: 1,
      ticksRemaining: 10, // generous window to use it
      source: playerId,
    })
    // Keep closureCasts to track state but reset
    updated = applyBuff(updated, {
      id: 'closureCasts',
      stacks: CLOSURE_CASTS_REQUIRED,
      ticksRemaining: CLOSURE_WINDOW_TICKS,
      source: playerId,
    })
  } else {
    // Increment cast counter
    updated = applyBuff(player, {
      id: 'closureCasts',
      stacks: newCasts,
      ticksRemaining: CLOSURE_WINDOW_TICKS,
      source: playerId,
    })
  }

  return updatePlayer(state, updated)
}

registerHero('lambda', resolveHeroAbility, resolveHeroPassive)

export { resolveHeroAbility, resolveHeroPassive }
