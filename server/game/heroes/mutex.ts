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

const Q_DAMAGE = [90, 130, 170, 210] as const
const Q_MANA = [60, 75, 90, 105] as const
const Q_COOLDOWN = 8

const W_SHIELD = [180, 240, 300, 360] as const
const W_DEFENSE_BONUS = 10
const W_MANA = [70, 85, 100, 115] as const
const W_COOLDOWN = 12

const E_DAMAGE = [40, 55, 70, 85] as const
const E_SLOW_PERCENT = 10
const E_MANA = [50, 65, 80, 95] as const
const E_COOLDOWN = 10

const R_DAMAGE = [150, 225, 300] as const
const R_BONUS_PER_STACK = 30
const R_MANA = [200, 280, 360] as const
const R_COOLDOWN = 50

const DEADLOCK_MAX_STACKS = 5
const DEADLOCK_DEFENSE_PER_STACK = 1
const DEADLOCK_ATTACK_PER_STACK = 3

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
      return resolveR(state, player, level)
  }
}

// Q: Lock — physical damage + root for 1 tick
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

    const damage = scaleValue(Q_DAMAGE, level)
    let updatedTarget = dealDamage(targetPlayer, damage, 'physical')
    updatedTarget = applyBuff(updatedTarget, {
      id: 'root',
      stacks: 1,
      ticksRemaining: 1,
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
            ability: 'q',
            targetId: targetPlayer.id,
            damage,
            damageType: 'physical',
            effect: 'root',
            duration: 1,
          },
        },
      ],
    }
  })
}

// W: Critical Section — self-shield + bonus defense + self-root for 2 ticks
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

    let caster = deductMana(player, manaCost)
    caster = setCooldown(caster, 'w', W_COOLDOWN)

    const shieldAmount = scaleValue(W_SHIELD, level)
    caster = applyBuff(caster, {
      id: 'shield',
      stacks: shieldAmount,
      ticksRemaining: 2,
      source: player.id,
    })
    caster = applyBuff(caster, {
      id: 'criticalSectionDefense',
      stacks: W_DEFENSE_BONUS,
      ticksRemaining: 2,
      source: player.id,
    })
    caster = applyBuff(caster, {
      id: 'root',
      stacks: 1,
      ticksRemaining: 2,
      source: player.id,
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
            shield: shieldAmount,
            defenseBonus: W_DEFENSE_BONUS,
            effect: 'self_root',
            duration: 2,
          },
        },
      ],
    }
  })
}

// E: Spinlock — AoE 3 hits to all enemies in zone with stacking slow
function resolveE(
  state: GameState,
  player: PlayerState,
  level: number,
): Effect.Effect<AbilityResult, AbilityError> {
  return Effect.gen(function* () {
    const manaCost = scaleValue(E_MANA, level)
    if (player.mp < manaCost) {
      return yield* Effect.fail(
        new InsufficientManaError({ required: manaCost, current: player.mp }),
      )
    }

    let caster = deductMana(player, manaCost)
    caster = setCooldown(caster, 'e', E_COOLDOWN)

    const enemies = getEnemiesInZone(state, player)
    const damagePerHit = scaleValue(E_DAMAGE, level)

    const updatedEnemies = enemies.map((e) => {
      let target = e
      // Apply 3 hits with stacking slow
      for (let i = 1; i <= 3; i++) {
        target = dealDamage(target, damagePerHit, 'physical')
        target = applyBuff(target, {
          id: 'slow',
          stacks: E_SLOW_PERCENT * i,
          ticksRemaining: 2,
          source: player.id,
        })
      }
      return target
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
            damagePerHit,
            hits: 3,
            damageType: 'physical',
            effect: 'slow',
            targets: enemies.map((e) => e.id),
          },
        },
      ],
    }
  })
}

// R: Priority Inversion — AoE fear 2 ticks + physical damage + bonus per Deadlock stack
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

    let caster = deductMana(player, manaCost)
    caster = setCooldown(caster, 'r', R_COOLDOWN)

    const enemies = getEnemiesInZone(state, player)
    const deadlockStacks = getBuffStacks(player, 'deadlock')
    const baseDamage = scaleValue(R_DAMAGE, level)
    const totalDamage = baseDamage + deadlockStacks * R_BONUS_PER_STACK

    const updatedEnemies = enemies.map((e) => {
      let target = dealDamage(e, totalDamage, 'physical')
      target = applyBuff(target, {
        id: 'feared',
        stacks: 1,
        ticksRemaining: 2,
        source: player.id,
      })
      return target
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
            damage: totalDamage,
            damageType: 'physical',
            effect: 'fear',
            fearDuration: 2,
            deadlockStacks,
            targets: enemies.map((e) => e.id),
          },
        },
      ],
    }
  })
}

// ── Passive: Deadlock ─────────────────────────────────────────────
// +1 defense +3 attack per tick in same zone, max 5 stacks.
// On 'move' event for this player, reset stacks to 0.
// On 'tick_end' event, increment if player didn't move (check deadlockZone).

function resolveHeroPassive(state: GameState, playerId: string, event: GameEvent): GameState {
  const player = state.players[playerId]
  if (!player) return state

  // On move: reset deadlock stacks
  if (event.type === 'move' && event.payload['playerId'] === playerId) {
    let updated = removeBuff(player, 'deadlock')
    updated = removeBuff(updated, 'deadlockZone')
    return updatePlayer(state, updated)
  }

  // On tick_end: increment stacks if player stayed in same zone
  if (event.type === 'tick_end') {
    const lastZone = player.buffs.find((b) => b.id === 'deadlockZone')?.source
    const currentZone = player.zone

    if (lastZone === currentZone) {
      // Player stayed — increment stacks
      const currentStacks = getBuffStacks(player, 'deadlock')
      const newStacks = Math.min(currentStacks + 1, DEADLOCK_MAX_STACKS)
      let updated = applyBuff(player, {
        id: 'deadlock',
        stacks: newStacks,
        ticksRemaining: 9999,
        source: playerId,
      })
      updated = applyBuff(updated, {
        id: 'deadlockZone',
        stacks: 1,
        ticksRemaining: 9999,
        source: currentZone,
      })
      return updatePlayer(state, updated)
    } else {
      // Zone changed or first tick — set zone tracker, start at 0 stacks
      const updated = applyBuff(player, {
        id: 'deadlockZone',
        stacks: 1,
        ticksRemaining: 9999,
        source: currentZone,
      })
      return updatePlayer(state, updated)
    }
  }

  return state
}

/** Get bonus defense from Deadlock stacks. */
export function getDeadlockDefenseBonus(player: PlayerState): number {
  return getBuffStacks(player, 'deadlock') * DEADLOCK_DEFENSE_PER_STACK
}

/** Get bonus attack from Deadlock stacks. */
export function getDeadlockAttackBonus(player: PlayerState): number {
  return getBuffStacks(player, 'deadlock') * DEADLOCK_ATTACK_PER_STACK
}

registerHero('mutex', resolveHeroAbility, resolveHeroPassive)

export { resolveHeroAbility, resolveHeroPassive }
