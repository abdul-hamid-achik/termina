import { describe, it, expect, vi } from 'vitest'
import { Effect } from 'effect'
import {
  claimGameReady,
  gameReadyClaimKey,
  GAME_READY_CLAIM_TTL_SECONDS,
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
