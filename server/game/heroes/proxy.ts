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
  getAlliesInZone,
  healPlayer,
  dealDamage,
  deductMana,
  setCooldown,
  applyBuff,
  updatePlayer,
  updatePlayers,
} from './_base'

// ── Scaling Values ────────────────────────────────────────────────

const Q_DAMAGE = [85, 125, 165, 205] as const
const Q_MANA = [70, 90, 110, 130] as const
const Q_COOLDOWN = 8

const W_SHIELD = [140, 200, 260, 320] as const
const W_MANA = [90, 110, 130, 150] as const
const W_COOLDOWN = 12

const E_HEAL = [180, 260, 340, 420] as const
const E_MANA = [100, 130, 160, 190] as const
const E_COOLDOWN = 10

const R_MANA = [200, 300, 400] as const
const R_COOLDOWN = 50

const MIDDLEMAN_REDIRECT = 0.12 // 12%

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
      return resolveR(state, player, level, target)
  }
}

// Q: Packet Redirect — magic damage + slow
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
    let updatedTarget = dealDamage(targetPlayer, damage, 'magical')
    updatedTarget = applyBuff(updatedTarget, {
      id: 'slow',
      stacks: 25,
      ticksRemaining: 2,
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
            damageType: 'magical',
          },
        },
      ],
    }
  })
}

// W: Cache Shield — shield an allied hero
function resolveW(
  state: GameState,
  player: PlayerState,
  level: number,
  target?: TargetRef,
): Effect.Effect<AbilityResult, AbilityError> {
  return Effect.gen(function* () {
    if (!target || (target.kind !== 'hero' && target.kind !== 'self')) {
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

    const targetPlayer = target.kind === 'self' ? player : findTargetPlayer(state, target)
    if (!targetPlayer || !targetPlayer.alive || targetPlayer.zone !== player.zone) {
      return yield* Effect.fail(
        new InvalidTargetError({
          target: target.kind === 'hero' ? target.name : 'self',
          reason: 'Target not in same zone or dead',
        }),
      )
    }

    let caster = deductMana(player, manaCost)
    caster = setCooldown(caster, 'w', W_COOLDOWN)

    const shieldAmount = scaleValue(W_SHIELD, level)
    const shielded =
      targetPlayer.id === player.id
        ? applyBuff(caster, {
            id: 'shield',
            stacks: shieldAmount,
            ticksRemaining: 3,
            source: player.id,
          })
        : applyBuff(targetPlayer, {
            id: 'shield',
            stacks: shieldAmount,
            ticksRemaining: 3,
            source: player.id,
          })

    const players = targetPlayer.id === player.id ? [shielded] : [caster, shielded]

    return {
      state: updatePlayers(state, players),
      events: [
        {
          tick: state.tick,
          type: 'ability_cast',
          payload: {
            playerId: player.id,
            ability: 'w',
            targetId: targetPlayer.id,
            shield: shieldAmount,
            duration: 3,
          },
        },
      ],
    }
  })
}

// E: Load Balance — heal all allies in zone (split total)
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

    const allies = getAlliesInZone(state, player)
    const allTargets = [caster, ...allies]
    const totalHeal = scaleValue(E_HEAL, level)
    const healPerTarget = Math.round(totalHeal / allTargets.length)

    const healed = allTargets.map((p) => {
      if (p.id === caster.id) return healPlayer(caster, healPerTarget)
      return healPlayer(p, healPerTarget)
    })

    return {
      state: updatePlayers(state, healed),
      events: [
        {
          tick: state.tick,
          type: 'ability_cast',
          payload: {
            playerId: player.id,
            ability: 'e',
            heal: totalHeal,
            targets: allTargets.map((a) => a.id),
          },
        },
      ],
    }
  })
}

// R: Reverse Proxy — swap positions with allied hero, both gain invulnerability
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

    const manaCost = scaleValue(R_MANA, level)
    if (player.mp < manaCost) {
      return yield* Effect.fail(
        new InsufficientManaError({ required: manaCost, current: player.mp }),
      )
    }

    const targetPlayer = findTargetPlayer(state, target)
    if (!targetPlayer || !targetPlayer.alive) {
      return yield* Effect.fail(
        new InvalidTargetError({ target: target.name, reason: 'Target not found or dead' }),
      )
    }

    // Must be an ally
    if (targetPlayer.team !== player.team) {
      return yield* Effect.fail(
        new InvalidTargetError({ target: target.name, reason: 'Target must be an ally' }),
      )
    }

    let caster = deductMana(player, manaCost)
    caster = setCooldown(caster, 'r', R_COOLDOWN)

    // Swap zones
    const casterZone = caster.zone
    const targetZone = targetPlayer.zone
    caster = { ...caster, zone: targetZone }
    let swappedTarget = { ...targetPlayer, zone: casterZone }

    // Both gain invulnerability
    caster = applyBuff(caster, {
      id: 'invulnerable',
      stacks: 1,
      ticksRemaining: 1,
      source: player.id,
    })
    swappedTarget = applyBuff(swappedTarget, {
      id: 'invulnerable',
      stacks: 1,
      ticksRemaining: 1,
      source: player.id,
    })

    return {
      state: updatePlayers(state, [caster, swappedTarget]),
      events: [
        {
          tick: state.tick,
          type: 'ability_cast',
          payload: {
            playerId: player.id,
            ability: 'r',
            targetId: targetPlayer.id,
            effect: 'swap',
            fromZone: casterZone,
            toZone: targetZone,
          },
        },
      ],
    }
  })
}

// ── Passive: Middleman ──────────────────────────────────────────
// Redirect 12% of damage dealt to nearest ally to Proxy instead.
// Implemented as a buff on Proxy that DamageCalculator can check.

function resolveHeroPassive(state: GameState, playerId: string, _event: GameEvent): GameState {
  const player = state.players[playerId]
  if (!player) return state

  // Ensure middleman buff is always present
  if (!player.buffs.some((b) => b.id === 'middleman')) {
    const updated = applyBuff(player, {
      id: 'middleman',
      stacks: Math.round(MIDDLEMAN_REDIRECT * 100),
      ticksRemaining: 9999,
      source: playerId,
    })
    return updatePlayer(state, updated)
  }

  return state
}

registerHero('proxy', resolveHeroAbility, resolveHeroPassive)

export { resolveHeroAbility, resolveHeroPassive }
