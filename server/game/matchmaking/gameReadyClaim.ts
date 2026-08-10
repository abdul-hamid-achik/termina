import { Effect } from 'effect'
import type { RedisServiceApi } from '~~/server/services/RedisService'

/** Keep a claimed lobby from being recreated by another Pub/Sub subscriber. */
export const GAME_READY_CLAIM_TTL_SECONDS = 24 * 60 * 60

export function gameReadyClaimKey(lobbyId: string): string {
  return `matchmaking:game_ready_claim:${lobbyId}`
}

/**
 * Redis Pub/Sub fans `game_ready` out to every app instance. Exactly one
 * subscriber may create the authoritative local game state.
 */
export function claimGameReady(
  redis: RedisServiceApi,
  lobbyId: string,
  ownerId: string,
): Effect.Effect<boolean> {
  return Effect.map(
    redis.setnx(gameReadyClaimKey(lobbyId), ownerId, GAME_READY_CLAIM_TTL_SECONDS),
    (result) => result === 1,
  )
}
