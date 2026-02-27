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

const Q_DAMAGE = [100, 150, 200, 250] as const
const Q_MANA = [60, 80, 100, 120] as const
const Q_COOLDOWN = 6

const W_MANA = [70, 90, 110, 130] as const
const W_COOLDOWN = 12

const E_DAMAGE = [50, 80, 110, 140] as const
const E_MANA = [100, 130, 160, 190] as const
const E_COOLDOWN = 20

const R_DAMAGE = [300, 500, 700] as const
const R_MANA = [200, 350, 500] as const
const R_COOLDOWN = 45

const PATTERN_MATCH_BONUS = 0.2 // 20% bonus

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

// Q: Grep — magic damage to target hero
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
    const updatedTarget = dealDamage(targetPlayer, damage, 'magical')

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

// W: Sed — debuff target hero: -30% attack damage for 3 ticks
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

    const debuffed = applyBuff(targetPlayer, {
      id: 'sed_debuff',
      stacks: 30, // 30% attack reduction
      ticksRemaining: 3,
      source: player.id,
    })

    return {
      state: updatePlayers(state, [caster, debuffed]),
      events: [
        {
          tick: state.tick,
          type: 'ability_cast',
          payload: {
            playerId: player.id,
            ability: 'w',
            targetId: targetPlayer.id,
            effect: 'attack_reduction',
            value: 30,
            duration: 3,
          },
        },
      ],
    }
  })
}

// E: Awk — zone control, enemies entering take magic damage for 4 ticks
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

    const damage = scaleValue(E_DAMAGE, level)

    return {
      state: updatePlayer(state, caster),
      events: [
        {
          tick: state.tick,
          type: 'ability_cast',
          payload: {
            playerId: player.id,
            ability: 'e',
            zone: player.zone,
            effect: 'zone_control',
            damage,
            damageType: 'magical',
            duration: 4,
            expiryTick: state.tick + 4,
          },
        },
        {
          tick: state.tick,
          type: 'zone_control_placed',
          payload: {
            owner: player.id,
            team: player.team,
            zone: player.zone,
            damage,
            damageType: 'magical',
            expiryTick: state.tick + 4,
          },
        },
      ],
    }
  })
}

// R: Eval — massive magic damage to target hero
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
    if (!targetPlayer || !targetPlayer.alive || targetPlayer.zone !== player.zone) {
      return yield* Effect.fail(
        new InvalidTargetError({ target: target.name, reason: 'Target not in same zone or dead' }),
      )
    }

    let caster = deductMana(player, manaCost)
    caster = setCooldown(caster, 'r', R_COOLDOWN)

    const damage = scaleValue(R_DAMAGE, level)
    const updatedTarget = dealDamage(targetPlayer, damage, 'magical')

    return {
      state: updatePlayers(state, [caster, updatedTarget]),
      events: [
        {
          tick: state.tick,
          type: 'ability_cast',
          payload: {
            playerId: player.id,
            ability: 'r',
            targetId: targetPlayer.id,
            damage,
            damageType: 'magical',
          },
        },
      ],
    }
  })
}

// ── Passive: Pattern Match ────────────────────────────────────────
// When an ability hits 2+ enemy heroes, deal 20% bonus damage to all targets.
// This is checked by the ability resolver after determining hit targets.

function resolveHeroPassive(
  state: GameState,
  playerId: string,
  event: GameEvent,
): GameState {
  // Pattern Match triggers on ability_cast with multiple targets
  if (event.type !== 'ability_cast' || event.payload['playerId'] !== playerId) return state

  const targets = event.payload['targets'] as string[] | undefined
  if (!targets || targets.length < 2) return state

  // Apply 20% bonus damage to all targets
  const bonusDamage = Math.round(
    ((event.payload['damage'] as number) ?? 0) * PATTERN_MATCH_BONUS,
  )
  if (bonusDamage <= 0) return state

  const updatedPlayers = targets
    .map((tid) => state.players[tid])
    .filter((p): p is PlayerState => !!p && p.alive)
    .map((p) => dealDamage(p, bonusDamage, 'magical'))

  return updatePlayers(state, updatedPlayers)
}

registerHero('regex', resolveHeroAbility, resolveHeroPassive)

export { resolveHeroAbility, resolveHeroPassive }
