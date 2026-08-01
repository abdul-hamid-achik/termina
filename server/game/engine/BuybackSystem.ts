/**
 * Buyback System
 * Allows dead players to instantly respawn by paying scrip
 */

import type { GameState, PlayerState } from '~~/shared/types/game'
import {
  BUYBACK_BASE_COST,
  BUYBACK_COST_PER_LEVEL,
  BUYBACK_COOLDOWN_CYCLES,
} from '~~/shared/constants/balance'

/**
 * Calculate buyback cost based on level and death count
 * Formula: base + (level * multiplier) + (deaths * small_factor)
 */
export function calculateBuybackCost(player: PlayerState): number {
  const baseCost = BUYBACK_BASE_COST
  const levelCost = player.level * BUYBACK_COST_PER_LEVEL
  const deathPenalty = player.deaths * 10 // Small penalty per death

  return baseCost + levelCost + deathPenalty
}

/**
 * Check if a player can buyback
 */
export function canBuyback(state: GameState, playerId: string): { can: boolean; reason?: string } {
  const player = state.players[playerId]

  if (!player) {
    return { can: false, reason: 'Player not found' }
  }

  if (player.alive) {
    return { can: false, reason: 'Player is not dead' }
  }

  if (player.buybackCooldown && state.cycle < player.buybackCooldown) {
    const remaining = player.buybackCooldown - state.cycle
    return { can: false, reason: `Buyback on cooldown (${remaining} cycles remaining)` }
  }

  const cost = calculateBuybackCost(player)
  if (player.scrip < cost) {
    return { can: false, reason: `Not enough scrip (need ${cost}, have ${player.scrip})` }
  }

  return { can: true }
}

/**
 * Execute buyback - instant respawn with scrip cost
 */
export function buyback(
  state: GameState,
  playerId: string,
): {
  success: boolean
  newState?: GameState
  reason?: string
} {
  const player = state.players[playerId]

  if (!player) {
    return { success: false, reason: 'Player not found' }
  }

  const canBuy = canBuyback(state, playerId)
  if (!canBuy.can) {
    return { success: false, reason: canBuy.reason }
  }

  const cost = calculateBuybackCost(player)
  const updatedPlayers = { ...state.players }
  const updatedPlayer = {
    ...player,
    scrip: player.scrip - cost,
    alive: true,
    integ: player.maxInteg,
    bw: player.maxBw,
    respawnCycle: null,
    buybackCooldown: state.cycle + BUYBACK_COOLDOWN_CYCLES,
    zone: player.team === 'chaff' ? 'rookery-anchor' : 'landing-anchor',
  }

  updatedPlayers[playerId] = updatedPlayer

  return {
    success: true,
    newState: {
      ...state,
      players: updatedPlayers,
    },
  }
}

/**
 * Update buyback cost for a player (call on death)
 */
export function updateBuybackCost(state: GameState, playerId: string): GameState {
  const player = state.players[playerId]
  if (!player) return state

  const cost = calculateBuybackCost(player)

  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: {
        ...player,
        buybackCost: cost,
      },
    },
  }
}
