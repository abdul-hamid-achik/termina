/**
 * Guest practice (audit finding: the PRACTICE CTA dead-ended new visitors at a
 * login wall). Covers:
 *  - isGuestId: the shared predicate every identity-touching endpoint uses.
 *  - POST /api/auth/guest: session shape + per-IP rate limiting.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { H3Event } from 'h3'

const { isGuestId } = await import('~~/server/utils/guest')

describe('isGuestId', () => {
  it('matches a guest session id', () => {
    expect(isGuestId('guest_a1b2c3d4e5f6')).toBe(true)
  })

  it('does not match a real player id', () => {
    expect(isGuestId('github_7379966')).toBe(false)
    expect(isGuestId('local_9f2c1e')).toBe(false)
  })

  it('does not match a bot id', () => {
    expect(isGuestId('bot_r0_dev_123')).toBe(false)
  })

  it('is a prefix match, not a substring match', () => {
    // A real id that merely contains "guest_" mid-string must not be treated
    // as ephemeral — same discipline as isPracticeGame's dev_ prefix check.
    expect(isGuestId('local_guest_lookalike')).toBe(false)
  })
})

// ── POST /api/auth/guest ────────────────────────────────────────────

let requestHeaders: Record<string, string> = {}
let thrownError: { statusCode: number; message: string } | null = null
let sessionCalls: Array<{ user: Record<string, unknown> }> = []
let rateLimitAllowed = true
let rateLimitCalls: Array<[string, string]> = []

function makeEvent(): H3Event {
  return {
    method: 'POST',
    path: '/api/auth/guest',
    node: { req: { method: 'POST', headers: requestHeaders }, res: {} },
    context: {},
  } as unknown as H3Event
}

vi.stubGlobal('defineEventHandler', (fn: (event: H3Event) => unknown) => fn)
vi.stubGlobal('createError', (opts: { statusCode: number; message: string }) => {
  thrownError = opts
  const err = new Error(opts.message) as Error & { statusCode: number }
  err.statusCode = opts.statusCode
  throw err
})
vi.stubGlobal('getRequestIP', () => '203.0.113.5')
vi.stubGlobal(
  'setUserSession',
  async (_event: H3Event, payload: { user: Record<string, unknown> }) => {
    sessionCalls.push(payload)
  },
)

vi.mock('~~/server/utils/RateLimiter', () => ({
  checkScopedRateLimit: vi.fn((scope: string, key: string) => {
    rateLimitCalls.push([scope, key])
    return rateLimitAllowed
  }),
}))

const guestHandler = (await import('~~/server/api/auth/guest.post')).default

describe('POST /api/auth/guest', () => {
  beforeEach(() => {
    requestHeaders = {}
    thrownError = null
    sessionCalls = []
    rateLimitCalls = []
    rateLimitAllowed = true
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('mints a session-only guest user: no username/password, guest: true', async () => {
    const result = await guestHandler(makeEvent())

    expect(sessionCalls).toHaveLength(1)
    const stamped = sessionCalls[0]!.user
    expect(stamped.guest).toBe(true)
    expect(typeof stamped.id).toBe('string')
    expect(stamped.id as string).toMatch(/^guest_[0-9a-f]{12}$/)
    expect(stamped.hasPassword).toBe(false)
    expect(stamped.tutorialCompleted).toBe(false)
    expect((result as { user: { guest: boolean } }).user.guest).toBe(true)
  })

  it('mints a distinct id on every call — no collisions across guests', async () => {
    const first = (await guestHandler(makeEvent())) as { user: { id: string } }
    const second = (await guestHandler(makeEvent())) as { user: { id: string } }
    expect(first.user.id).not.toBe(second.user.id)
  })

  it('rate-limits by IP in the guestSession scope', async () => {
    await guestHandler(makeEvent())
    expect(rateLimitCalls).toContainEqual(['guestSession', '203.0.113.5'])
  })

  it('429s and mints nothing once the per-IP limit is hit', async () => {
    rateLimitAllowed = false
    await expect(guestHandler(makeEvent())).rejects.toThrow()
    expect(thrownError?.statusCode).toBe(429)
    expect(sessionCalls).toHaveLength(0)
  })
})
