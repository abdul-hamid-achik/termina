import type { GameState, PlayerState, TeamId } from '~~/shared/types/game'
import { getItem } from '~~/shared/constants/items'
import {
  PASSIVE_GOLD_PER_TICK,
  CREEP_GOLD_MIN,
  CREEP_GOLD_MAX,
  SIEGE_CREEP_GOLD,
  KILL_BOUNTY_BASE,
  KILL_BOUNTY_PER_STREAK,
  ASSIST_GOLD,
  TOWER_GOLD,
  COMEBACK_BONUS_MAX,
  COMEBACK_PENALTY_MAX,
  COMEBACK_FULL_GAP,
} from '~~/shared/constants/balance'

/**
 * Compute the comeback multiplier for kill bounty based on the team
 * net-worth gap. Returns a value in [1 - COMEBACK_PENALTY_MAX,
 * 1 + COMEBACK_BONUS_MAX]. >1 means killer's team is behind (bonus).
 * Exported for tests.
 */
/** A player's net worth: unspent gold plus the full cost of owned items. */
export function playerNetWorth(player: PlayerState): number {
  let worth = player.gold
  for (const itemId of player.items) {
    if (!itemId) continue
    worth += getItem(itemId)?.cost ?? 0
  }
  return worth
}

export function comebackMultiplier(state: GameState, killerTeam: TeamId): number {
  let killerNet = 0
  let enemyNet = 0
  for (const p of Object.values(state.players)) {
    if (p.team === killerTeam) killerNet += playerNetWorth(p)
    else enemyNet += playerNetWorth(p)
  }
  // Positive gap = killer is behind by `gap` gold
  const gap = enemyNet - killerNet
  const ratio = Math.max(-1, Math.min(1, gap / COMEBACK_FULL_GAP))
  if (ratio >= 0) return 1 + ratio * COMEBACK_BONUS_MAX
  return 1 + ratio * COMEBACK_PENALTY_MAX
}

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

// (Removed `awardDeny` — dead duplicate: resolveActions computes deny gold
// inline and never called this.)

/**
 * Award gold for a hero kill.
 * Killer: 200 + 50 * killStreak
 * Assisters: 100 split evenly among all assisters (excluding killer)
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

  // Shutdown bounty: the bonus scales with the VICTIM's kill streak, so
  // ending a fed player's run pays out — anti-snowball, not pro-snowball.
  const streak = Math.min(victim.killStreak ?? 0, 10)
  const baseGold = KILL_BOUNTY_BASE + KILL_BOUNTY_PER_STREAK * streak
  const killerGold = Math.round(baseGold * comebackMultiplier(state, killer.team))
  updatedState = updatePlayerGold(updatedState, killerId, killerGold)

  // Assist gold split - exclude killer from assisters to prevent double-dipping
  if (assisters.length > 0) {
    const filteredAssisters = assisters.filter((id) => id !== killerId)
    if (filteredAssisters.length > 0) {
      const assistGoldEach = Math.floor(ASSIST_GOLD / filteredAssisters.length)
      for (const assisterId of filteredAssisters) {
        updatedState = updatePlayerGold(updatedState, assisterId, assistGoldEach)
      }
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
