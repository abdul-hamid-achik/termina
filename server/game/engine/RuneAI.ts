import type { GameState, RuneState } from '~~/shared/types/game'
import {
  RUNE_BUFF_TICKS,
  RUNE_DURATION_TICKS,
} from '~~/shared/constants/balance'

/**
 * Get the buff effect for a rune type.
 */
export function getRuneBuff(
  type: RuneState['type'],
): { id: string; stacks: number; ticksRemaining: number; source: string } {
  const duration = RUNE_BUFF_TICKS[type] ?? 15

  switch (type) {
    case 'haste':
      return { id: 'haste', stacks: 1, ticksRemaining: duration, source: 'rune_haste' }
    case 'dd':
      return { id: 'dd', stacks: 1, ticksRemaining: duration, source: 'rune_dd' }
    case 'regen':
      return { id: 'regen', stacks: 1, ticksRemaining: duration, source: 'rune_regen' }
    case 'arcane':
      return { id: 'arcane', stacks: 1, ticksRemaining: duration, source: 'rune_arcane' }
    case 'invis':
      return { id: 'invis', stacks: 1, ticksRemaining: duration, source: 'rune_invis' }
  }
}

/**
 * Apply rune buff effects to a player.
 */
function applyRuneBuff(
  players: GameState['players'],
  playerId: string,
  runeType: RuneState['type'],
): GameState['players'] {
  const player = players[playerId]
  if (!player) return players

  const buff = getRuneBuff(runeType)

  return {
    ...players,
    [playerId]: {
      ...player,
      buffs: [...player.buffs, buff],
    },
  }
}

/**
 * Pick up a rune - player must be in the same zone as the rune.
 */
export function pickupRune(
  state: GameState,
  playerId: string,
  zone: string,
): GameState {
  const player = state.players[playerId]
  if (!player || !player.alive) return state
  if (player.zone !== zone) return state

  // Find rune in this zone (handle undefined runes)
  const runes = state.runes ?? []
  const runeIndex = runes.findIndex((r) => r.zone === zone)
  if (runeIndex === -1) return state

  const rune = runes[runeIndex]!

  // Apply the rune buff to the player
  const players = applyRuneBuff(state.players, playerId, rune.type)

  // Remove the rune from the ground
  const newRunes = runes.filter((_, i) => i !== runeIndex)

  // Add event
  const events = [...state.events, {
    _tag: 'rune_picked' as const,
    tick: state.tick,
    playerId,
    zone,
    runeType: rune.type,
  }]

  return { ...state, players, runes: newRunes, events }
}

/**
 * Remove expired runes from the map.
 */
export function removeExpiredRunes(state: GameState): GameState {
  // Handle case where runes might be undefined (for old test states)
  const runes = state.runes ?? []
  const currentTick = state.tick
  const activeRunes = runes.filter((rune) => {
    // Rune expires after RUNE_DURATION_TICKS
    return currentTick - rune.tick < RUNE_DURATION_TICKS
  })

  if (activeRunes.length !== runes.length) {
    return { ...state, runes: activeRunes }
  }

  return state
}

/**
 * Process passive effects from rune buffs (regen, etc).
 */
export function processRuneBuffs(state: GameState): GameState {
  const players = { ...state.players }

  for (const [playerId, player] of Object.entries(players)) {
    if (!player.alive) continue

    let hp = player.hp
    let mp = player.mp

    // Check for active rune buffs
    const hasRegen = player.buffs.some((b) => b.id === 'regen')

    // Regeneration rune: 5% HP/MP per tick
    if (hasRegen) {
      hp = Math.min(player.maxHp, hp + Math.floor(player.maxHp * 0.05))
      mp = Math.min(player.maxMp, mp + Math.floor(player.maxMp * 0.05))
    }

    // Haste rune is handled via movement (can't be rooted/stunned)
    // This is processed in the movement validation

    if (hp !== player.hp || mp !== player.mp) {
      players[playerId] = { ...player, hp, mp }
    }
  }

  return { ...state, players }
}
