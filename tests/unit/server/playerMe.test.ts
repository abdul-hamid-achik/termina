import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { H3Event } from 'h3'
import { Effect } from 'effect'

/**
 * GET /api/player/me used to 404 for every guest (no `players` row by design):
 * console noise on every page that asked. A guest now gets the account shape
 * from the session, flagged `guest: true`, with no DB read and no re-stamp.
 */

let session: { user?: Record<string, unknown> } | null = null
const setUserSession = vi.fn()
const getPlayer = vi.fn()

vi.stubGlobal('defineEventHandler', (fn: (event: H3Event) => unknown) => fn)
vi.stubGlobal('getUserSession', async () => session)
vi.stubGlobal('setUserSession', setUserSession)
vi.stubGlobal('createError', (opts: { statusCode: number; message: string }) => {
  const err = new Error(opts.message) as Error & { statusCode: number }
  err.statusCode = opts.statusCode
  return err
})
vi.mock('~~/server/plugins/game-server', () => ({
  getGameRuntime: () => ({ dbService: { getPlayer: (id: string) => getPlayer(id) } }),
}))

const handler = (await import('~~/server/api/player/me.get')).default as (
  e: H3Event,
) => Promise<{ user: Record<string, unknown> }>
const event = {} as H3Event

describe('GET /api/player/me', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('answers a guest from the session — 200, guest-flagged, no DB read, no re-stamp', async () => {
    session = {
      user: {
        id: 'guest_a1b2c3d4e5f6',
        username: 'GUEST-A1B2',
        avatarUrl: null,
        selectedAvatar: null,
        provider: 'local',
        hasPassword: false,
        tutorialCompleted: false,
        guest: true,
      },
    }
    const res = await handler(event)
    expect(res).toEqual({
      user: {
        id: 'guest_a1b2c3d4e5f6',
        username: 'GUEST-A1B2',
        avatarUrl: null,
        selectedAvatar: null,
        tutorialCompleted: false,
        guest: true,
      },
    })
    expect(getPlayer).not.toHaveBeenCalled()
    expect(setUserSession).not.toHaveBeenCalled()
  })

  it('still reads and re-stamps a real account', async () => {
    session = { user: { id: 'local_1', username: 'x', provider: 'local' } }
    getPlayer.mockReturnValue(
      Effect.succeed({
        id: 'local_1',
        username: 'x',
        avatarUrl: null,
        selectedAvatar: null,
        passwordHash: 'h',
        tutorialCompleted: true,
      }),
    )
    const res = await handler(event)
    expect(res.user).toMatchObject({ id: 'local_1', tutorialCompleted: true })
    expect(res.user.guest).toBeUndefined()
    expect(setUserSession).toHaveBeenCalledTimes(1)
  })

  it('401s without a session', async () => {
    session = null
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 401 })
  })
})
