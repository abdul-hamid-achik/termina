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
  updatePlayer,
  updatePlayers,
} from './_base'

// ── Scaling Values ────────────────────────────────────────────────

const Q_DAMAGE = [80, 115, 150, 185] as const
const Q_MANA = [45, 60, 75, 90] as const
const Q_COOLDOWN = 5

const W_MANA = [75, 90, 105, 120] as const
const W_COOLDOWN = 12

const E_MANA = [60, 75, 90, 105] as const
const E_COOLDOWN = 14

const R_TOTAL_DAMAGE = [180, 270, 360] as const
const R_SLOW_PERCENT = 40
const R_MANA = [200, 280, 360] as const
const R_COOLDOWN = 50

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
      return resolveW(state, player, level, target)
    case 'e':
      return resolveE(state, player, level)
    case 'r':
      return resolveR(state, player, level)
  }
}

// Q: ICMP Echo — magic damage to target in same zone
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
          },
        },
      ],
    }
  })
}

// W: Timeout — silence 1 tick + attack reduction debuff (-20%) for 3 ticks
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

    let updatedTarget = applyBuff(targetPlayer, {
      id: 'silence',
      stacks: 1,
      ticksRemaining: 1,
      source: player.id,
    })
    updatedTarget = applyBuff(updatedTarget, {
      id: 'attackReduction',
      stacks: 20, // 20% reduction
      ticksRemaining: 3,
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
            ability: 'w',
            targetId: targetPlayer.id,
            effect: 'silence',
            silenceDuration: 1,
            attackReduction: 20,
            attackReductionDuration: 3,
          },
        },
      ],
    }
  })
}

// E: Tracepath — self-buff: reveal (vision) + move speed for 3 ticks
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

    caster = applyBuff(caster, {
      id: 'tracepath_vision',
      stacks: 1,
      ticksRemaining: 3,
      source: player.id,
    })
    caster = applyBuff(caster, {
      id: 'tracepath_speed',
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
            ability: 'e',
            buff: 'tracepath',
            visionDuration: 3,
            speedDuration: 2,
          },
        },
      ],
    }
  })
}

// R: Flood — AoE DoT to all enemies in zone (damage over 3 ticks) + slow 40% for 3 ticks
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
    const totalDamage = scaleValue(R_TOTAL_DAMAGE, level)
    const dotPerTick = Math.round(totalDamage / 3)

    const updatedEnemies = enemies.map((e) => {
      let target = applyBuff(e, {
        id: 'flood_dot',
        stacks: dotPerTick,
        ticksRemaining: 3,
        source: player.id,
      })
      target = applyBuff(target, {
        id: 'slow',
        stacks: R_SLOW_PERCENT,
        ticksRemaining: 3,
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
            effect: 'flood',
            dotTotal: totalDamage,
            dotPerTick,
            dotDuration: 3,
            slowPercent: R_SLOW_PERCENT,
            targets: enemies.map((e) => e.id),
          },
        },
      ],
    }
  })
}

// ── Passive: Latency ─────────────────────────────────────────────
// On attack by this player, add 'latency' debuff to target (+1 tick to next cooldown).

function resolveHeroPassive(state: GameState, playerId: string, event: GameEvent): GameState {
  if (event.type !== 'attack' || event.payload['attackerId'] !== playerId) return state

  const player = state.players[playerId]
  if (!player) return state

  const targetId = event.payload['targetId'] as string
  const targetPlayer = state.players[targetId]
  if (!targetPlayer || !targetPlayer.alive) return state

  const updated = applyBuff(targetPlayer, {
    id: 'latency',
    stacks: 1,
    ticksRemaining: 1,
    source: playerId,
  })

  return updatePlayer(state, updated)
}

registerHero('ping', resolveHeroAbility, resolveHeroPassive)

export { resolveHeroAbility, resolveHeroPassive }
