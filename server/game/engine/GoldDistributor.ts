import type { GameState } from '~~/shared/types/game'
import {
  PASSIVE_GOLD_PER_TICK,
  CREEP_GOLD_MIN,
  CREEP_GOLD_MAX,
  SIEGE_CREEP_GOLD,
  KILL_BOUNTY_BASE,
  KILL_BOUNTY_PER_STREAK,
  ASSIST_GOLD,
  TOWER_GOLD,
} from '~~/shared/constants/balance'

/** Award passive gold to all alive players. +1g per tick. */
export function distributePassiveGold(state: GameState): GameState {
  const updatedPlayers = { ...state.players }

  for (const [pid, player] of Object.entries(updatedPlayers)) {
    if (player.alive) {
      updatedPlayers[pid] = {
        ...player,
        gold: player.gold + PASSIVE_GOLD_PER_TICK,
      }
    }
  }

  return { ...state, players: updatedPlayers }
}

/** Award gold for a last-hit on a creep. Melee/Ranged: 30-50g random, Siege: 75g. */
export function awardLastHit(
  state: GameState,
  playerId: string,
  creepType: 'melee' | 'ranged' | 'siege',
): GameState {
  const player = state.players[playerId]
  if (!player) return state

  let gold: number
  if (creepType === 'siege') {
    gold = SIEGE_CREEP_GOLD
  } else {
    gold = CREEP_GOLD_MIN + Math.floor(Math.random() * (CREEP_GOLD_MAX - CREEP_GOLD_MIN + 1))
  }

  return updatePlayerGold(state, playerId, gold)
}

/** Award gold for denying a creep. 50% of the gold goes to the denier. */
export function awardDeny(state: GameState, playerId: string): GameState {
  const denyGold = Math.floor(((CREEP_GOLD_MIN + CREEP_GOLD_MAX) / 2) * 0.5)
  return updatePlayerGold(state, playerId, denyGold)
}

/**
 * Award gold for a hero kill.
 * Killer: 200 + 50 * killStreak
 * Assisters: 100 split evenly among all assisters
 */
export function awardKill(
  state: GameState,
  killerId: string,
  victimId: string,
  assisters: string[],
): GameState {
  let updatedState = state
  const victim = state.players[victimId]
  if (!victim) return state

  // Killer bounty
  const killer = state.players[killerId]
  if (!killer) return state

  // Cap streak bonus to prevent infinite scaling; a proper killStreak field would be better
  const streak = Math.min(killer.kills, 10)
  const killerGold = KILL_BOUNTY_BASE + KILL_BOUNTY_PER_STREAK * streak
  updatedState = updatePlayerGold(updatedState, killerId, killerGold)

  // Assist gold split
  if (assisters.length > 0) {
    const assistGoldEach = Math.floor(ASSIST_GOLD / assisters.length)
    for (const assisterId of assisters) {
      updatedState = updatePlayerGold(updatedState, assisterId, assistGoldEach)
    }
  }

  return updatedState
}

/** Award tower kill gold. Split evenly among all nearby allies. */
export function awardTowerKill(state: GameState, _zone: string, nearbyAllies: string[]): GameState {
  if (nearbyAllies.length === 0) return state

  let updatedState = state
  const goldEach = Math.floor(TOWER_GOLD / nearbyAllies.length)
  for (const playerId of nearbyAllies) {
    updatedState = updatePlayerGold(updatedState, playerId, goldEach)
  }

  return updatedState
}

/** Helper: add gold to a player. */
function updatePlayerGold(state: GameState, playerId: string, amount: number): GameState {
  const player = state.players[playerId]
  if (!player) return state

  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: {
        ...player,
        gold: player.gold + amount,
      },
    },
  }
}
