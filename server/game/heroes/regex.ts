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
  updatePlayer,
  updatePlayers,
} from './_base'

// ── Scaling Values ────────────────────────────────────────────────

const Q_DAMAGE = [70, 100, 130, 160] as const
const Q_MANA = 60
const Q_COOLDOWN = [5, 4, 3, 2] as const
const Q_VULNERABILITY = 15

const W_MANA = 90
const W_COOLDOWN = [10, 9, 8, 7] as const
const W_ROOT_DURATION = 2
const W_DOT_DAMAGE = [30, 40, 50, 60] as const
const W_DOT_DURATION = 3

const E_MANA = 100
const E_COOLDOWN = [15, 14, 13, 12] as const
const E_STUN_DURATION = 1

const R_MANA = 300
const R_COOLDOWN = [60, 55, 50] as const
const R_DAMAGE_PER_MANA = [50, 75, 100] as const
const R_SILENCE_DURATION = 2

const PATTERN_MATCH_BONUS = 0.15

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
      return resolveR(state, player, level, target)
  }
}

// Q: Match — magic damage + magic vulnerability
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

    if (player.mp < Q_MANA) {
      return yield* Effect.fail(new InsufficientManaError({ required: Q_MANA, current: player.mp }))
    }

    const targetPlayer = findTargetPlayer(state, target)
    if (!targetPlayer || !targetPlayer.alive || targetPlayer.zone !== player.zone) {
      return yield* Effect.fail(
        new InvalidTargetError({ target: target.name, reason: 'Target not in same zone or dead' }),
      )
    }

    let caster = deductMana(player, Q_MANA)
    caster = setCooldown(caster, 'q', scaleValue(Q_COOLDOWN, level))

    const damage = scaleValue(Q_DAMAGE, level)
    let updatedTarget = dealDamage(targetPlayer, damage, 'magical')
    updatedTarget = applyBuff(updatedTarget, {
      id: 'magicVulnerability',
      stacks: Q_VULNERABILITY,
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
            damage,
            damageType: 'magical',
            vulnerability: Q_VULNERABILITY,
          },
        },
      ],
    }
  })
}

// W: Capture Group — root + DoT
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

    if (player.mp < W_MANA) {
      return yield* Effect.fail(new InsufficientManaError({ required: W_MANA, current: player.mp }))
    }

    const targetPlayer = findTargetPlayer(state, target)
    if (!targetPlayer || !targetPlayer.alive || targetPlayer.zone !== player.zone) {
      return yield* Effect.fail(
        new InvalidTargetError({ target: target.name, reason: 'Target not in same zone or dead' }),
      )
    }

    let caster = deductMana(player, W_MANA)
    caster = setCooldown(caster, 'w', scaleValue(W_COOLDOWN, level))

    const dotDamage = scaleValue(W_DOT_DAMAGE, level)
    let updatedTarget = applyBuff(targetPlayer, {
      id: 'root',
      stacks: 1,
      ticksRemaining: W_ROOT_DURATION,
      source: player.id,
    })
    updatedTarget = applyBuff(updatedTarget, {
      id: 'dot_magical',
      stacks: dotDamage,
      ticksRemaining: W_DOT_DURATION,
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
            dotDamage,
            dotDuration: W_DOT_DURATION,
          },
        },
      ],
    }
  })
}

