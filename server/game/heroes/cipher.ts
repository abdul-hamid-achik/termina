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
  getBuffStacks,
  updatePlayer,
  updatePlayers,
} from './_base'

// ── Scaling Values ────────────────────────────────────────────────

const Q_MAGIC_DAMAGE = [70, 110, 150, 190] as const
const Q_PHYS_DAMAGE = [40, 55, 70, 85] as const
const Q_MANA = [50, 65, 80, 95] as const
const Q_COOLDOWN = 5

const W_MANA = [80, 100, 120, 140] as const
const W_COOLDOWN = 14

const E_MANA = [90, 110, 130, 150] as const
const E_COOLDOWN = 12

const R_DAMAGE_PER_HIT = [55, 85, 115] as const
const R_HITS = 6
const R_MANA = [220, 320, 420] as const
const R_COOLDOWN = 45

const ENCRYPTION_KEY_DEFENSE_REDUCTION = 2
const ENCRYPTION_KEY_MAX_STACKS = 4
const ENCRYPTION_KEY_DURATION = 3

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

// Q: XOR Strike — magical damage + physical damage
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

    const magicDamage = scaleValue(Q_MAGIC_DAMAGE, level)
    const physDamage = scaleValue(Q_PHYS_DAMAGE, level)
    let updatedTarget = dealDamage(targetPlayer, magicDamage, 'magical')
    updatedTarget = dealDamage(updatedTarget, physDamage, 'physical')

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
            magicDamage,
            physDamage,
          },
        },
      ],
    }
  })
}

// W: Encrypt — stealth for 2 ticks
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
    caster = applyBuff(caster, {
      id: 'stealth',
      stacks: 1,
      ticksRemaining: 2,
      source: player.id,
    })

    return {
      state: updatePlayer(state, caster),
      events: [
        {
          tick: state.tick,
          type: 'ability_cast',
          payload: { playerId: player.id, ability: 'w', buff: 'stealth', duration: 2 },
        },
      ],
    }
  })
}

// E: Decrypt — reveal target for 3 ticks + silence for 1 tick
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
    caster = removeBuff(caster, 'stealth')

    let updatedTarget = applyBuff(targetPlayer, {
      id: 'revealed',
      stacks: 1,
      ticksRemaining: 3,
      source: player.id,
    })
    updatedTarget = applyBuff(updatedTarget, {
      id: 'silence',
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
            effect: 'decrypt',
            revealDuration: 3,
            silenceDuration: 1,
          },
        },
      ],
    }
  })
}

// R: Brute Force — 6 rapid hits of magical damage + apply Encryption Key stacks
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
    caster = removeBuff(caster, 'stealth')

    const damagePerHit = scaleValue(R_DAMAGE_PER_HIT, level)
    let updatedTarget = targetPlayer
    for (let i = 0; i < R_HITS; i++) {
      updatedTarget = dealDamage(updatedTarget, damagePerHit, 'magical')
    }

    // Apply Encryption Key stacks (max 4)
    const currentStacks = getBuffStacks(updatedTarget, 'encryptionKey')
    const newStacks = Math.min(currentStacks + R_HITS, ENCRYPTION_KEY_MAX_STACKS)
    updatedTarget = applyBuff(updatedTarget, {
      id: 'encryptionKey',
      stacks: newStacks,
      ticksRemaining: ENCRYPTION_KEY_DURATION,
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
            totalDamage: damagePerHit * R_HITS,
            hits: R_HITS,
            damageType: 'magical',
          },
        },
      ],
    }
  })
}

// ── Passive: Encryption Key ─────────────────────────────────────
// Each attack reduces target defense by 2 for 3 ticks, stacking up to 4.

function resolveHeroPassive(state: GameState, playerId: string, event: GameEvent): GameState {
  if (event.type !== 'attack' || event.payload['attackerId'] !== playerId) return state

  const player = state.players[playerId]
  if (!player) return state

  const targetId = event.payload['targetId'] as string
  const targetPlayer = state.players[targetId]
  if (!targetPlayer || !targetPlayer.alive) return state

  const currentStacks = getBuffStacks(targetPlayer, 'encryptionKey')
  const newStacks = Math.min(currentStacks + 1, ENCRYPTION_KEY_MAX_STACKS)

  const updated = applyBuff(targetPlayer, {
    id: 'encryptionKey',
    stacks: newStacks,
    ticksRemaining: ENCRYPTION_KEY_DURATION,
    source: playerId,
  })

  return updatePlayer(state, updated)
}

/** Get total defense reduction from Encryption Key stacks. */
export function getEncryptionKeyReduction(player: PlayerState): number {
  return getBuffStacks(player, 'encryptionKey') * ENCRYPTION_KEY_DEFENSE_REDUCTION
}

registerHero('cipher', resolveHeroAbility, resolveHeroPassive)

export { resolveHeroAbility, resolveHeroPassive }
