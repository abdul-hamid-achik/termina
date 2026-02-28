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
  hasBuff,
  updatePlayer,
  updatePlayers,
} from './_base'

// ── Scaling Values ────────────────────────────────────────────────

const Q_DAMAGE = [95, 140, 185, 230] as const
const Q_MANA = [70, 90, 110, 130] as const
const Q_COOLDOWN = 8

const W_SHIELD = [200, 300, 400, 500] as const
const W_MANA = [80, 100, 120, 140] as const
const W_COOLDOWN = 14

const E_MANA = [60, 80, 100, 120] as const
const E_COOLDOWN = 16

const R_DOT_TOTAL = [120, 200, 280] as const
const R_MANA = [250, 350, 450] as const
const R_COOLDOWN = 55

const PACKET_INSPECTION_REFLECT = 0.08 // 8%

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

// Q: Port Block — physical damage + stun 1 tick
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
            ability: 'q',
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

// W: DMZ — shield self for 3 ticks
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
            ability: 'w',
            shield: shieldAmount,
            duration: 3,
          },
        },
      ],
    }
  })
}

// E: Access Control — taunt all enemies in zone for 2 ticks
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
    const taunted = enemies.map((e) =>
      applyBuff(e, {
        id: 'taunt',
        stacks: 1,
        ticksRemaining: 2,
        source: player.id,
      }),
    )

    return {
      state: updatePlayers(state, [caster, ...taunted]),
      events: [
        {
          tick: state.tick,
          type: 'ability_cast',
          payload: {
            playerId: player.id,
            ability: 'e',
            effect: 'taunt',
            duration: 2,
            targets: enemies.map((e) => e.id),
          },
        },
      ],
    }
  })
}

// R: Deep Packet Inspection — root all enemies in zone for 2 ticks + DoT
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
    const totalDot = scaleValue(R_DOT_TOTAL, level)
    const dotPerTick = Math.round(totalDot / 3)

    const updatedEnemies = enemies.map((e) => {
      let updated = applyBuff(e, {
        id: 'root',
        stacks: 1,
        ticksRemaining: 2,
        source: player.id,
      })
      updated = applyBuff(updated, {
        id: 'dpi_dot',
        stacks: dotPerTick,
        ticksRemaining: 3,
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
            effect: 'deep_packet_inspection',
            rootDuration: 2,
            dotTotal: totalDot,
            dotDuration: 3,
            targets: enemies.map((e) => e.id),
          },
        },
      ],
    }
  })
}

// ── Passive: Packet Inspection ──────────────────────────────────
// Reflect 8% of damage taken as magical damage. Applied as a buff marker.

function resolveHeroPassive(state: GameState, playerId: string, event: GameEvent): GameState {
  const player = state.players[playerId]
  if (!player) return state

  // Ensure packetInspection buff is always present
  if (!hasBuff(player, 'packetInspection')) {
    const updated = applyBuff(player, {
      id: 'packetInspection',
      stacks: Math.round(PACKET_INSPECTION_REFLECT * 100),
      ticksRemaining: 9999,
      source: playerId,
    })
    return updatePlayer(state, updated)
  }

  // On damage_taken events, reflect 8% back
  if (event.type === 'damage_taken' && event.payload['targetId'] === playerId) {
    const attackerId = event.payload['attackerId'] as string
    const damage = event.payload['damage'] as number
    const attacker = state.players[attackerId]
    if (!attacker || !attacker.alive || !damage) return state

    const reflectDamage = Math.round(damage * PACKET_INSPECTION_REFLECT)
    if (reflectDamage <= 0) return state

    const updatedAttacker = dealDamage(attacker, reflectDamage, 'magical')
    return updatePlayer(state, updatedAttacker)
  }

  return state
}

registerHero('firewall', resolveHeroAbility, resolveHeroPassive)

export { resolveHeroAbility, resolveHeroPassive }
