import { Effect } from 'effect'
import type { GameState, PlayerState, GameEvent } from '~~/shared/types/game'
import type { TargetRef } from '~~/shared/types/commands'
import { getAdjacentZones } from '~~/server/game/map/topology'
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
  deductMana,
  setCooldown,
  applyBuff,
  updatePlayer,
  updatePlayers,
} from './_base'

// ── Scaling Values ────────────────────────────────────────────────

const Q_MANA = [80, 90, 100, 110] as const
const Q_COOLDOWN = 10

const W_SHIELD = [150, 250, 350, 450] as const
const W_MANA = [100, 120, 140, 160] as const
const W_COOLDOWN = 14

const E_MANA = [120, 140, 160, 180] as const
const E_COOLDOWN = 18

const R_MANA = [200, 300, 400] as const
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
      return resolveW(state, player, level)
    case 'e':
      return resolveE(state, player, level)
    case 'r':
      return resolveR(state, player, level)
  }
}

// Q: Interrupt — stun target hero for 1 tick
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

    const stunned = applyBuff(targetPlayer, {
      id: 'stun',
      stacks: 1,
      ticksRemaining: 1,
      source: player.id,
    })

    return {
      state: updatePlayers(state, [caster, stunned]),
      events: [
        {
          tick: state.tick,
          type: 'ability_cast',
          payload: {
            playerId: player.id,
            ability: 'q',
            targetId: targetPlayer.id,
            effect: 'stun',
            duration: 1,
          },
        },
      ],
    }
  })
}

// W: Buffer — shield self for HP amount, lasts 3 ticks
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

// E: Core Dump — taunt all enemies in zone for 2 ticks
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

// R: Panic — force all enemies in zone to move to random adjacent zone next tick
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
    const displaced = enemies.map((e) => {
      const adjacent = getAdjacentZones(e.zone)
      const randomZone = adjacent[Math.floor(Math.random() * adjacent.length)] ?? e.zone
      return applyBuff(
        { ...e, zone: randomZone },
        { id: 'feared', stacks: 1, ticksRemaining: 1, source: player.id },
      )
    })

    return {
      state: updatePlayers(state, [caster, ...displaced]),
      events: [
        {
          tick: state.tick,
          type: 'ability_cast',
          payload: {
            playerId: player.id,
            ability: 'r',
            effect: 'panic',
            targets: enemies.map((e) => e.id),
          },
        },
      ],
    }
  })
}

// ── Passive: Hardened ─────────────────────────────────────────────
// Permanently take 10% reduced damage. Applied via buff check in dealDamage.

function resolveHeroPassive(
  state: GameState,
  playerId: string,
  _event: GameEvent,
): GameState {
  const player = state.players[playerId]
  if (!player) return state

  // Ensure hardened buff is always present
  if (!player.buffs.some((b) => b.id === 'hardened')) {
    const updated = applyBuff(player, {
      id: 'hardened',
      stacks: 1,
      ticksRemaining: 9999,
      source: playerId,
    })
    return updatePlayer(state, updated)
  }

  return state
}

registerHero('kernel', resolveHeroAbility, resolveHeroPassive)

export { resolveHeroAbility, resolveHeroPassive }
