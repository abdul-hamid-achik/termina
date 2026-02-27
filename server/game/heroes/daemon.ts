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
  dealDamage,
  deductMana,
  setCooldown,
  applyBuff,
  removeBuff,
  hasBuff,
  updatePlayer,
  updatePlayers,
} from './_base'

// ── Scaling Values ────────────────────────────────────────────────

const Q_DAMAGE = [60, 100, 140, 180] as const // total DoT damage
const Q_MANA = [50, 70, 90, 110] as const
const Q_COOLDOWN = 7

const W_MANA = 100
const W_COOLDOWN = 18

const E_DAMAGE = [300, 400, 500] as const
const E_MANA = [150, 200, 250] as const
const E_COOLDOWN = 20
const E_THRESHOLD = 0.3 // 30% HP

const R_MANA = [200, 300, 400] as const
const R_COOLDOWN = 60

const STEALTH_IDLE_TICKS = 2

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
      return resolveW(state, player, target)
    case 'e':
      return resolveE(state, player, level, target)
    case 'r':
      return resolveR(state, player, level, target)
  }
}

// Q: Inject — DoT debuff on target, total damage over 3 ticks
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
    // Break stealth on action
    caster = removeBuff(caster, 'stealth')

    const totalDamage = scaleValue(Q_DAMAGE, level)
    const damagePerTick = Math.round(totalDamage / 3)

    const updatedTarget = applyBuff(targetPlayer, {
      id: 'inject_dot',
      stacks: damagePerTick,
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
            ability: 'q',
            targetId: targetPlayer.id,
            totalDamage,
            damageType: 'magical',
          },
        },
      ],
    }
  })
}

// W: Fork Bomb — create decoy in adjacent zone for 3 ticks
function resolveW(
  state: GameState,
  player: PlayerState,
  target?: TargetRef,
): Effect.Effect<AbilityResult, AbilityError> {
  return Effect.gen(function* () {
    if (player.mp < W_MANA) {
      return yield* Effect.fail(
        new InsufficientManaError({ required: W_MANA, current: player.mp }),
      )
    }

    // Target zone (encoded as hero target name = zone id)
    const zoneId = target?.kind === 'hero' ? target.name : undefined
    if (!zoneId) {
      return yield* Effect.fail(
        new InvalidTargetError({ target: 'none', reason: 'Requires a zone target' }),
      )
    }

    let caster = deductMana(player, W_MANA)
    caster = setCooldown(caster, 'w', W_COOLDOWN)
    caster = removeBuff(caster, 'stealth')

    return {
      state: updatePlayer(state, caster),
      events: [
        {
          tick: state.tick,
          type: 'ability_cast',
          payload: {
            playerId: player.id,
            ability: 'w',
            zone: zoneId,
            effect: 'decoy',
            duration: 3,
          },
        },
        {
          tick: state.tick,
          type: 'decoy_spawned',
          payload: {
            owner: player.id,
            zone: zoneId,
            heroId: 'daemon',
            expiryTick: state.tick + 3,
          },
        },
      ],
    }
  })
}

// E: Sudo — execute below 30% HP with pure damage; fail + refund if above
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

    // Check HP threshold — if above 30%, refund mana and don't set cooldown
    const hpPercent = targetPlayer.hp / targetPlayer.maxHp
    if (hpPercent > E_THRESHOLD) {
      return {
        state,
        events: [
          {
            tick: state.tick,
            type: 'ability_failed',
            payload: {
              playerId: player.id,
              ability: 'e',
              reason: 'Target HP above execute threshold',
            },
          },
        ],
      }
    }

    // Execute!
    let caster = deductMana(player, manaCost)
    caster = setCooldown(caster, 'e', E_COOLDOWN)
    caster = removeBuff(caster, 'stealth')

    const damage = scaleValue(E_DAMAGE, level)
    const updatedTarget = dealDamage(targetPlayer, damage, 'pure')

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
            damageType: 'pure',
            execute: true,
          },
        },
      ],
    }
  })
}

// R: Root Access — teleport to any zone on the map
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

    const zoneId = target?.kind === 'hero' ? target.name : undefined
    if (!zoneId || !state.zones[zoneId]) {
      return yield* Effect.fail(
        new InvalidTargetError({ target: zoneId ?? 'none', reason: 'Invalid zone target' }),
      )
    }

    let caster = deductMana(player, manaCost)
    caster = setCooldown(caster, 'r', R_COOLDOWN)
    caster = removeBuff(caster, 'stealth')
    caster = { ...caster, zone: zoneId }

    return {
      state: updatePlayer(state, caster),
      events: [
        {
          tick: state.tick,
          type: 'ability_cast',
          payload: {
            playerId: player.id,
            ability: 'r',
            zone: zoneId,
            effect: 'teleport',
          },
        },
      ],
    }
  })
}

// ── Passive: Stealth ──────────────────────────────────────────────
// If no action for 2 consecutive ticks, gain invisibility. Broken by any action.

function resolveHeroPassive(
  state: GameState,
  playerId: string,
  event: GameEvent,
): GameState {
  const player = state.players[playerId]
  if (!player) return state

  // If the player performed an action, break stealth and reset idle counter
  if (
    event.type === 'attack' ||
    event.type === 'ability_cast' ||
    event.type === 'item_used'
  ) {
    const isActor =
      event.payload['attackerId'] === playerId || event.payload['playerId'] === playerId
    if (isActor) {
      let updated = removeBuff(player, 'stealth')
      updated = applyBuff(updated, {
        id: 'stealthIdle',
        stacks: 0,
        ticksRemaining: 99,
        source: playerId,
      })
      return updatePlayer(state, updated)
    }
  }

  // On tick_end, increment idle counter
  if (event.type === 'tick_end') {
    const idleBuff = player.buffs.find((b) => b.id === 'stealthIdle')
    const idleTicks = (idleBuff?.stacks ?? 0) + 1

    let updated = applyBuff(player, {
      id: 'stealthIdle',
      stacks: idleTicks,
      ticksRemaining: 99,
      source: playerId,
    })

    if (idleTicks >= STEALTH_IDLE_TICKS && !hasBuff(updated, 'stealth')) {
      updated = applyBuff(updated, {
        id: 'stealth',
        stacks: 1,
        ticksRemaining: 99,
        source: playerId,
      })
    }

    return updatePlayer(state, updated)
  }

  return state
}

registerHero('daemon', resolveHeroAbility, resolveHeroPassive)

export { resolveHeroAbility, resolveHeroPassive }
