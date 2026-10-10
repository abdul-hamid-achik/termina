import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { authTokens } from '~~/server/db/schema'

// Single-use, expiring tokens for password reset + email verification, stored
// in Neon (auth_tokens) so they can be redeemed exactly once — the DELETE ...
// RETURNING in consumeToken atomically reads and removes the row, mirroring
// the old Redis `getdel` behavior. Expired rows are simply never reused;
// there is no background sweep (a stray unredeemed token sitting past its
// expiry is inert — consumeToken rejects it on the expiresAt check below).

const RESET_TTL_SECONDS = 60 * 60 // 1 hour
const VERIFY_TTL_SECONDS = 60 * 60 * 24 // 24 hours

type TokenPurpose = 'reset' | 'verify'

function newToken(): string {
  return randomBytes(32).toString('hex')
}

async function createToken(
  playerId: string,
  purpose: TokenPurpose,
  ttlSeconds: number,
): Promise<string> {
  const token = newToken()
  const db = useDb()
  await db.insert(authTokens).values({
    token,
    playerId,
    purpose,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000),
  })
  return token
}

/** Consume a token of the given purpose → playerId, or null if missing,
 *  expired, or issued for a different purpose. Single-use: the row is deleted
 *  only when BOTH the token and its purpose match (one atomic DELETE ...
 *  RETURNING), so presenting e.g. a verify token to the reset endpoint does
 *  not burn it. A matching-purpose but expired row is still deleted (inert). */
async function consumeToken(token: string, purpose: TokenPurpose): Promise<string | null> {
  if (!token) return null
  const db = useDb()
  const rows = await db
    .delete(authTokens)
    .where(and(eq(authTokens.token, token), eq(authTokens.purpose, purpose)))
    .returning()
  const row = rows[0]
  if (!row) return null
  if (row.expiresAt.getTime() < Date.now()) return null
  return row.playerId
}

/**
 * Constant-time comparison of a presented secret against the expected one.
 * Both sides are hashed first so differing lengths neither throw nor leak
 * the expected length through timing. Returns false for a missing/empty
 * `provided`.
 */
export function secretsMatch(provided: string | null | undefined, expected: string): boolean {
  if (!provided) return false
  const a = createHash('sha256').update(provided).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

export function createResetToken(playerId: string): Promise<string> {
  return createToken(playerId, 'reset', RESET_TTL_SECONDS)
}

export function consumeResetToken(token: string): Promise<string | null> {
  return consumeToken(token, 'reset')
}

export function createVerifyToken(playerId: string): Promise<string> {
  return createToken(playerId, 'verify', VERIFY_TTL_SECONDS)
}

export function consumeVerifyToken(token: string): Promise<string | null> {
  return consumeToken(token, 'verify')
}
