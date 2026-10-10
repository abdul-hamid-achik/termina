import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'

// Server (Nitro) auth middleware — path/method gating. Complements
// tests/unit/server/auth-middleware.test.ts.

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

const authHandler = (await import('~~/server/middleware/auth')).default as (
  event: H3Event,
) => Promise<unknown>

const ev = (method: string) => ({ method }) as unknown as H3Event

describe('server auth middleware — method + path gating', () => {
  beforeEach(() => {
    currentPath = '/'
    getUserSession.mockReset()
    getUserSession.mockResolvedValue(null)
  })

  it('keeps a public player profile GET public', async () => {
    currentPath = '/api/player/alice'
    await expect(authHandler(ev('GET'))).resolves.toBeUndefined()
  })

  it.each(['PUT', 'POST', 'PATCH', 'DELETE'])(
    '%s on a single-segment /api/player/* path requires a session (password/settings are not public)',
    async (method) => {
      for (const path of ['/api/player/password', '/api/player/settings', '/api/player/alice']) {
        currentPath = path
        await expect(authHandler(ev(method))).rejects.toMatchObject({ statusCode: 401 })
      }
    },
  )

  it('lets a signed-in session PUT /api/player/password through to its handler', async () => {
    currentPath = '/api/player/password'
    getUserSession.mockResolvedValue({ user: { id: 'p1' } })
    await expect(authHandler(ev('PUT'))).resolves.toBeUndefined()
  })

  it('does not treat the account-scoped GET routes as public profiles', async () => {
    for (const path of [
      '/api/player/me',
      '/api/player/stats',
      '/api/player/email-status',
      '/api/player/providers',
    ]) {
      currentPath = path
      await expect(authHandler(ev('GET'))).rejects.toMatchObject({ statusCode: 401 })
    }
  })

  it('only GET /api/match/:id is public', async () => {
    currentPath = '/api/match/m1'
    await expect(authHandler(ev('GET'))).resolves.toBeUndefined()
    await expect(authHandler(ev('DELETE'))).rejects.toMatchObject({ statusCode: 401 })
  })

  it('/api/match/active is no longer a public special case', async () => {
    currentPath = '/api/match/active'
    // falls through the single-segment match rule only as an opaque id (GET),
    // never as an exact-public entry — a POST must be rejected.
    await expect(authHandler(ev('POST'))).rejects.toMatchObject({ statusCode: 401 })
  })

  it('does not special-case /ws — it is just a non-API path like any other', async () => {
    currentPath = '/ws'
    await expect(authHandler(ev('GET'))).resolves.toBeUndefined()
    expect(getUserSession).not.toHaveBeenCalled()
  })

  it('exposes /api/game/start-workflow without a session (it self-gates on WORKFLOW_START_KEY)', async () => {
    currentPath = '/api/game/start-workflow'
    await expect(authHandler(ev('POST'))).resolves.toBeUndefined()
    expect(getUserSession).not.toHaveBeenCalled()
  })

  it('does not make sibling /api/game routes public', async () => {
    for (const path of ['/api/game/action', '/api/game/practice', '/api/game/start-workflow/x']) {
      currentPath = path
      await expect(authHandler(ev('POST'))).rejects.toMatchObject({ statusCode: 401 })
    }
  })
})
