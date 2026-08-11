import { randomBytes } from 'node:crypto'
import { checkScopedRateLimit } from '~~/server/utils/RateLimiter'

/**
 * Mint an ephemeral guest session so a brand-new visitor can click
 * "PRACTICE VS BOTS" and actually play — no signup wall on the first touch.
 * The account exists only in the signed session cookie: no `players` DB row
 * is created, nothing is persisted. `guest: true` on the session user is the
 * flag every identity-touching endpoint (queue join, tutorial completion
 * persistence, profile/settings) checks to skip DB reads/writes for this id.
 *
 * An account is only needed to KEEP progress — a guest who later registers
 * or signs in gets a real, persisted identity from that point on.
 */
export default defineEventHandler(async (event) => {
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
  if (!checkScopedRateLimit('guestSession', ip)) {
    throw createError({ statusCode: 429, message: 'Too many guest sessions — try again shortly' })
  }

  // 6 random bytes → 12 hex chars: enough entropy that two guests never
  // collide on a playerId, short enough to read as a handle in the UI.
  const suffix = randomBytes(6).toString('hex')
  const id = `guest_${suffix}`
  const username = `GUEST-${suffix.slice(0, 4).toUpperCase()}`

  await setUserSession(event, {
    user: {
      id,
      username,
      avatarUrl: null,
      selectedAvatar: null,
      // 'local' is a real DB enum value used elsewhere to query players by
      // provider; guests never reach a DB query keyed on it. `guest: true`
      // is the actual discriminator — see shared/types/auth.d.ts.
      provider: 'local',
      hasPassword: false,
      tutorialCompleted: false,
      guest: true,
    },
  })

  return {
    user: {
      id,
      username,
      guest: true,
    },
  }
})
