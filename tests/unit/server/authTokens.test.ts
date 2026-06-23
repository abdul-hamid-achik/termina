import { Effect } from 'effect'
import { describe, it, expect } from 'vitest'
import {
  createResetToken,
  consumeResetToken,
  createVerifyToken,
  consumeVerifyToken,
} from '~~/server/utils/authTokens'
import type { RedisServiceApi } from '~~/server/services/RedisService'

// Minimal in-memory Redis mock — only the methods authTokens uses.
function mockRedis(): RedisServiceApi {
  const store = new Map<string, string>()
  return {
    set: (k: string, v: string) =>
      Effect.sync(() => {
        store.set(k, v)
      }),
    get: (k: string) => Effect.sync(() => store.get(k) ?? null),
    getdel: (k: string) =>
      Effect.sync(() => {
        const v = store.get(k) ?? null
        store.delete(k)
        return v
      }),
  } as unknown as RedisServiceApi
}

describe('authTokens', () => {
  it('round-trips a reset token to its playerId', async () => {
    const redis = mockRedis()
    const token = await createResetToken(redis, 'player_1')
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(await consumeResetToken(redis, token)).toBe('player_1')
  })

  it('reset tokens are single-use', async () => {
    const redis = mockRedis()
    const token = await createResetToken(redis, 'player_1')
    expect(await consumeResetToken(redis, token)).toBe('player_1')
    expect(await consumeResetToken(redis, token)).toBeNull()
  })

  it('rejects empty / unknown reset tokens', async () => {
    const redis = mockRedis()
    expect(await consumeResetToken(redis, '')).toBeNull()
    expect(await consumeResetToken(redis, 'nope')).toBeNull()
  })

  it('round-trips + single-uses a verify token', async () => {
    const redis = mockRedis()
    const token = await createVerifyToken(redis, 'player_2')
    expect(await consumeVerifyToken(redis, token)).toBe('player_2')
    expect(await consumeVerifyToken(redis, token)).toBeNull()
  })

  it('namespaces reset vs verify tokens (not interchangeable)', async () => {
    const redis = mockRedis()
    const reset = await createResetToken(redis, 'player_3')
    const verify = await createVerifyToken(redis, 'player_3')
    // A reset token can't be redeemed as a verify token, and vice-versa.
    expect(await consumeVerifyToken(redis, reset)).toBeNull()
    expect(await consumeResetToken(redis, verify)).toBeNull()
    // Originals still valid in their own namespace.
    expect(await consumeResetToken(redis, reset)).toBe('player_3')
    expect(await consumeVerifyToken(redis, verify)).toBe('player_3')
  })
})
