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

const Q_DAMAGE = [90, 130, 170, 210] as const
const Q_MANA = [55, 70, 85, 100] as const
const Q_COOLDOWN = 5
const Q_MR_SHRED = 5
const Q_MR_SHRED_DURATION = 3

const W_MANA = [80, 95, 110, 125] as const
const W_COOLDOWN = 12
const W_SILENCE_DURATION = 2

const E_DOT_DAMAGE = [40, 55, 70, 85] as const
const E_MANA = [90, 105, 120, 135] as const
const E_COOLDOWN = 14
const E_DOT_DURATION = 3

const R_DAMAGE = [240, 360, 480] as const
const R_MANA = [280, 360, 440] as const
const R_COOLDOWN = 50
const R_EXECUTE_THRESHOLD = 0.25
const R_EXECUTE_BONUS = 0.5

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

// Q: Void Bolt — magic damage to target hero + MR shred debuff
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
    // Apply MR shred debuff
    updatedTarget = applyBuff(updatedTarget, {
      id: 'mrShred',
      stacks: Q_MR_SHRED,
      ticksRemaining: Q_MR_SHRED_DURATION,
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
            debuff: 'mrShred',
          },
        },
      ],
    }
  })
}

// W: Null Pointer — silence target hero for 2 ticks
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
      id: 'silence',
      stacks: 1,
      ticksRemaining: W_SILENCE_DURATION,
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
            duration: W_SILENCE_DURATION,
          },
        },
      ],
    }
  })
}

// E: Void Zone — AoE DoT to all enemies in zone (damage over 3 ticks) + reveal
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
    const damagePerTick = scaleValue(E_DOT_DAMAGE, level)

    const updatedEnemies = enemies.map((e) => {
      let updated = applyBuff(e, {
        id: 'voidZone_dot',
        stacks: damagePerTick,
        ticksRemaining: E_DOT_DURATION,
        source: player.id,
      })
      updated = applyBuff(updated, {
        id: 'revealed',
        stacks: 1,
        ticksRemaining: E_DOT_DURATION,
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
            ability: 'e',
            damagePerTick,
            damageType: 'magical',
            duration: E_DOT_DURATION,
            targets: enemies.map((e) => e.id),
          },
        },
      ],
    }
  })
}

// R: Dereference — AoE magic burst to all enemies. Execute bonus below 25% HP.
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
    const baseDamage = scaleValue(R_DAMAGE, level)

    const updatedEnemies = enemies.map((e) => {
      const hpPercent = e.hp / e.maxHp
      const damage =
        hpPercent < R_EXECUTE_THRESHOLD
          ? Math.round(baseDamage * (1 + R_EXECUTE_BONUS))
          : baseDamage
      return dealDamage(e, damage, 'magical')
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
            damage: baseDamage,
            damageType: 'magical',
            targets: enemies.map((e) => e.id),
          },
        },
      ],
    }
  })
}

// ── Passive: Void Drain ──────────────────────────────────────────
// On kill event, restore 15% max MP + reduce all cooldowns by 2 ticks.

function resolveHeroPassive(state: GameState, playerId: string, event: GameEvent): GameState {
  if (event.type !== 'kill' || event.payload['killerId'] !== playerId) return state

  const player = state.players[playerId]
  if (!player || !player.alive) return state

  // Restore 15% max MP
  const manaRestore = Math.round(player.maxMp * 0.15)
  let updated: PlayerState = { ...player, mp: Math.min(player.maxMp, player.mp + manaRestore) }

  // Reduce all cooldowns by 2
  updated = {
    ...updated,
    cooldowns: {
      q: Math.max(0, updated.cooldowns.q - 2),
      w: Math.max(0, updated.cooldowns.w - 2),
      e: Math.max(0, updated.cooldowns.e - 2),
      r: Math.max(0, updated.cooldowns.r - 2),
    },
  }

  // Track via buff for observability
  updated = applyBuff(updated, {
    id: 'voidDrain',
    stacks: 1,
    ticksRemaining: 1,
    source: playerId,
  })

  return updatePlayer(state, updated)
}

registerHero('null_ref', resolveHeroAbility, resolveHeroPassive)

export { resolveHeroAbility, resolveHeroPassive }
