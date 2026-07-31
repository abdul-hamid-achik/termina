import { Effect } from 'effect'
import type { GameState, PlayerState, GameEvent } from '~~/shared/types/game'
import type { TargetRef } from '~~/shared/types/commands'
import {
  type AbilitySlot,
  type AbilityResult,
  type AbilityError,
  InsufficientBwError,
  InvalidTargetError,
  registerHero,
  scaleValue,
  abilityBwTable,
  findTargetPlayer,
  getEnemiesInZone,
  dealDamage,
  deductBandwidth,
  setCooldown,
  applyBuff,
  removeBuff,
  getBuffStacks,
  getAbilityLevel,
  updatePlayer,
  updatePlayers,
} from './_base'

// ── Scaling Values ────────────────────────────────────────────────

const Q_DAMAGE = [80, 120, 160, 200] as const
const Q_MANA = abilityBwTable('echo', 'q')
const Q_COOLDOWN = [6, 5, 4, 3] as const
const Q_BOUNCE_MULTIPLIER = 0.5

const W_MANA = abilityBwTable('echo', 'w')
const W_COOLDOWN = [12, 11, 10, 9] as const

const E_STACK_VALUE = [10, 15, 20, 25] as const
const E_MANA = abilityBwTable('echo', 'e')
const E_COOLDOWN = [8, 7, 6, 5] as const
const E_DAMAGE_MULTIPLIER = 2

const R_DAMAGE = [60, 80, 100] as const
const R_MANA = abilityBwTable('echo', 'r')
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

// Q: Resonance — kinetic damage to target hero, bounces to nearby enemy
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

    const bwCost = scaleValue(Q_MANA, level)
    if (player.bw < bwCost) {
      return yield* Effect.fail(new InsufficientBwError({ required: bwCost, current: player.bw }))
    }

    const targetPlayer = findTargetPlayer(state, target)
    if (!targetPlayer || !targetPlayer.alive || targetPlayer.zone !== player.zone) {
      return yield* Effect.fail(
        new InvalidTargetError({ target: target.name, reason: 'Target not in same zone or dead' }),
      )
    }

    let caster = deductBandwidth(player, bwCost)
    caster = setCooldown(caster, 'q', scaleValue(Q_COOLDOWN, level))

    const primaryDamage = scaleValue(Q_DAMAGE, level)
    const bounceDamage = Math.round(primaryDamage * Q_BOUNCE_MULTIPLIER)

    const damagedPrimary = dealDamage(targetPlayer, primaryDamage, 'kinetic')
    const events: GameEvent[] = [
      {
        cycle: state.cycle,
        type: 'ability_cast',
        payload: {
          playerId: player.id,
          ability: 'q',
          targetId: targetPlayer.id,
          damage: primaryDamage,
          damageType: 'kinetic',
        },
      },
    ]

    const updatedTargets: PlayerState[] = [caster, damagedPrimary]
    const enemiesInZone = getEnemiesInZone(state, player).filter(
      (e) => e.id !== targetPlayer.id && e.alive,
    )
    if (enemiesInZone.length > 0) {
      const bounceTarget = enemiesInZone[0]!
      const damagedBounce = dealDamage(bounceTarget, bounceDamage, 'kinetic') as PlayerState
      updatedTargets.push(damagedBounce)
      events.push({
        cycle: state.cycle,
        type: 'ability_cast',
        payload: {
          playerId: player.id,
          ability: 'q',
          targetId: bounceTarget.id,
          damage: bounceDamage,
          damageType: 'kinetic',
          description: 'bounce',
        },
      })
    }

    return {
      state: updatePlayers(state, updatedTargets),
      events,
    }
  })
}

