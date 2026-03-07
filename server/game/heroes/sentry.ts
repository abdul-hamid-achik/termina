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
  getAlliesInZone,
  healPlayer,
  deductMana,
  setCooldown,
  applyBuff,
  updatePlayer,
  updatePlayers,
} from './_base'

// ── Scaling Values ────────────────────────────────────────────────

const Q_HEAL = [80, 120, 160, 200] as const
const Q_MANA = 80
const Q_COOLDOWN = [6, 5, 4, 3] as const

const W_SHIELD = [100, 150, 200, 250] as const
const W_MANA = 100
const W_COOLDOWN = [10, 9, 8, 7] as const
const W_DURATION = 3

const E_MANA = 70
const E_COOLDOWN = [12, 11, 10, 9] as const
const E_SLOW_VALUE = 30
const E_SLOW_DURATION = 2

const R_MANA = 250
const R_COOLDOWN = [60, 55, 50] as const
const R_SHIELD = 150
const R_DEFENSE_BONUS = 3
const R_DURATION = 4

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

// Q: Mend Protocol — heal ally
function resolveQ(
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

    if (player.mp < Q_MANA) {
      return yield* Effect.fail(new InsufficientManaError({ required: Q_MANA, current: player.mp }))
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

    let caster = deductMana(player, Q_MANA)
    caster = setCooldown(caster, 'q', scaleValue(Q_COOLDOWN, level))

    const healAmount = scaleValue(Q_HEAL, level)
    const healed =
      targetPlayer.id === player.id
        ? healPlayer(caster, healAmount)
        : healPlayer(targetPlayer, healAmount)

    const players = targetPlayer.id === player.id ? [healed] : [caster, healed]

    return {
      state: updatePlayers(state, players),
      events: [
        {
          tick: state.tick,
          type: 'ability_cast',
          payload: {
            playerId: player.id,
            ability: 'q',
            targetId: targetPlayer.id,
            heal: healAmount,
          },
        },
      ],
    }
  })
}

// W: Barrier — shield ally
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

    if (player.mp < W_MANA) {
      return yield* Effect.fail(new InsufficientManaError({ required: W_MANA, current: player.mp }))
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

    let caster = deductMana(player, W_MANA)
    caster = setCooldown(caster, 'w', scaleValue(W_COOLDOWN, level))

    const shieldAmount = scaleValue(W_SHIELD, level)

    if (targetPlayer.id === player.id) {
      caster = applyBuff(caster, {
        id: 'shield',
        stacks: shieldAmount,
        ticksRemaining: W_DURATION,
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
              targetId: targetPlayer.id,
              shield: shieldAmount,
              duration: W_DURATION,
            },
          },
        ],
      }
    }

    const shielded = applyBuff(targetPlayer, {
      id: 'shield',
      stacks: shieldAmount,
      ticksRemaining: W_DURATION,
      source: player.id,
    })

    return {
      state: updatePlayers(state, [caster, shielded]),
      events: [
        {
          tick: state.tick,
          type: 'ability_cast',
          payload: {
            playerId: player.id,
            ability: 'w',
            targetId: targetPlayer.id,
            shield: shieldAmount,
            duration: W_DURATION,
          },
        },
      ],
    }
  })
}

// E: Scan Pulse — reveal zone + slow enemies
function resolveE(
  state: GameState,
  player: PlayerState,
  level: number,
): Effect.Effect<AbilityResult, AbilityError> {
  return Effect.gen(function* () {
    if (player.mp < E_MANA) {
      return yield* Effect.fail(new InsufficientManaError({ required: E_MANA, current: player.mp }))
    }

    let caster = deductMana(player, E_MANA)
    caster = setCooldown(caster, 'e', scaleValue(E_COOLDOWN, level))

    const enemies = getEnemiesInZone(state, player)
    const slowed = enemies.map((e) =>
      applyBuff(e, {
        id: 'slow',
        stacks: E_SLOW_VALUE,
        ticksRemaining: E_SLOW_DURATION,
        source: player.id,
      }),
    )

    return {
      state: updatePlayers(state, [caster, ...slowed]),
      events: [
        {
          tick: state.tick,
          type: 'ability_cast',
          payload: {
            playerId: player.id,
            ability: 'e',
            zone: player.zone,
            effect: 'reveal',
            slow: E_SLOW_VALUE,
            duration: E_SLOW_DURATION,
            targets: enemies.map((e) => e.id),
          },
        },
      ],
    }
  })
}

// R: Fortify — all allies +3 defense, 150 shield
function resolveR(
  state: GameState,
  player: PlayerState,
  level: number,
): Effect.Effect<AbilityResult, AbilityError> {
  return Effect.gen(function* () {
    if (player.mp < R_MANA) {
      return yield* Effect.fail(new InsufficientManaError({ required: R_MANA, current: player.mp }))
    }

    let caster = deductMana(player, R_MANA)
    caster = setCooldown(caster, 'r', scaleValue(R_COOLDOWN, level))

    const allies = getAlliesInZone(state, player)
    const allAffected = [caster, ...allies].map((p) => {
      let updated = applyBuff(p, {
        id: 'shield',
        stacks: R_SHIELD,
        ticksRemaining: R_DURATION,
        source: player.id,
      })
      updated = applyBuff(updated, {
        id: 'defenseBuff',
        stacks: R_DEFENSE_BONUS,
        ticksRemaining: R_DURATION,
        source: player.id,
      })
      return updated
    })

    return {
      state: updatePlayers(state, allAffected),
      events: [
        {
          tick: state.tick,
          type: 'ability_cast',
          payload: {
            playerId: player.id,
            ability: 'r',
            shield: R_SHIELD,
            defense: R_DEFENSE_BONUS,
            duration: R_DURATION,
            targets: allAffected.map((a) => a.id),
          },
        },
      ],
    }
  })
}

// ── Passive: Overwatch ────────────────────────────────────────────
// Grants vision of adjacent zones. Allied heroes in same zone gain 5 bonus defense.

function resolveHeroPassive(state: GameState, playerId: string, _event: GameEvent): GameState {
  const player = state.players[playerId]
  if (!player) return state

  if (!player.buffs.some((b) => b.id === 'overwatch')) {
    const updated = applyBuff(player, {
      id: 'overwatch',
      stacks: 1,
      ticksRemaining: 9999,
      source: playerId,
    })
    return updatePlayer(state, updated)
  }

  return state
}

registerHero('sentry', resolveHeroAbility, resolveHeroPassive)

export { resolveHeroAbility, resolveHeroPassive }
