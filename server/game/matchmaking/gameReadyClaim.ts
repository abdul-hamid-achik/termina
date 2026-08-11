import { Effect } from 'effect'
import type { RedisServiceApi } from '~~/server/services/RedisService'
import type { TeamId } from '~~/shared/types/game'

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

/** A lobby id is globally unique and owns the game id it starts. Shared
 *  between the lobby (which writes the pending handoff + publishes) and the
 *  game-server subscriber (which derives the same id to read/delete it), so
 *  the two never diverge on how a gameId is spelled. */
export function gameIdForLobby(lobbyId: string): string {
  return `game_${lobbyId}`
}

/** The payload lobby.ts publishes on `matchmaking:game_ready` and mirrors
 *  durably before publishing (see {@link writeGameReadyPending}). */
export interface GameReadyPayload {
  lobbyId: string
  mode?: string
  mapId?: string
  players: { playerId: string; team: TeamId; heroId: string; mmr: number }[]
}

/**
 * Durable game_ready handoff (owner audit item 1).
 *
 * Redis Pub/Sub is fire-and-forget: if the process that owns the claimed
 * lobby crashes between `claimGameReady` succeeding and the game actually
 * being created, the lobby is stranded in 'starting' forever — nothing else
 * will ever create that game. Mirroring the payload to a durable key BEFORE
 * publishing lets a boot-time sweep (`sweepGameReadyPending`) find and finish
 * any handoff that never completed. Pub/sub remains the fast path; this is
 * only the fallback for the crash window.
 */
export const GAME_READY_PENDING_TTL_SECONDS = 10 * 60 // 10 minutes

export function gameReadyPendingKey(gameId: string): string {
  return `game_ready:pending:${gameId}`
}

/** Mirror the game_ready payload durably, keyed by the gameId it will create.
 *  Must be called BEFORE the Pub/Sub publish (see lobby.ts `startReadyCheck`). */
export function writeGameReadyPending(
  redis: RedisServiceApi,
  gameId: string,
  payload: GameReadyPayload,
): Effect.Effect<void> {
  return redis.set(
    gameReadyPendingKey(gameId),
    JSON.stringify(payload),
    GAME_READY_PENDING_TTL_SECONDS,
  )
}

/** Drop the durable mirror. Only call once the game has actually been
 *  created — see game-server.ts's game_ready handler. */
export function deleteGameReadyPending(
  redis: RedisServiceApi,
  gameId: string,
): Effect.Effect<void> {
  return redis.del(gameReadyPendingKey(gameId))
}

/**
 * Boot-time sweep: every `game_ready:pending:*` key left over from a process
 * that died between publish and game creation. Corrupt/unparseable entries
 * are skipped rather than thrown — a single bad key must never abort the
 * sweep for every other pending handoff.
 */
export function sweepGameReadyPending(redis: RedisServiceApi): Effect.Effect<GameReadyPayload[]> {
  return Effect.gen(function* () {
    const keys = yield* redis.scan('game_ready:pending:*')
    const payloads: GameReadyPayload[] = []
    for (const key of keys) {
      const raw = yield* redis.get(key)
      if (!raw) continue
      try {
        payloads.push(JSON.parse(raw) as GameReadyPayload)
      } catch {
        // Corrupt entry — skip it, don't fail the whole sweep.
      }
    }
    return payloads
  })
}