// W: Phase Shift — dodge the next attack (move-speed buff was removed; movement
// is a fixed 1 zone/tick, so the stat was inert)
function resolveW(
  state: GameState,
  player: PlayerState,
  level: number,
): Effect.Effect<AbilityResult, AbilityError> {
  return Effect.gen(function* () {
    const bwCost = scaleValue(W_MANA, level)
    if (player.bw < bwCost) {
      return yield* Effect.fail(new InsufficientBwError({ required: bwCost, current: player.bw }))
    }

    let caster = deductBandwidth(player, bwCost)
    caster = setCooldown(caster, 'w', scaleValue(W_COOLDOWN, level))
    caster = applyBuff(caster, {
      id: 'phaseShift',
      stacks: 1,
      cyclesRemaining: 1,
      source: player.id,
    })
    // W is the phaseShift dodge only — movement is a fixed 1 zone/tick.

    return {
      state: updatePlayer(state, caster),
      events: [
        {
          cycle: state.cycle,
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

    let caster = deductBandwidth(player, scaleValue(E_MANA, level))
    caster = setCooldown(caster, 'e', scaleValue(E_COOLDOWN, level))
    caster = applyBuff(caster, {
      id: 'feedbackLoop',
      stacks: 0,
      cyclesRemaining: 0,
      source: player.id,
    })

    const burstDamage = stacks * E_DAMAGE_MULTIPLIER
    const updatedTarget = dealDamage(targetPlayer, burstDamage, 'kinetic')

    return {
      state: updatePlayers(state, [caster, updatedTarget]),
      events: [
        {
          cycle: state.cycle,
          type: 'ability_cast',
          payload: {
            playerId: player.id,
            ability: 'e',
            targetId: targetPlayer.id,
            damage: burstDamage,
            damageType: 'kinetic',
            stacksConsumed: stacks,
          },
        },
      ],
    }
  })
}

// R: Cascade — 6 attacks over 3 ticks, each dealing kinetic damage
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

    const bwCost = scaleValue(R_MANA, level)
    if (player.bw < bwCost) {
      return yield* Effect.fail(new InsufficientBwError({ required: bwCost, current: player.bw }))
    }

    const targetPlayer = findTargetPlayer(state, target)
    if (!targetPlayer || !targetPlayer.alive || targetPlayer.zone !== player.zone) {
      return yield* Effect.fail(
        new InvalidTargetError({ target: target.name, reason: 'Target not in same zone or dead' }),
      )
    }

    let caster = deductBandwidth(player, bwCost)
    caster = setCooldown(caster, 'r', scaleValue(R_COOLDOWN, level))

    const damagePerHit = scaleValue(R_DAMAGE, level)
    let updatedTarget = targetPlayer
    for (let i = 0; i < R_HITS; i++) {
      updatedTarget = dealDamage(updatedTarget, damagePerHit, 'kinetic')
    }

    return {
      state: updatePlayers(state, [caster, updatedTarget]),
      events: [
        {
          cycle: state.cycle,
          type: 'ability_cast',
          payload: {
            playerId: player.id,
            ability: 'r',
            targetId: targetPlayer.id,
            damage: damagePerHit,
            damageType: 'kinetic',
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
    // Last-attacked target is stored in the single resonanceTarget buff's
    // `destination` (with a stable source=playerId), NOT keyed by source=target —
    // the latter pushed a NEW buff per target so find() returned the stale first
    // one and resonance stopped ramping after one target switch.
    const lastTarget = player.buffs.find((b) => b.id === 'resonanceTarget')?.destination

    let updatedPlayer: PlayerState
    if (lastTarget === targetId) {
      const current = getBuffStacks(player, 'resonance')
      const newStacks = Math.min(current + 1, RESONANCE_MAX_STACKS)
      updatedPlayer = applyBuff(player, {
        id: 'resonance',
        stacks: newStacks,
        cyclesRemaining: 30,
        source: playerId,
      })
    } else {
      updatedPlayer = applyBuff(player, {
        id: 'resonance',
        stacks: 1,
        cyclesRemaining: 30,
        source: playerId,
      })
    }

    // Keep exactly ONE resonanceTarget buff: drop any prior, then record the
    // current target in `destination`. removeBuff-then-applyBuff is required
    // because applyBuff's in-place update refreshes only stacks/cyclesRemaining,
    // not destination.
    updatedPlayer = removeBuff(updatedPlayer, 'resonanceTarget')
    updatedPlayer = applyBuff(updatedPlayer, {
      id: 'resonanceTarget',
      stacks: 1,
      cyclesRemaining: 30,
      source: playerId,
      destination: targetId,
    })

    // Add Feedback Loop stacks on attack
    const abilityLevel = getAbilityLevel(updatedPlayer.level, 'e')
    if (abilityLevel > 0) {
      const stackValue = scaleValue(E_STACK_VALUE, abilityLevel)
      const currentStacks = getBuffStacks(updatedPlayer, 'feedbackLoop')
      updatedPlayer = applyBuff(updatedPlayer, {
        id: 'feedbackLoop',
        stacks: currentStacks + stackValue,
        cyclesRemaining: 999,
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

registerHero('echo', resolveHeroAbility, resolveHeroPassive, ['attack'])

export { resolveHeroAbility, resolveHeroPassive }
