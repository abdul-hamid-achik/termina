/**
 * Surrender System
 * Allows teams to vote to forfeit the game
 */

import type { GameState, PlayerState, TeamId } from '~~/shared/types/game'
import { SURRENDER_MIN_TICK, SURRENDER_VOTE_THRESHOLD } from '~~/shared/constants/balance'
import { isBot } from '~~/server/game/ai/BotManager'

/**
 * The HUMAN players on a team — the surrender electorate. Bots never cast a
 * vote, so counting them in the denominator made surrender impossible in
 * solo-vs-bots play (1 human + 4 bots needed ceil(5 * 0.6) = 3 votes but only
 * one human could ever vote). Restricting the tally to humans means a lone
 * human's single vote concedes, while a full 5-human team still needs a 60%
 * majority.
 *
 * Deliberately NOT filtered on `alive`: death is the single most common moment
 * a player wants to concede, and a death-varying denominator makes the vote
 * incoherent — a teammate dying could retroactively pass a vote that had failed,
 * or drop an already-counted voter out of the tally and un-pass it.
 */
function humansOnTeam(state: GameState, team: TeamId): PlayerState[] {
  return Object.values(state.players).filter((p) => p.team === team && !isBot(p.id))
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
  // The minimum-tick rule exists to stop a losing team rage-quitting a real
  // match early. It makes no sense in the tutorial, which is single-player and
  // finishes well before tick 225 — it only trapped learners in a game they had
  // already graduated from, with no other way out than closing the tab.
  if (state.mode !== 'tutorial' && state.tick < SURRENDER_MIN_TICK) {
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

  // Count HUMAN players on team — bots don't vote
  const electorate = humansOnTeam(state, team)

  if (electorate.length === 0) {
    return { can: false, reason: 'No human players to vote' }
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

  // Count votes against the HUMAN electorate (bots don't vote)
  const electorate = humansOnTeam(state, player.team)

  const total = electorate.length
  // Only count votes from players still in the electorate.
  const votesFor = [...teamVotes].filter((id) => electorate.some((p) => p.id === id)).length
  const votesNeeded = Math.ceil(total * SURRENDER_VOTE_THRESHOLD)

  return {
    success: true,
    surrendered: votesFor >= votesNeeded,
    votes: {
      for: votesFor,
      against: total - votesFor,
      total,
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
  electorate: number
  votesNeeded: number
  percentage: number
} {
  const teamVotes = state.surrenderVotes[team]
  const humans = humansOnTeam(state, team)

  const electorate = humans.length
  const votesFor = teamVotes
    ? [...teamVotes].filter((id) => humans.some((p) => p.id === id)).length
    : 0
  const votesAgainst = electorate - votesFor
  const votesNeeded = Math.ceil(electorate * SURRENDER_VOTE_THRESHOLD)
  const percentage = electorate > 0 ? (votesFor / electorate) * 100 : 0

  return {
    votesFor,
    votesAgainst,
    electorate,
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
      chaff: new Set(),
      audit: new Set(),
    },
  }
}
