/**
 * Surrender System
 * Allows teams to vote to forfeit the game
 */

import type { GameState, TeamId } from '~~/shared/types/game'
import { SURRENDER_MIN_TICK, SURRENDER_VOTE_THRESHOLD } from '~~/shared/constants/balance'

export interface SurrenderResult {
  success: boolean
  surrendered?: boolean
  reason?: string
  votes?: { for: number; against: number; total: number; needed: number }
}

/**
 * Check if surrender vote can be initiated
 */
export function canSurrender(state: GameState, team: TeamId): { can: boolean; reason?: string } {
  if (state.tick < SURRENDER_MIN_TICK) {
    return { 
      can: false, 
      reason: `Too early to surrender (wait until tick ${SURRENDER_MIN_TICK})` 
    }
  }
  
  // Check if team already has enough votes to surrender
  const teamVotes = state.surrenderVotes[team]
  if (!teamVotes) {
    return { can: false, reason: 'Invalid team' }
  }
  
  // Count alive players on team
  const alivePlayers = Object.values(state.players).filter(
    p => p.team === team && p.alive
  )
  
  if (alivePlayers.length === 0) {
    return { can: false, reason: 'No alive players to vote' }
  }
  
  return { can: true }
}

/**
 * Cast a surrender vote
 */
export function voteSurrender(state: GameState, playerId: string): SurrenderResult {
  const player = state.players[playerId]
  
  if (!player) {
    return { success: false, reason: 'Player not found' }
  }
  
  if (!player.alive) {
    return { success: false, reason: 'Dead players cannot vote' }
  }
  
  const can = canSurrender(state, player.team)
  if (!can.can) {
    return { success: false, reason: can.reason }
  }
  
  // Add vote
  const updatedVotes = { ...state.surrenderVotes }
  const teamVotes = new Set(updatedVotes[player.team])
  teamVotes.add(playerId)
  updatedVotes[player.team] = teamVotes
  
  // Count votes
  const alivePlayers = Object.values(state.players).filter(
    p => p.team === player.team && p.alive
  )
  
  const totalAlive = alivePlayers.length
  const votesFor = teamVotes.size
  const votesNeeded = Math.ceil(totalAlive * SURRENDER_VOTE_THRESHOLD)
  
  // Check if surrender passed
  if (votesFor >= votesNeeded) {
    return {
      success: true,
      surrendered: true,
      votes: {
        for: votesFor,
        against: totalAlive - votesFor,
        total: totalAlive,
        needed: votesNeeded,
      },
    }
  }
  
  return {
    success: true,
    surrendered: false,
    votes: {
      for: votesFor,
      against: totalAlive - votesFor,
      total: totalAlive,
      needed: votesNeeded,
    },
  }
}

/**
 * Remove surrender vote (player can change mind)
 */
export function removeSurrenderVote(state: GameState, playerId: string): GameState {
  const player = state.players[playerId]
  if (!player) return state
  
  const updatedVotes = { ...state.surrenderVotes }
  const teamVotes = new Set(updatedVotes[player.team])
  teamVotes.delete(playerId)
  updatedVotes[player.team] = teamVotes
  
  return {
    ...state,
    surrenderVotes: updatedVotes,
  }
}

/**
 * Get surrender vote status for a team
 */
export function getSurrenderStatus(state: GameState, team: TeamId): {
  votesFor: number
  votesAgainst: number
  totalAlive: number
  votesNeeded: number
  percentage: number
} {
  const teamVotes = state.surrenderVotes[team]
  const alivePlayers = Object.values(state.players).filter(
    p => p.team === team && p.alive
  )
  
  const totalAlive = alivePlayers.length
  const votesFor = teamVotes?.size || 0
  const votesAgainst = totalAlive - votesFor
  const votesNeeded = Math.ceil(totalAlive * SURRENDER_VOTE_THRESHOLD)
  const percentage = totalAlive > 0 ? (votesFor / totalAlive) * 100 : 0
  
  return {
    votesFor,
    votesAgainst,
    totalAlive,
    votesNeeded,
    percentage,
  }
}

/**
 * Clear surrender votes (on game end or phase change)
 */
export function clearSurrenderVotes(state: GameState): GameState {
  return {
    ...state,
    surrenderVotes: {
      radiant: new Set(),
      dire: new Set(),
    },
  }
}
