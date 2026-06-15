/**
 * Surrender System
 * Allows teams to vote to forfeit the game
 */

import type { GameState, PlayerState, TeamId } from '~~/shared/types/game'
import { SURRENDER_MIN_TICK, SURRENDER_VOTE_THRESHOLD } from '~~/shared/constants/balance'
import { isBot } from '~~/server/game/ai/BotManager'

/**
 * Alive HUMAN players on a team — the surrender electorate. Bots never cast a
 * vote, so counting them in the denominator made surrender impossible in
 * solo-vs-bots play (1 human + 4 bots needed ceil(5 * 0.6) = 3 votes but only
 * one human could ever vote). Restricting the tally to humans means a lone
 * human's single vote concedes, while a full 5-human team still needs a 60%
 * majority.
 */
function aliveHumansOnTeam(state: GameState, team: TeamId): PlayerState[] {
  return Object.values(state.players).filter((p) => p.team === team && p.alive && !isBot(p.id))
}

export interface SurrenderResult {
  success: boolean
  surrendered?: boolean
  reason?: string
  votes?: { for: number; against: number; total: number; needed: number }
  /** State with the vote recorded — callers must use this for the vote to persist. */
  state: GameState
}

/**
 * Check if surrender vote can be initiated
 */
export function canSurrender(state: GameState, team: TeamId): { can: boolean; reason?: string } {
  if (state.tick < SURRENDER_MIN_TICK) {
    return {
      can: false,
      reason: `Too early to surrender (wait until tick ${SURRENDER_MIN_TICK})`,
    }
  }

  // Check if team already has enough votes to surrender
  const teamVotes = state.surrenderVotes[team]
  if (!teamVotes) {
    return { can: false, reason: 'Invalid team' }
  }

  // Count alive HUMAN players on team — bots don't vote
  const aliveHumans = aliveHumansOnTeam(state, team)

  if (aliveHumans.length === 0) {
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
    return { success: false, reason: 'Player not found', state }
  }

  if (!player.alive) {
    return { success: false, reason: 'Dead players cannot vote', state }
  }

  const can = canSurrender(state, player.team)
  if (!can.can) {
    return { success: false, reason: can.reason, state }
  }

  // Add vote
  const updatedVotes = { ...state.surrenderVotes }
  const teamVotes = new Set(updatedVotes[player.team])
  teamVotes.add(playerId)
  updatedVotes[player.team] = teamVotes
  const updatedState: GameState = { ...state, surrenderVotes: updatedVotes }

  // Count votes against the alive HUMAN electorate (bots don't vote)
  const aliveHumans = aliveHumansOnTeam(state, player.team)

  const totalAlive = aliveHumans.length
  // Only count votes from players still in the electorate (alive humans).
  const votesFor = [...teamVotes].filter((id) => aliveHumans.some((p) => p.id === id)).length
  const votesNeeded = Math.ceil(totalAlive * SURRENDER_VOTE_THRESHOLD)

  return {
    success: true,
    surrendered: votesFor >= votesNeeded,
    votes: {
      for: votesFor,
      against: totalAlive - votesFor,
      total: totalAlive,
      needed: votesNeeded,
    },
    state: updatedState,
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
export function getSurrenderStatus(
  state: GameState,
  team: TeamId,
): {
  votesFor: number
  votesAgainst: number
  totalAlive: number
  votesNeeded: number
  percentage: number
} {
  const teamVotes = state.surrenderVotes[team]
  const aliveHumans = aliveHumansOnTeam(state, team)

  const totalAlive = aliveHumans.length
  const votesFor = teamVotes
    ? [...teamVotes].filter((id) => aliveHumans.some((p) => p.id === id)).length
    : 0
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
