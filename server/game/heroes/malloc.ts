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
  getBuffStacks,
  updatePlayer,
  updatePlayers,
} from './_base'

// ── Scaling Values ────────────────────────────────────────────────

const Q_MANA = [60, 80, 100, 120] as const
const Q_COOLDOWN = 8

const W_DAMAGE = [110, 160, 210, 260] as const
const W_MANA = [70, 90, 110, 130] as const
const W_COOLDOWN = 7
const W_LOW_HP_BONUS = 0.4 // 40% bonus below 30% HP
const W_THRESHOLD = 0.3

const E_DAMAGE = [75, 115, 155, 195] as const
const E_MANA = [80, 100, 120, 140] as const
const E_COOLDOWN = 12

const R_DAMAGE = [280, 420, 560] as const
const R_MANA = [150, 250, 350] as const
const R_COOLDOWN = 50

const HEAP_GROWTH_PER_100_GOLD = 1

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
      return resolveQ(state, player, level)
    case 'w':
      return resolveW(state, player, level, target)
    case 'e':
      return resolveE(state, player, level, target)
    case 'r':
      return resolveR(state, player, level)
  }
}

// Q: Allocate — self buff +25 attack for 3 ticks
function resolveQ(
  state: GameState,
  player: PlayerState,
  level: number,
): Effect.Effect<AbilityResult, AbilityError> {
  return Effect.gen(function* () {
    const manaCost = scaleValue(Q_MANA, level)
    if (player.mp < manaCost) {
      return yield* Effect.fail(
        new InsufficientManaError({ required: manaCost, current: player.mp }),
      )
    }

    let caster = deductMana(player, manaCost)
    caster = setCooldown(caster, 'q', Q_COOLDOWN)
    caster = applyBuff(caster, {
      id: 'allocate',
      stacks: 25,
      ticksRemaining: 3,
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
            ability: 'q',
            buff: 'allocate',
            value: 25,
            duration: 3,
          },
        },
      ],
    }
  })
}

// W: Free() — physical damage, 40% bonus if target below 30% HP
function resolveW(
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

    const manaCost = scaleValue(W_MANA, level)
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
    caster = setCooldown(caster, 'w', W_COOLDOWN)

    let damage = scaleValue(W_DAMAGE, level)
    const hpPercent = targetPlayer.hp / targetPlayer.maxHp
    if (hpPercent < W_THRESHOLD) {
      damage = Math.round(damage * (1 + W_LOW_HP_BONUS))
    }

    const updatedTarget = dealDamage(targetPlayer, damage, 'physical')

    return {
      state: updatePlayers(state, [caster, updatedTarget]),
      events: [
        {
          tick: state.tick,
          type: 'ability_cast',
          payload: {
            playerId: player.id,
            ability: 'w',
            targetId: targetPlayer.id,
            damage,
            damageType: 'physical',
            lowHpBonus: hpPercent < W_THRESHOLD,
          },
        },
      ],
    }
  })
}

// E: Pointer Dereference — dash to enemy, physical damage + stun 1 tick
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
    let updatedTarget = dealDamage(targetPlayer, damage, 'physical')
    updatedTarget = applyBuff(updatedTarget, {
      id: 'stun',
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
            ability: 'e',
            targetId: targetPlayer.id,
            damage,
            damageType: 'physical',
            effect: 'stun',
            duration: 1,
          },
        },
      ],
    }
  })
}

// R: Stack Overflow — AoE physical damage to all enemies in zone
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
    const damage = scaleValue(R_DAMAGE, level)
    const updatedEnemies = enemies.map((e) => dealDamage(e, damage, 'physical'))

    return {
      state: updatePlayers(state, [caster, ...updatedEnemies]),
      events: [
        {
          tick: state.tick,
          type: 'ability_cast',
          payload: {
            playerId: player.id,
            ability: 'r',
            damage,
            damageType: 'physical',
            targets: enemies.map((e) => e.id),
          },
        },
      ],
    }
  })
}

// ── Passive: Heap Growth ────────────────────────────────────────
// +1 attack per 100 gold. Applied as a buff with stacks = bonus attack.

function resolveHeroPassive(state: GameState, playerId: string, _event: GameEvent): GameState {
  const player = state.players[playerId]
  if (!player) return state

  const bonusAttack = Math.floor(player.gold / 100) * HEAP_GROWTH_PER_100_GOLD
  const currentBonus = getBuffStacks(player, 'heapGrowth')

  if (currentBonus !== bonusAttack) {
    const updated = applyBuff(player, {
      id: 'heapGrowth',
      stacks: bonusAttack,
      ticksRemaining: 9999,
      source: playerId,
    })
    return updatePlayer(state, updated)
  }

  return state
}

/** Get bonus attack from Heap Growth passive. */
export function getHeapGrowthBonus(player: PlayerState): number {
  return getBuffStacks(player, 'heapGrowth')
}

registerHero('malloc', resolveHeroAbility, resolveHeroPassive)

export { resolveHeroAbility, resolveHeroPassive }
