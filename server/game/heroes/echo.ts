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
const Q_MANA = [40, 50, 60, 70] as const
const Q_COOLDOWN = [6, 5, 4, 3] as const
const Q_BOUNCE_MULTIPLIER = 0.5

const W_MANA = [50, 60, 70, 80] as const
const W_COOLDOWN = [12, 11, 10, 9] as const
const W_SPEED_BONUS = 50

const E_STACK_VALUE = [10, 15, 20, 25] as const
const E_MANA = 0
const E_COOLDOWN = [8, 7, 6, 5] as const
const E_DAMAGE_MULTIPLIER = 2

const R_DAMAGE = [60, 80, 100] as const
const R_MANA = [150, 175, 200] as const
const R_COOLDOWN = [50, 45, 40] as const
const R_HITS = 6

const RESONANCE_BONUS_PER_STACK = 0.08
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
      return resolveW(state, player, level)
    case 'e':
      return resolveE(state, player, level, target)
    case 'r':
      return resolveR(state, player, level, target)
  }
}

// Q: Resonance — physical damage to target hero, bounces to nearby enemy
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
    caster = setCooldown(caster, 'q', scaleValue(Q_COOLDOWN, level))

    const primaryDamage = scaleValue(Q_DAMAGE, level)
    const bounceDamage = Math.round(primaryDamage * Q_BOUNCE_MULTIPLIER)

    let updatedTarget = dealDamage(targetPlayer, primaryDamage, 'physical')
    const events: GameEvent[] = [
      {
        tick: state.tick,
        type: 'ability_cast',
        payload: {
          playerId: player.id,
          ability: 'q',
          targetId: targetPlayer.id,
          damage: primaryDamage,
          damageType: 'physical',
        },
      },
    ]

    const enemiesInZone = getEnemiesInZone(state, player).filter(
      (e) => e.id !== targetPlayer.id && e.alive,
    )
    if (enemiesInZone.length > 0) {
      const bounceTarget = enemiesInZone[0]!
      updatedTarget = dealDamage(bounceTarget, bounceDamage, 'physical') as PlayerState
      events.push({
        tick: state.tick,
        type: 'ability_cast',
        payload: {
          playerId: player.id,
          ability: 'q',
          targetId: bounceTarget.id,
          damage: bounceDamage,
          damageType: 'physical',
          description: 'bounce',
        },
      })
    }

    return {
      state: updatePlayers(state, [caster, updatedTarget]),
      events,
    }
  })
}

// W: Phase Shift — dodge next attack, +50% move speed for 2 ticks
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
    caster = setCooldown(caster, 'w', scaleValue(W_COOLDOWN, level))
    caster = applyBuff(caster, {
      id: 'phaseShift',
      stacks: 1,
      ticksRemaining: 1,
      source: player.id,
    })
    caster = applyBuff(caster, {
      id: 'moveSpeed',
      stacks: W_SPEED_BONUS,
      ticksRemaining: 2,
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

// E: Feedback Loop — consume stacks for burst damage
function resolveE(
  state: GameState,
  player: PlayerState,
  level: number,
  target?: TargetRef,
): Effect.Effect<AbilityResult, AbilityError> {
  return Effect.gen(function* () {
    const stacks = getBuffStacks(player, 'feedbackLoop')
    if (stacks <= 0) {
      return yield* Effect.fail(
        new InvalidTargetError({ target: 'self', reason: 'No feedback stacks to consume' }),
      )
    }

    if (!target || target.kind !== 'hero') {
      return yield* Effect.fail(
        new InvalidTargetError({ target: 'none', reason: 'Requires a hero target' }),
      )
    }

    const targetPlayer = findTargetPlayer(state, target)
    if (!targetPlayer || !targetPlayer.alive || targetPlayer.zone !== player.zone) {
      return yield* Effect.fail(
        new InvalidTargetError({ target: target.name, reason: 'Target not in same zone or dead' }),
      )
    }

    let caster = deductMana(player, E_MANA)
    caster = setCooldown(caster, 'e', scaleValue(E_COOLDOWN, level))
    caster = applyBuff(caster, {
      id: 'feedbackLoop',
      stacks: 0,
      ticksRemaining: 0,
      source: player.id,
    })

    const burstDamage = stacks * E_DAMAGE_MULTIPLIER
    const updatedTarget = dealDamage(targetPlayer, burstDamage, 'physical')

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
            damage: burstDamage,
            damageType: 'physical',
            stacksConsumed: stacks,
          },
        },
      ],
    }
  })
}

// R: Cascade — 6 attacks over 3 ticks, each dealing physical damage
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
    caster = setCooldown(caster, 'r', scaleValue(R_COOLDOWN, level))

    const damagePerHit = scaleValue(R_DAMAGE, level)
    let updatedTarget = targetPlayer
    for (let i = 0; i < R_HITS; i++) {
      updatedTarget = dealDamage(updatedTarget, damagePerHit, 'physical')
    }

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
            damage: damagePerHit,
            damageType: 'physical',
            hits: R_HITS,
          },
        },
      ],
    }
  })
}

// ── Passive: Resonance ────────────────────────────────────────────
// Consecutive attacks on same target: +8% damage per stack, max 5.
// Also handles Feedback Loop stack accumulation

function resolveHeroPassive(state: GameState, playerId: string, event: GameEvent): GameState {
  const player = state.players[playerId]
  if (!player) return state

  // Handle Resonance passive on attack
  if (event.type === 'attack' && event.payload['attackerId'] === playerId) {
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

    // Add Feedback Loop stacks on attack
    const abilityLevel = getAbilityLevel(updatedPlayer.level, 'e')
    if (abilityLevel > 0) {
      const stackValue = scaleValue(E_STACK_VALUE, abilityLevel)
      const currentStacks = getBuffStacks(updatedPlayer, 'feedbackLoop')
      updatedPlayer = applyBuff(updatedPlayer, {
        id: 'feedbackLoop',
        stacks: currentStacks + stackValue,
        ticksRemaining: 999,
        source: playerId,
      })
    }

    return updatePlayer(state, updatedPlayer)
  }

  return state
}

/** Get bonus damage multiplier from Resonance stacks. */
export function getResonanceMultiplier(player: PlayerState): number {
  const stacks = getBuffStacks(player, 'resonance')
  return 1 + stacks * RESONANCE_BONUS_PER_STACK
}

// Helper to get ability level (duplicated from _base for use in passive)
function getAbilityLevel(playerLevel: number, slot: AbilitySlot): number {
  if (slot === 'r') {
    if (playerLevel >= 18) return 3
    if (playerLevel >= 12) return 2
    if (playerLevel >= 6) return 1
    return 0
  }
  if (playerLevel >= 7) return 4
  if (playerLevel >= 5) return 3
  if (playerLevel >= 3) return 2
  if (playerLevel >= 1) return 1
  return 0
}

registerHero('echo', resolveHeroAbility, resolveHeroPassive)

export { resolveHeroAbility, resolveHeroPassive }
