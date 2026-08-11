import { describe, it, expect, vi } from 'vitest'
import { Effect } from 'effect'
import {
  claimGameReady,
  gameReadyClaimKey,
  GAME_READY_CLAIM_TTL_SECONDS,
  gameIdForLobby,
  gameReadyPendingKey,
  writeGameReadyPending,
  deleteGameReadyPending,
  sweepGameReadyPending,
  GAME_READY_PENDING_TTL_SECONDS,
  type GameReadyPayload,
} from '~~/server/game/matchmaking/gameReadyClaim'

describe('claimGameReady', () => {
  it('claims a lobby once with a long enough healing TTL', async () => {
    const setnx = vi.fn(() => Effect.succeed(1))
    const redis = { setnx } as never

    expect(await Effect.runPromise(claimGameReady(redis, 'lobby_1', 'server_a'))).toBe(true)
    expect(setnx).toHaveBeenCalledWith(
      gameReadyClaimKey('lobby_1'),
      'server_a',
      GAME_READY_CLAIM_TTL_SECONDS,
    )
  })

  it('rejects a duplicate Pub/Sub delivery', async () => {
    const redis = { setnx: vi.fn(() => Effect.succeed(0)) } as never
    expect(await Effect.runPromise(claimGameReady(redis, 'lobby_1', 'server_b'))).toBe(false)
  })
})

describe('gameIdForLobby', () => {
  it('derives a stable game id from the lobby id', () => {
    expect(gameIdForLobby('lobby_42')).toBe('game_lobby_42')
  })
})

/** Owner audit item 1: durable game_ready handoff. */
describe('game_ready pending handoff', () => {
  const payload: GameReadyPayload = {
    lobbyId: 'lobby_42',
    mode: 'ranked_5v5',
    mapId: 'default_5v5',
    players: [{ playerId: 'p1', team: 'chaff', heroId: 'echo', mmr: 1000 }],
  }

  it('mirrors the payload with a bounded TTL, keyed by gameId', async () => {
    const set = vi.fn(() => Effect.void)
    const redis = { set } as never

    await Effect.runPromise(writeGameReadyPending(redis, 'game_lobby_42', payload))

    expect(set).toHaveBeenCalledWith(
      gameReadyPendingKey('game_lobby_42'),
      JSON.stringify(payload),
      GAME_READY_PENDING_TTL_SECONDS,
    )
  })

  it('deletes the pending mirror by gameId', async () => {
    const del = vi.fn(() => Effect.void)
    const redis = { del } as never

    await Effect.runPromise(deleteGameReadyPending(redis, 'game_lobby_42'))

    expect(del).toHaveBeenCalledWith(gameReadyPendingKey('game_lobby_42'))
  })

  it('sweep finds and parses every pending payload', async () => {
    const redis = {
      scan: vi.fn(() => Effect.succeed([gameReadyPendingKey('game_lobby_42')])),
      get: vi.fn(() => Effect.succeed(JSON.stringify(payload))),
    } as never

    const found = await Effect.runPromise(sweepGameReadyPending(redis))
    expect(found).toEqual([payload])
  })

  it('sweep skips corrupt entries instead of throwing', async () => {
    const redis = {
      scan: vi.fn(() =>
        Effect.succeed([gameReadyPendingKey('game_bad'), gameReadyPendingKey('game_good')]),
      ),
      get: vi.fn((key: string) =>
        Effect.succeed(key.includes('game_bad') ? 'not json' : JSON.stringify(payload)),
      ),
    } as never

    const found = await Effect.runPromise(sweepGameReadyPending(redis))
    expect(found).toEqual([payload])
  })

  it('sweep returns nothing when there are no pending keys', async () => {
    const redis = {
      scan: vi.fn(() => Effect.succeed([])),
      get: vi.fn(),
    } as never

    expect(await Effect.runPromise(sweepGameReadyPending(redis))).toEqual([])
    expect(redis.get).not.toHaveBeenCalled()
  })
})
