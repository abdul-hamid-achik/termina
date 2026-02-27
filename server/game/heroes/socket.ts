import { Effect } from 'effect'
import type { GameState, PlayerState, GameEvent } from '~~/shared/types/game'
import type { TargetRef } from '~~/shared/types/commands'
import { areAdjacent, findPath } from '~~/server/game/map/topology'
import {
  type AbilitySlot,
  type AbilityResult,
  type AbilityError,
  InsufficientManaError,
  InvalidTargetError,
  registerHero,
  scaleValue,
  findTargetPlayer,
  getAllEnemyPlayers,
  deductMana,
  setCooldown,
  applyBuff,
  updatePlayer,
  updatePlayers,
} from './_base'

// ── Scaling Values ────────────────────────────────────────────────

const Q_MANA = [80, 100, 120, 140] as const
const Q_COOLDOWN = 12

const W_DAMAGE = [80, 120, 160, 200] as const
const W_MANA = [60, 80, 100, 120] as const
const W_COOLDOWN = 16

const E_MANA = [100, 130, 160, 190] as const
const E_COOLDOWN = 20

const R_MANA = [200, 300, 400] as const
const R_COOLDOWN = 55

const HANDSHAKE_VISION_TICKS = 5

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

// Q: Bind — root target hero for 2 ticks (can't move but can attack/cast)
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

    const rooted = applyBuff(targetPlayer, {
      id: 'root',
      stacks: 1,
      ticksRemaining: 2,
      source: player.id,
    })

    return {
      state: updatePlayers(state, [caster, rooted]),
      events: [
        {
          tick: state.tick,
          type: 'ability_cast',
          payload: {
            playerId: player.id,
            ability: 'q',
            targetId: targetPlayer.id,
            effect: 'root',
            duration: 2,
          },
        },
      ],
    }
  })
}

// W: Listen — place invisible trap in current zone
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

    const damage = scaleValue(W_DAMAGE, level)

    return {
      state: updatePlayer(state, caster),
      events: [
        {
          tick: state.tick,
          type: 'ability_cast',
          payload: {
            playerId: player.id,
            ability: 'w',
            zone: player.zone,
            effect: 'trap',
          },
        },
        {
          tick: state.tick,
          type: 'trap_placed',
          payload: {
            owner: player.id,
            team: player.team,
            zone: player.zone,
            damage,
            revealDuration: 2,
            expiryTick: state.tick + 30,
          },
        },
      ],
    }
  })
}

// E: Accept — pull target enemy hero 1 zone toward you (must be adjacent)
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
    if (!targetPlayer || !targetPlayer.alive) {
      return yield* Effect.fail(
        new InvalidTargetError({ target: target.name, reason: 'Target not found or dead' }),
      )
    }

    // Must be in adjacent zone
    if (!areAdjacent(player.zone, targetPlayer.zone)) {
      return yield* Effect.fail(
        new InvalidTargetError({ target: target.name, reason: 'Target must be in adjacent zone' }),
      )
    }

    let caster = deductMana(player, manaCost)
    caster = setCooldown(caster, 'e', E_COOLDOWN)

    // Pull target 1 zone toward caster
    const path = findPath(targetPlayer.zone, player.zone)
    const newZone = path.length >= 2 ? path[1]! : player.zone
    const pulled = { ...targetPlayer, zone: newZone }

    return {
      state: updatePlayers(state, [caster, pulled]),
      events: [
        {
          tick: state.tick,
          type: 'ability_cast',
          payload: {
            playerId: player.id,
            ability: 'e',
            targetId: targetPlayer.id,
            effect: 'pull',
            fromZone: targetPlayer.zone,
            toZone: newZone,
          },
        },
      ],
    }
  })
}

// R: Broadcast — all enemy heroes on map lose 1 movement speed for 3 ticks
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

    const allEnemies = getAllEnemyPlayers(state, player)
    const slowed = allEnemies.map((e) =>
      applyBuff(e, {
        id: 'broadcast_slow',
        stacks: 1, // -1 move speed
        ticksRemaining: 3,
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
            ability: 'r',
            effect: 'global_slow',
            targets: allEnemies.map((e) => e.id),
          },
        },
      ],
    }
  })
}

// ── Passive: Handshake ────────────────────────────────────────────
// When you attack a hero, gain vision of them for 5 ticks.

function resolveHeroPassive(state: GameState, playerId: string, event: GameEvent): GameState {
  if (event.type !== 'attack' || event.payload['attackerId'] !== playerId) return state

  const player = state.players[playerId]
  if (!player) return state

  const targetId = event.payload['targetId'] as string
  const targetPlayer = state.players[targetId]
  if (!targetPlayer || targetPlayer.heroId === null) return state

  // Grant vision buff tracking this target
  const updated = applyBuff(player, {
    id: `handshake_vision_${targetId}`,
    stacks: 1,
    ticksRemaining: HANDSHAKE_VISION_TICKS,
    source: targetId,
  })

  return updatePlayer(state, updated)
}

registerHero('socket', resolveHeroAbility, resolveHeroPassive)

export { resolveHeroAbility, resolveHeroPassive }
