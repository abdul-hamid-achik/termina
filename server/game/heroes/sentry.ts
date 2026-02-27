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

const Q_MANA = 50
const Q_COOLDOWN = 10

const W_MANA = [80, 100, 120, 140] as const
const W_COOLDOWN = 14

const E_HEAL = [100, 160, 220, 280] as const
const E_MANA = [60, 80, 100, 120] as const
const E_COOLDOWN = 6

const R_MANA = [250, 350, 450] as const
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
      return resolveQ(state, player, target)
    case 'w':
      return resolveW(state, player, level)
    case 'e':
      return resolveE(state, player, level, target)
    case 'r':
      return resolveR(state, player, level, target)
  }
}

// Q: Ping — reveal target zone for 3 ticks (add temporary ward)
function resolveQ(
  state: GameState,
  player: PlayerState,
  target?: TargetRef,
): Effect.Effect<AbilityResult, AbilityError> {
  return Effect.gen(function* () {
    if (player.mp < Q_MANA) {
      return yield* Effect.fail(new InsufficientManaError({ required: Q_MANA, current: player.mp }))
    }

    // Target is a zone — encoded as hero target with zone name
    const zoneId =
      target?.kind === 'hero' ? target.name : target?.kind === 'self' ? player.zone : undefined
    if (!zoneId) {
      return yield* Effect.fail(
        new InvalidTargetError({ target: 'none', reason: 'Requires a zone target' }),
      )
    }

    let caster = deductMana(player, Q_MANA)
    caster = setCooldown(caster, 'q', Q_COOLDOWN)

    // Add temporary ward to the target zone
    const zoneState = state.zones[zoneId]
    const updatedZones = { ...state.zones }
    if (zoneState) {
      updatedZones[zoneId] = {
        ...zoneState,
        wards: [
          ...zoneState.wards,
          { team: player.team, placedTick: state.tick, expiryTick: state.tick + 3 },
        ],
      }
    }

    return {
      state: { ...updatePlayer(state, caster), zones: updatedZones },
      events: [
        {
          tick: state.tick,
          type: 'ability_cast',
          payload: { playerId: player.id, ability: 'q', zone: zoneId },
        },
      ],
    }
  })
}

// W: Firewall — all allies in zone gain 30% damage reduction for 2 ticks
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

    // Apply firewall buff to self and all allies in zone
    const allies = getAlliesInZone(state, player)
    const allAffected = [caster, ...allies].map((p) =>
      applyBuff(p, {
        id: 'firewallDefense',
        stacks: 1,
        ticksRemaining: 2,
        source: player.id,
      }),
    )

    return {
      state: updatePlayers(state, allAffected),
      events: [
        {
          tick: state.tick,
          type: 'ability_cast',
          payload: {
            playerId: player.id,
            ability: 'w',
            targets: allAffected.map((a) => a.id),
          },
        },
      ],
    }
  })
}

// E: Patch — heal target ally
function resolveE(
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

    const manaCost = scaleValue(E_MANA, level)
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
    caster = setCooldown(caster, 'e', E_COOLDOWN)

    const healAmount = scaleValue(E_HEAL, level)
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
            ability: 'e',
            targetId: targetPlayer.id,
            heal: healAmount,
          },
        },
      ],
    }
  })
}

// R: Lockdown — silence all enemies in target zone for 3 ticks
function resolveR(
  state: GameState,
  player: PlayerState,
  level: number,
  target?: TargetRef,
): Effect.Effect<AbilityResult, AbilityError> {
  return Effect.gen(function* () {
    const manaCost = scaleValue(R_MANA, level)
    if (player.mp < manaCost) {
      return yield* Effect.fail(
        new InsufficientManaError({ required: manaCost, current: player.mp }),
      )
    }

    const zoneId =
      target?.kind === 'hero' ? target.name : target?.kind === 'self' ? player.zone : undefined
    if (!zoneId) {
      return yield* Effect.fail(
        new InvalidTargetError({ target: 'none', reason: 'Requires a zone target' }),
      )
    }

    let caster = deductMana(player, manaCost)
    caster = setCooldown(caster, 'r', R_COOLDOWN)

    const enemies = getEnemiesInZone(state, player, zoneId)
    const silenced = enemies.map((e) =>
      applyBuff(e, {
        id: 'silence',
        stacks: 1,
        ticksRemaining: 3,
        source: player.id,
      }),
    )

    return {
      state: updatePlayers(state, [caster, ...silenced]),
      events: [
        {
          tick: state.tick,
          type: 'ability_cast',
          payload: {
            playerId: player.id,
            ability: 'r',
            zone: zoneId,
            targets: enemies.map((e) => e.id),
          },
        },
      ],
    }
  })
}

// ── Passive: Watchtower ───────────────────────────────────────────
// Extends vision by +1 zone. Implemented as a buff check in VisionCalculator.

function resolveHeroPassive(state: GameState, playerId: string, _event: GameEvent): GameState {
  // Watchtower is a permanent passive — ensure the buff exists
  const player = state.players[playerId]
  if (!player) return state

  if (!player.buffs.some((b) => b.id === 'watchtower')) {
    const updated = applyBuff(player, {
      id: 'watchtower',
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
