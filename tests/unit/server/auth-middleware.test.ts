import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'

let currentPath = '/'
const getUserSession = vi.fn()

vi.stubGlobal('defineEventHandler', (fn: (event: H3Event) => unknown) => fn)
vi.stubGlobal('getRequestURL', () => ({ pathname: currentPath }))
vi.stubGlobal('getUserSession', getUserSession)
vi.stubGlobal('createError', (opts: { statusCode: number; message: string }) => {
  const error = new Error(opts.message) as Error & { statusCode: number }
  error.statusCode = opts.statusCode
  return error
})

const authHandler = (await import('../../../server/middleware/auth')).default as (
  event: H3Event,
) => Promise<unknown>

const event = {} as H3Event

describe('server auth middleware', () => {
  beforeEach(() => {
    currentPath = '/'
    getUserSession.mockReset()
    getUserSession.mockResolvedValue(null)
  })

  it('does not let the root public path turn every API route public', async () => {
    currentPath = '/api/queue/status'
    await expect(authHandler(event)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('keeps health/readiness, public profiles and replays public', async () => {
    for (const path of [
      '/',
      '/api/health',
      '/api/ready',
      '/api/player/alice',
      '/api/match/m1',
      '/api/replay/g1/frames',
    ]) {
      currentPath = path
      await expect(authHandler(event)).resolves.toBeUndefined()
    }
  })

  it('keeps the authenticated player endpoint protected', async () => {
    currentPath = '/api/player/me'
    await expect(authHandler(event)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('passes a session through to protected API routes', async () => {
    currentPath = '/api/queue/status'
    getUserSession.mockResolvedValue({ user: { id: 'p1' } })
    await expect(authHandler(event)).resolves.toBeUndefined()
  })
})