// E: Substitution — swap positions + stun both
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

    if (player.mp < E_MANA) {
      return yield* Effect.fail(new InsufficientManaError({ required: E_MANA, current: player.mp }))
    }

    const targetPlayer = findTargetPlayer(state, target)
    if (!targetPlayer || !targetPlayer.alive) {
      return yield* Effect.fail(
        new InvalidTargetError({ target: target.name, reason: 'Target not found or dead' }),
      )
    }

    let caster = deductMana(player, E_MANA)
    caster = setCooldown(caster, 'e', scaleValue(E_COOLDOWN, level))

    const casterZone = caster.zone
    const targetZone = targetPlayer.zone

    let updatedCaster = { ...caster, zone: targetZone }
    let updatedTarget = { ...targetPlayer, zone: casterZone }

    updatedCaster = applyBuff(updatedCaster, {
      id: 'stun',
      stacks: 1,
      ticksRemaining: E_STUN_DURATION,
      source: player.id,
    })
    updatedTarget = applyBuff(updatedTarget, {
      id: 'stun',
      stacks: 1,
      ticksRemaining: E_STUN_DURATION,
      source: player.id,
    })

    return {
      state: updatePlayers(state, [updatedCaster, updatedTarget]),
      events: [
        {
          tick: state.tick,
          type: 'ability_cast',
          payload: {
            playerId: player.id,
            ability: 'e',
            targetId: targetPlayer.id,
            effect: 'swap',
            casterZone,
            targetZone,
            stunDuration: E_STUN_DURATION,
          },
        },
      ],
    }
  })
}

// R: Catastrophic Backtracking — damage based on missing mana + silence
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

    if (player.mp < R_MANA) {
      return yield* Effect.fail(new InsufficientManaError({ required: R_MANA, current: player.mp }))
    }

    const targetPlayer = findTargetPlayer(state, target)
    if (!targetPlayer || !targetPlayer.alive || targetPlayer.zone !== player.zone) {
      return yield* Effect.fail(
        new InvalidTargetError({ target: target.name, reason: 'Target not in same zone or dead' }),
      )
    }

    let caster = deductMana(player, R_MANA)
    caster = setCooldown(caster, 'r', scaleValue(R_COOLDOWN, level))

    const missingMana = targetPlayer.maxMp - targetPlayer.mp
    const damagePerMana = scaleValue(R_DAMAGE_PER_MANA, level)
    const damage = Math.floor((missingMana / 100) * damagePerMana)

    let updatedTarget = dealDamage(targetPlayer, damage, 'magical')
    updatedTarget = applyBuff(updatedTarget, {
      id: 'silence',
      stacks: 1,
      ticksRemaining: R_SILENCE_DURATION,
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
            ability: 'r',
            targetId: targetPlayer.id,
            damage,
            damageType: 'magical',
            missingMana,
            silenceDuration: R_SILENCE_DURATION,
          },
        },
      ],
    }
  })
}

// ── Passive: Pattern Cache ────────────────────────────────────────
// Casting an ability on the same target within 3 ticks deals 15% bonus damage.

function resolveHeroPassive(state: GameState, playerId: string, event: GameEvent): GameState {
  if (event.type !== 'ability_cast' || event.payload['playerId'] !== playerId) return state

  const targetId = event.payload['targetId'] as string | undefined
  if (!targetId) return state

  const player = state.players[playerId]
  if (!player) return state

  const lastTarget = player.buffs.find((b) => b.id === 'patternCacheTarget')?.source
  const lastCastTick = player.buffs.find((b) => b.id === 'patternCacheTick')?.stacks ?? 0

  const currentTick = state.tick
  const damage = event.payload['damage'] as number | undefined

  if (lastTarget === targetId && currentTick - lastCastTick <= 3 && damage) {
    const bonusDamage = Math.round(damage * PATTERN_MATCH_BONUS)
    const targetPlayer = state.players[targetId]
    if (targetPlayer && targetPlayer.alive) {
      const updatedTarget = dealDamage(targetPlayer, bonusDamage, 'magical')
      return updatePlayer(state, updatedTarget)
    }
  }

  let updatedPlayer = applyBuff(player, {
    id: 'patternCacheTarget',
    stacks: 1,
    ticksRemaining: 999,
    source: targetId,
  })
  updatedPlayer = applyBuff(updatedPlayer, {
    id: 'patternCacheTick',
    stacks: currentTick,
    ticksRemaining: 999,
    source: playerId,
  })

  return updatePlayer(state, updatedPlayer)
}

registerHero('regex', resolveHeroAbility, resolveHeroPassive)

export { resolveHeroAbility, resolveHeroPassive }
