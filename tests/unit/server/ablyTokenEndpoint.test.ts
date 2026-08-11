import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { H3Event } from 'h3'

// ── Stubs for Nitro/h3 auto-imports (same pattern as tests/unit/server/api.test.ts) ──

let sessionUser: { user?: { id?: string; guest?: boolean } } | null = null
let thrownError: { statusCode: number; message: string } | null = null

function makeEvent(): H3Event {
  return { method: 'POST', path: '/api/auth/ably-token', context: {} } as unknown as H3Event
}

vi.stubGlobal('defineEventHandler', (fn: (event: H3Event) => unknown) => fn)
vi.stubGlobal('getUserSession', async () => sessionUser)
vi.stubGlobal('createError', (opts: { statusCode: number; message: string }) => {
  thrownError = opts
  const err = new Error(opts.message) as Error & { statusCode: number }
  err.statusCode = opts.statusCode
  throw err
})

vi.mock('~~/server/utils/RateLimiter', () => ({
  checkScopedRateLimit: vi.fn(() => true),
}))
vi.mock('~~/server/utils/ablyToken', () => ({
  mintAblyTokenRequest: vi.fn(async () => ({ id: 'tok1' })),
}))

const handler = (await import('~~/server/api/auth/ably-token.post')).default
const { checkScopedRateLimit } = await import('~~/server/utils/RateLimiter')
const { mintAblyTokenRequest } = await import('~~/server/utils/ablyToken')

describe('POST /api/auth/ably-token', () => {
  beforeEach(() => {
    sessionUser = null
    thrownError = null
    vi.clearAllMocks()
    vi.mocked(checkScopedRateLimit).mockReturnValue(true)
    vi.mocked(mintAblyTokenRequest).mockResolvedValue({ id: 'tok1' })
    delete process.env.ABLY_API_KEY
  })

  it('401s when not authenticated', async () => {
    sessionUser = null
    await expect(handler(makeEvent())).rejects.toThrow()
    expect(thrownError?.statusCode).toBe(401)
    expect(mintAblyTokenRequest).not.toHaveBeenCalled()
  })

  it('allows a GUEST session — realtime transport has no MMR/match-history dependency', async () => {
    sessionUser = { user: { id: 'guest_a1b2c3d4e5f6', guest: true } }
    process.env.ABLY_API_KEY = 'app1.key1:secret1'
    const result = await handler(makeEvent())
    expect(result).toEqual({ id: 'tok1' })
    expect(mintAblyTokenRequest).toHaveBeenCalledWith(
      expect.objectContaining({ playerId: 'guest_a1b2c3d4e5f6', apiKey: 'app1.key1:secret1' }),
    )
  })

  it('429s when rate-limited, before touching ABLY_API_KEY or minting', async () => {
    sessionUser = { user: { id: 'p1' } }
    vi.mocked(checkScopedRateLimit).mockReturnValue(false)
    await expect(handler(makeEvent())).rejects.toThrow()
    expect(thrownError?.statusCode).toBe(429)
    expect(mintAblyTokenRequest).not.toHaveBeenCalled()
  })

  it('503s when ABLY_API_KEY is not configured', async () => {
    sessionUser = { user: { id: 'p1' } }
    delete process.env.ABLY_API_KEY
    await expect(handler(makeEvent())).rejects.toThrow()
    expect(thrownError?.statusCode).toBe(503)
  })

  it('502s when minting fails', async () => {
    sessionUser = { user: { id: 'p1' } }
    process.env.ABLY_API_KEY = 'app1.key1:secret1'
    vi.mocked(mintAblyTokenRequest).mockRejectedValue(new Error('Ably token mint failed (401)'))
    await expect(handler(makeEvent())).rejects.toThrow()
    expect(thrownError?.statusCode).toBe(502)
  })

  it('mints for the authenticated playerId and returns the TokenRequest JSON untouched', async () => {
    sessionUser = { user: { id: 'p1' } }
    process.env.ABLY_API_KEY = 'app1.key1:secret1'
    vi.mocked(mintAblyTokenRequest).mockResolvedValue({ id: 'tok-xyz', mac: 'abc' })
    const result = await handler(makeEvent())
    expect(result).toEqual({ id: 'tok-xyz', mac: 'abc' })
    expect(mintAblyTokenRequest).toHaveBeenCalledWith({
      apiKey: 'app1.key1:secret1',
      playerId: 'p1',
    })
  })
})
