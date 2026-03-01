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
  getAllEnemyPlayers,
  dealDamage,
  deductMana,
  setCooldown,
  applyBuff,
  getBuffStacks,
  updatePlayer,
  updatePlayers,
} from './_base'

// ── Scaling Values ────────────────────────────────────────────────

const Q_DAMAGE = [100, 145, 190, 235] as const
const Q_MANA = [50, 65, 80, 95] as const
const Q_COOLDOWN = 8
const Q_ISOLATION_BONUS = 0.35

const W_MANA = [70, 85, 100, 115] as const
const W_COOLDOWN = 12
const W_ROOT_DURATION = 2

const E_MANA = [60, 75, 90, 105] as const
const E_COOLDOWN = 12
const E_SHADOW_DURATION = 2

const R_MANA = [200, 280, 360] as const
const R_COOLDOWN = 60
const R_REVEAL_DURATION = 3
const R_DAMAGE_BUFF_DURATION = 2
const R_DAMAGE_BUFF_PERCENT = 50

const HOP_COUNT_MAX_STACKS = 3
const HOP_COUNT_DAMAGE_PER_STACK = 0.2
const HOP_COUNT_DECAY_TICKS = 2

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

// Q: Probe — Physical damage to target. 35% bonus if target is isolated (no allies in zone).
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

    let damage = scaleValue(Q_DAMAGE, level)

    // Check isolation: target has no allies in their zone
    const targetAllies = getAlliesInZone(state, targetPlayer)
    const isolated = targetAllies.length === 0
    if (isolated) {
      damage = Math.round(damage * (1 + Q_ISOLATION_BONUS))
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
            ability: 'q',
            targetId: targetPlayer.id,
            damage,
            damageType: 'physical',
            isolated,
          },
        },
      ],
    }
  })
}

// W: TTL — Apply root debuff to target for 2 ticks
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

    const updatedTarget = applyBuff(targetPlayer, {
      id: 'root',
      stacks: 1,
      ticksRemaining: W_ROOT_DURATION,
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
            effect: 'root',
            duration: W_ROOT_DURATION,
          },
        },
      ],
    }
  })
}

// E: Next Hop — Apply self buff marking return point for 2 ticks
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
      id: 'nextHopShadow',
      stacks: 1,
      ticksRemaining: E_SHADOW_DURATION,
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
            buff: 'nextHopShadow',
            duration: E_SHADOW_DURATION,
          },
        },
      ],
    }
  })
}

// R: Full Trace — Reveal all enemies for 3 ticks + self damage buff 50% for 2 ticks
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

    // Self damage buff
    caster = applyBuff(caster, {
      id: 'fullTraceDmg',
      stacks: R_DAMAGE_BUFF_PERCENT,
      ticksRemaining: R_DAMAGE_BUFF_DURATION,
      source: player.id,
    })

    // Reveal all enemy players
    const enemies = getAllEnemyPlayers(state, player)
    const revealedEnemies = enemies.map((e) =>
      applyBuff(e, {
        id: 'revealed',
        stacks: 1,
        ticksRemaining: R_REVEAL_DURATION,
        source: player.id,
      }),
    )

    return {
      state: updatePlayers(state, [caster, ...revealedEnemies]),
      events: [
        {
          tick: state.tick,
          type: 'ability_cast',
          payload: {
            playerId: player.id,
            ability: 'r',
            effect: 'full_trace',
            revealDuration: R_REVEAL_DURATION,
            damageBuff: R_DAMAGE_BUFF_PERCENT,
            damageBuffDuration: R_DAMAGE_BUFF_DURATION,
            targets: enemies.map((e) => e.id),
          },
        },
      ],
    }
  })
}

// ── Passive: Hop Count ───────────────────────────────────────────
// On 'move' event by this player, increment hopCount stacks (max 3).
// Each stack = +20% damage. Stacks decay after 2 ticks of no movement.

function resolveHeroPassive(state: GameState, playerId: string, event: GameEvent): GameState {
  if (event.type !== 'move') return state

  const movedPlayerId = event.payload['playerId'] as string | undefined
  if (movedPlayerId !== playerId) return state

  const player = state.players[playerId]
  if (!player || !player.alive) return state

  const currentStacks = getBuffStacks(player, 'hopCount')
  const newStacks = Math.min(currentStacks + 1, HOP_COUNT_MAX_STACKS)

  const updated = applyBuff(player, {
    id: 'hopCount',
    stacks: newStacks,
    ticksRemaining: HOP_COUNT_DECAY_TICKS,
    source: playerId,
  })

  return updatePlayer(state, updated)
}

/** Get bonus damage multiplier from Hop Count stacks. */
export function getHopCountMultiplier(player: PlayerState): number {
  const stacks = getBuffStacks(player, 'hopCount')
  return 1 + stacks * HOP_COUNT_DAMAGE_PER_STACK
}

registerHero('traceroute', resolveHeroAbility, resolveHeroPassive)

export { resolveHeroAbility, resolveHeroPassive }
