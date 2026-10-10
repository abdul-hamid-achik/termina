import { describe, it, expect, beforeEach, vi } from 'vitest'
import type * as DrizzleOrm from 'drizzle-orm'

interface TokenRow {
  token: string
  playerId: string
  purpose: string
  expiresAt: Date
}

let store: Map<string, TokenRow>

// authTokens.ts only ever calls `and(eq(authTokens.token, t), eq(authTokens.purpose, p))`,
// so `eq`/`and` just need to hand the column name + value back to the fake
// `where` below — no real SQL AST needed. `relations` (used by
// server/db/schema.ts's table definitions) must stay real, so this partially
// mocks rather than replacing the module.
interface FakeCond {
  column: string
  value: string
}
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof DrizzleOrm>()
  return {
    ...actual,
    eq: (column: { name: string }, value: string) => ({ column: column.name, value }),
    and: (...conds: FakeCond[]) => conds,
  }
})

vi.mock('~~/server/db', () => ({
  useDb: () => ({
    insert: () => ({
      values: async (row: TokenRow) => {
        store.set(row.token, row)
      },
    }),
    delete: () => ({
      where: (cond: FakeCond | FakeCond[]) => ({
        returning: async () => {
          const conds = Array.isArray(cond) ? cond : [cond]
          const byToken = conds.find((c) => c.column === 'token')!.value
          const row = store.get(byToken)
          if (!row) return []
          // Honour every predicate the query sends (token AND purpose) —
          // a row that does not satisfy them is NOT deleted.
          const purpose = conds.find((c) => c.column === 'purpose')
          if (purpose && row.purpose !== purpose.value) return []
          store.delete(byToken)
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
    // A reset token can't be redeemed as a verify token, and vice-versa.
    expect(await consumeVerifyToken(reset)).toBeNull()
    expect(await consumeResetToken(verify)).toBeNull()
  })

  it('a wrong-purpose attempt does NOT burn the token (a verify link pasted into reset stays redeemable)', async () => {
    const verify = await createVerifyToken('player_5')
    expect(await consumeResetToken(verify)).toBeNull()
    expect(await consumeVerifyToken(verify)).toBe('player_5')
    // ...and it is still single-use once redeemed under the right purpose.
    expect(await consumeVerifyToken(verify)).toBeNull()
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
