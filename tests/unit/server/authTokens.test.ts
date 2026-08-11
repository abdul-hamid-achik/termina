import { describe, it, expect, beforeEach, vi } from 'vitest'
import type * as DrizzleOrm from 'drizzle-orm'

interface TokenRow {
  token: string
  playerId: string
  purpose: string
  expiresAt: Date
}

let store: Map<string, TokenRow>

// authTokens.ts only ever calls `eq(authTokens.token, token)`, so `eq` just
// needs to hand the token value back to the fake `where` below — no real SQL
// AST needed. `relations` (used by server/db/schema.ts's table definitions)
// must stay real, so this partially mocks rather than replacing the module.
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof DrizzleOrm>()
  return { ...actual, eq: (_column: unknown, value: string) => ({ value }) }
})

vi.mock('~~/server/db', () => ({
  useDb: () => ({
    insert: () => ({
      values: async (row: TokenRow) => {
        store.set(row.token, row)
      },
    }),
    delete: () => ({
      where: (cond: { value: string }) => ({
        returning: async () => {
          const row = store.get(cond.value)
          if (!row) return []
          store.delete(cond.value)
          return [row]
        },
      }),
    }),
  }),
}))

const { createResetToken, consumeResetToken, createVerifyToken, consumeVerifyToken } =
  await import('~~/server/utils/authTokens')

describe('authTokens', () => {
  beforeEach(() => {
    store = new Map()
  })

  it('round-trips a reset token to its playerId', async () => {
    const token = await createResetToken('player_1')
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(await consumeResetToken(token)).toBe('player_1')
  })

  it('reset tokens are single-use', async () => {
    const token = await createResetToken('player_1')
    expect(await consumeResetToken(token)).toBe('player_1')
    expect(await consumeResetToken(token)).toBeNull()
  })

  it('rejects empty / unknown reset tokens', async () => {
    expect(await consumeResetToken('')).toBeNull()
    expect(await consumeResetToken('nope')).toBeNull()
  })

  it('round-trips + single-uses a verify token', async () => {
    const token = await createVerifyToken('player_2')
    expect(await consumeVerifyToken(token)).toBe('player_2')
    expect(await consumeVerifyToken(token)).toBeNull()
  })

  it('namespaces reset vs verify tokens (not interchangeable)', async () => {
    const reset = await createResetToken('player_3')
    const verify = await createVerifyToken('player_3')
    // A reset token can't be redeemed as a verify token, and vice-versa. Both
    // are consumed (deleted) by the mismatched attempt — single-use applies
    // regardless of purpose match.
    expect(await consumeVerifyToken(reset)).toBeNull()
    expect(await consumeResetToken(verify)).toBeNull()
  })

  it('rejects an expired token', async () => {
    store.set('stale-token', {
      token: 'stale-token',
      playerId: 'player_4',
      purpose: 'reset',
      expiresAt: new Date(Date.now() - 1000),
    })
    expect(await consumeResetToken('stale-token')).toBeNull()
  })
})
