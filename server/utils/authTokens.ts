import { Effect } from 'effect'
import { randomBytes } from 'node:crypto'
import type { RedisServiceApi } from '~~/server/services/RedisService'

// Single-use, expiring tokens for password reset + email verification, stored in
// Redis so they auto-expire (TTL) and `getdel` consumes them atomically (a token
// can be redeemed exactly once). Tokens are 256-bit random hex — unguessable.

const RESET_PREFIX = 'auth:pwreset:'
const VERIFY_PREFIX = 'auth:emailverify:'
const RESET_TTL_SECONDS = 60 * 60 // 1 hour
const VERIFY_TTL_SECONDS = 60 * 60 * 24 // 24 hours

function newToken(): string {
  return randomBytes(32).toString('hex')
}

export async function createResetToken(redis: RedisServiceApi, playerId: string): Promise<string> {
  const token = newToken()
  await Effect.runPromise(redis.set(RESET_PREFIX + token, playerId, RESET_TTL_SECONDS))
  return token
}

/** Consume a reset token → playerId, or null if invalid/expired (single-use). */
export async function consumeResetToken(
  redis: RedisServiceApi,
  token: string,
): Promise<string | null> {
  if (!token) return null
  return Effect.runPromise(redis.getdel(RESET_PREFIX + token))
}

export async function createVerifyToken(redis: RedisServiceApi, playerId: string): Promise<string> {
  const token = newToken()
  await Effect.runPromise(redis.set(VERIFY_PREFIX + token, playerId, VERIFY_TTL_SECONDS))
  return token
}

/** Consume a verification token → playerId, or null if invalid/expired. */
export async function consumeVerifyToken(
  redis: RedisServiceApi,
  token: string,
): Promise<string | null> {
  if (!token) return null
  return Effect.runPromise(redis.getdel(VERIFY_PREFIX + token))
}
