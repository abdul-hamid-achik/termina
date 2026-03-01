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
  dealDamage,
  healPlayer,
  deductMana,
  setCooldown,
  applyBuff,
  updatePlayer,
  updatePlayers,
} from './_base'

// ── Scaling Values ────────────────────────────────────────────────

const Q_MANA = [65, 80, 95, 110] as const
const Q_COOLDOWN = 8
const Q_ATK_BONUS = 15
const Q_DEF_BONUS = 5
const Q_DURATION = 3

const W_SHIELD = [130, 170, 210, 250] as const
const W_MANA = [90, 105, 120, 135] as const
const W_COOLDOWN = 12
const W_SHIELD_DURATION = 2

const E_DAMAGE = [75, 110, 145, 180] as const
const E_MANA = [55, 70, 85, 100] as const
const E_COOLDOWN = 10

const R_HEAL_PER_TICK = [75, 110, 145] as const
const R_MANA = [250, 340, 430] as const
const R_COOLDOWN = 55
const R_DURATION = 4
const R_MP_PER_TICK = 15

const PASSIVE_HEAL = 40
const PASSIVE_TICK_INTERVAL = 4

const DEBUFF_IDS = ['stun', 'silence', 'root', 'slow', 'dot', 'debuff']

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
      return resolveE(state, player, level, target)
    case 'r':
      return resolveR(state, player, level)
  }
}

// Q: Uptime — Buff target ally: +15 attack, +5 defense for 3 ticks
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

    // Must be an ally (same team, not self)
    if (targetPlayer.team !== player.team || targetPlayer.id === player.id) {
      return yield* Effect.fail(
        new InvalidTargetError({ target: target.name, reason: 'Target must be an ally' }),
      )
    }

    let caster = deductMana(player, manaCost)
    caster = setCooldown(caster, 'q', Q_COOLDOWN)

    let updatedTarget = applyBuff(targetPlayer, {
      id: 'uptimeAtk',
      stacks: Q_ATK_BONUS,
      ticksRemaining: Q_DURATION,
      source: player.id,
    })
    updatedTarget = applyBuff(updatedTarget, {
      id: 'uptimeDef',
      stacks: Q_DEF_BONUS,
      ticksRemaining: Q_DURATION,
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
            atkBonus: Q_ATK_BONUS,
            defBonus: Q_DEF_BONUS,
            duration: Q_DURATION,
          },
        },
      ],
    }
  })
}

// W: Purge — Cleanse all debuffs from target ally + grant shield
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

    // Remove all debuffs from target
    const cleansedBuffs = (targetPlayer.id === player.id ? caster : targetPlayer).buffs.filter(
      (b) => !DEBUFF_IDS.some((debuffId) => b.id.includes(debuffId)),
    )
    let updatedTarget =
      targetPlayer.id === player.id
        ? { ...caster, buffs: cleansedBuffs }
        : { ...targetPlayer, buffs: cleansedBuffs }

    // Apply shield
    const shieldAmount = scaleValue(W_SHIELD, level)
    updatedTarget = applyBuff(updatedTarget, {
      id: 'shield',
      stacks: shieldAmount,
      ticksRemaining: W_SHIELD_DURATION,
      source: player.id,
    })

    const players =
      targetPlayer.id === player.id ? [updatedTarget] : [caster, updatedTarget]

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
            effect: 'purge',
          },
        },
      ],
    }
  })
}

// E: Kill Signal — Physical damage to target enemy + taunt for 1 tick
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

    let caster = deductMana(player, manaCost)
    caster = setCooldown(caster, 'e', E_COOLDOWN)

    const damage = scaleValue(E_DAMAGE, level)
    let updatedTarget = dealDamage(targetPlayer, damage, 'physical')
    updatedTarget = applyBuff(updatedTarget, {
      id: 'taunt',
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
            ability: 'e',
            targetId: targetPlayer.id,
            damage,
            damageType: 'physical',
            effect: 'taunt',
            duration: 1,
          },
        },
      ],
    }
  })
}

// R: Crontab — AoE heal to all allies in zone over time + MP restore
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

    const healPerTick = scaleValue(R_HEAL_PER_TICK, level)

    // Apply crontabHeal buff to self and all allies in zone
    const allies = getAlliesInZone(state, player)
    const allAffected = [caster, ...allies].map((p) =>
      applyBuff(p, {
        id: 'crontabHeal',
        stacks: healPerTick,
        ticksRemaining: R_DURATION,
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
            ability: 'r',
            healPerTick,
            mpPerTick: R_MP_PER_TICK,
            duration: R_DURATION,
            targets: allAffected.map((a) => a.id),
          },
        },
      ],
    }
  })
}

// ── Passive: Scheduled Task ──────────────────────────────────────
// On tick_end, if tick % 4 === 0, heal the lowest HP ally in the zone for 40 HP.

function resolveHeroPassive(state: GameState, playerId: string, event: GameEvent): GameState {
  if (event.type !== 'tick_end') return state

  const player = state.players[playerId]
  if (!player || !player.alive) return state

  if (state.tick % PASSIVE_TICK_INTERVAL !== 0) return state

  const allies = getAlliesInZone(state, player)
  if (allies.length === 0) return state

  // Find the lowest HP ally
  const lowestAlly = allies.reduce((lowest, ally) =>
    ally.hp < lowest.hp ? ally : lowest,
  )

  const healed = healPlayer(lowestAlly, PASSIVE_HEAL)
  return updatePlayer(state, healed)
}

registerHero('cron', resolveHeroAbility, resolveHeroPassive)

export { resolveHeroAbility, resolveHeroPassive }
