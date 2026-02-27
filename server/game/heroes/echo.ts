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
  getBuffStacks,
  updatePlayer,
  updatePlayers,
} from './_base'

// ── Scaling Values ────────────────────────────────────────────────

const Q_DAMAGE = [80, 120, 160, 200] as const
const Q_MANA = [60, 80, 100, 120] as const
const Q_COOLDOWN = 8

const W_MANA = 50
const W_COOLDOWN = 12

const E_MANA = [80, 90, 100, 110] as const
const E_COOLDOWN = 16

const R_DAMAGE = [200, 350, 500] as const
const R_MANA = [200, 300, 400] as const
const R_COOLDOWN = 40

const RESONANCE_BONUS_PER_STACK = 0.1
const RESONANCE_MAX_STACKS = 5

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
      return resolveW(state, player)
    case 'e':
      return resolveE(state, player, level)
    case 'r':
      return resolveR(state, player, level)
  }
}

// Q: Pulse Shot — magic damage to target hero
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

// W: Phase Shift — dodge next incoming attack this tick
function resolveW(
  state: GameState,
  player: PlayerState,
): Effect.Effect<AbilityResult, AbilityError> {
  return Effect.gen(function* () {
    if (player.mp < W_MANA) {
      return yield* Effect.fail(new InsufficientManaError({ required: W_MANA, current: player.mp }))
    }

    let caster = deductMana(player, W_MANA)
    caster = setCooldown(caster, 'w', W_COOLDOWN)
    caster = applyBuff(caster, {
      id: 'phaseShift',
      stacks: 1,
      ticksRemaining: 1,
      source: player.id,
    })

    return {
      state: updatePlayer(state, caster),
      events: [
        {
          tick: state.tick,
          type: 'ability_cast',
          payload: { playerId: player.id, ability: 'w', buff: 'phaseShift' },
        },
      ],
    }
  })
}

// E: Feedback Loop — next 3 attacks heal for 30% of damage dealt
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
      id: 'feedbackLoop',
      stacks: 3,
      ticksRemaining: 30, // long duration, consumed by stacks
      source: player.id,
    })

    return {
      state: updatePlayer(state, caster),
      events: [
        {
          tick: state.tick,
          type: 'ability_cast',
          payload: { playerId: player.id, ability: 'e', buff: 'feedbackLoop' },
        },
      ],
    }
  })
}

// R: Cascade — AoE magic damage to ALL enemies in current zone
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
    const damage = scaleValue(R_DAMAGE, level)
    const updatedEnemies = enemies.map((e) => dealDamage(e, damage, 'magical'))

    return {
      state: updatePlayers(state, [caster, ...updatedEnemies]),
      events: [
        {
          tick: state.tick,
          type: 'ability_cast',
          payload: {
            playerId: player.id,
            ability: 'r',
            damage,
            damageType: 'magical',
            targets: enemies.map((e) => e.id),
          },
        },
      ],
    }
  })
}

// ── Passive: Resonance ────────────────────────────────────────────
// Consecutive attacks on same target: +10% damage per stack, max 5.

function resolveHeroPassive(state: GameState, playerId: string, event: GameEvent): GameState {
  if (event.type !== 'attack' || event.payload['attackerId'] !== playerId) return state

  const player = state.players[playerId]
  if (!player) return state

  const targetId = event.payload['targetId'] as string
  const lastTarget = player.buffs.find((b) => b.id === 'resonanceTarget')?.source

  let updatedPlayer: PlayerState
  if (lastTarget === targetId) {
    const current = getBuffStacks(player, 'resonance')
    const newStacks = Math.min(current + 1, RESONANCE_MAX_STACKS)
    updatedPlayer = applyBuff(player, {
      id: 'resonance',
      stacks: newStacks,
      ticksRemaining: 30,
      source: playerId,
    })
  } else {
    updatedPlayer = applyBuff(player, {
      id: 'resonance',
      stacks: 1,
      ticksRemaining: 30,
      source: playerId,
    })
  }

  updatedPlayer = applyBuff(updatedPlayer, {
    id: 'resonanceTarget',
    stacks: 1,
    ticksRemaining: 30,
    source: targetId,
  })

  return updatePlayer(state, updatedPlayer)
}

/** Get bonus damage multiplier from Resonance stacks. */
export function getResonanceMultiplier(player: PlayerState): number {
  const stacks = getBuffStacks(player, 'resonance')
  return 1 + stacks * RESONANCE_BONUS_PER_STACK
}

registerHero('echo', resolveHeroAbility, resolveHeroPassive)

export { resolveHeroAbility, resolveHeroPassive }
