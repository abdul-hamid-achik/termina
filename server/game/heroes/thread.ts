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
  dealDamage,
  deductMana,
  setCooldown,
  applyBuff,
  updatePlayer,
  updatePlayers,
} from './_base'

// ── Scaling Values ────────────────────────────────────────────────

const Q_DAMAGE = [85, 125, 165, 205] as const
const Q_MANA = [55, 70, 85, 100] as const
const Q_COOLDOWN = 8
const Q_ATK_BUFF = 20
const Q_BUFF_DURATION = 3

const W_SHIELD_BASE = [100, 150, 200, 250] as const
const W_SHIELD_PER_ALLY = 40
const W_MANA = [70, 85, 100, 115] as const
const W_COOLDOWN = 12

const E_MANA = [60, 75, 90, 105] as const
const E_COOLDOWN = 10
const E_DEBUFF_DURATION = 3

const R_MANA = [250, 340, 430] as const
const R_COOLDOWN = 55
const R_BUFF_DURATION = 4

const SPLASH_RATIO = 0.4

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

// Q: Fork — physical damage to target + self attack buff
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
    caster = applyBuff(caster, {
      id: 'forkAtk',
      stacks: Q_ATK_BUFF,
      ticksRemaining: Q_BUFF_DURATION,
      source: player.id,
    })

    const damage = scaleValue(Q_DAMAGE, level)
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
            buff: 'forkAtk',
          },
        },
      ],
    }
  })
}

// W: Sync Barrier — self shield, bonus per ally in zone
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

    const allies = getAlliesInZone(state, player)
    const baseShield = scaleValue(W_SHIELD_BASE, level)
    const shieldAmount = baseShield + allies.length * W_SHIELD_PER_ALLY

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
            alliesInZone: allies.length,
          },
        },
      ],
    }
  })
}

// E: Yield — mark target enemy: they take 25% bonus damage for 3 ticks
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

    const updatedTarget = applyBuff(targetPlayer, {
      id: 'yield',
      stacks: 25, // 25% bonus damage
      ticksRemaining: E_DEBUFF_DURATION,
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
            effect: 'yield',
            duration: E_DEBUFF_DURATION,
          },
        },
      ],
    }
  })
}

// R: Thread Pool — self buff: attacks hit all enemies in zone for 4 ticks
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
    caster = applyBuff(caster, {
      id: 'threadPool',
      stacks: 1,
      ticksRemaining: R_BUFF_DURATION,
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
            ability: 'r',
            buff: 'threadPool',
            duration: R_BUFF_DURATION,
          },
        },
      ],
    }
  })
}

// ── Passive: Multithread ─────────────────────────────────────────
// On attack, splash 40% of damage to 1 additional random enemy in zone (2 at level 10+).

function resolveHeroPassive(state: GameState, playerId: string, event: GameEvent): GameState {
  if (event.type !== 'attack' || event.payload['attackerId'] !== playerId) return state

  const player = state.players[playerId]
  if (!player) return state

  const targetId = event.payload['targetId'] as string
  const damage = event.payload['damage'] as number
  if (!damage || damage <= 0) return state

  const enemies = getEnemiesInZone(state, player).filter(
    (e) => e.id !== targetId && e.alive,
  )
  if (enemies.length === 0) return state

  const splashDamage = Math.round(damage * SPLASH_RATIO)
  const maxTargets = player.level >= 10 ? 2 : 1
  const splashTargets = enemies.slice(0, maxTargets)

  const updatedTargets = splashTargets.map((e) => dealDamage(e, splashDamage, 'physical'))

  return updatePlayers(state, updatedTargets)
}

registerHero('thread', resolveHeroAbility, resolveHeroPassive)

export { resolveHeroAbility, resolveHeroPassive }
