import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { H3Event } from 'h3'

// ── Stubs for Nitro/h3 auto-imports (same pattern as ablyTokenEndpoint.test.ts) ──

let sessionUser: { user?: { id?: string } } | null = null
let requestBody: unknown = {}
let thrownError: { statusCode: number; message: string } | null = null

function makeEvent(): H3Event {
  return { method: 'POST', path: '/api/game/practice', context: {} } as unknown as H3Event
}

vi.stubGlobal('defineEventHandler', (fn: (event: H3Event) => unknown) => fn)
vi.stubGlobal('getUserSession', async () => sessionUser)
vi.stubGlobal('readBody', async () => requestBody)
vi.stubGlobal('createError', (opts: { statusCode: number; message: string }) => {
  thrownError = opts
  const err = new Error(opts.message) as Error & { statusCode: number }
  err.statusCode = opts.statusCode
  throw err
})

vi.mock('~~/server/utils/RateLimiter', () => ({
  checkScopedRateLimit: vi.fn(() => true),
}))

interface StartedArgs {
  players: { playerId: string; team: string; heroId: string; mmr: number }[]
  opts?: {
    gameId?: string
    mode?: string
    mapId?: string
    botOptions?: { difficulty?: string; forceLane?: string }
  }
}
const startLiveGameMock = vi.fn(
  async (players: StartedArgs['players'], opts?: StartedArgs['opts']) => ({
    gameId: opts?.gameId ?? 'prac_generated',
  }),
)
vi.mock('~~/server/game/liveGame', () => ({
  startLiveGame: (...args: Parameters<typeof startLiveGameMock>) => startLiveGameMock(...args),
}))

const handler = (await import('~~/server/api/game/practice.post')).default
const { checkScopedRateLimit } = await import('~~/server/utils/RateLimiter')

describe('POST /api/game/practice', () => {
  beforeEach(() => {
    sessionUser = null
    requestBody = {}
    thrownError = null
    vi.clearAllMocks()
    vi.mocked(checkScopedRateLimit).mockReturnValue(true)
    startLiveGameMock.mockImplementation(async (_players, opts) => ({
      gameId: opts?.gameId ?? 'prac_generated',
    }))
  })

  it('401s when not signed in', async () => {
    await expect(handler(makeEvent())).rejects.toThrow()
    expect(thrownError?.statusCode).toBe(401)
    expect(startLiveGameMock).not.toHaveBeenCalled()
  })

  it('429s when rate-limited', async () => {
    sessionUser = { user: { id: 'p1' } }
    vi.mocked(checkScopedRateLimit).mockReturnValue(false)
    await expect(handler(makeEvent())).rejects.toThrow()
    expect(thrownError?.statusCode).toBe(429)
    expect(startLiveGameMock).not.toHaveBeenCalled()
  })

  it('allows a GUEST session — practice vs bots is the one mode a guest can play', async () => {
    sessionUser = { user: { id: 'guest_abc123' } }
    const result = await handler(makeEvent())
    expect(result).toEqual({ gameId: expect.any(String) })
    expect(startLiveGameMock).toHaveBeenCalledTimes(1)
  })

  it('builds a 4-player tutorial roster (human + 3 bots), mode tutorial, mapId one_lane, bots pinned to coldstore', async () => {
    sessionUser = { user: { id: 'p1' } }
    await handler(makeEvent())

    expect(startLiveGameMock).toHaveBeenCalledTimes(1)
    const [players, opts] = startLiveGameMock.mock.calls[0]!
    expect(players).toHaveLength(4)
    expect(players[0]).toMatchObject({ playerId: 'p1', team: 'chaff', mmr: 1000 })
    expect(new Set(players.map((p) => p.heroId)).size).toBe(4) // distinct heroes
    expect(opts).toMatchObject({
      mode: 'tutorial',
      mapId: 'one_lane',
      botOptions: { difficulty: 'easy', forceLane: 'coldstore' },
    })
  })

  it('honors an explicit heroSelf and a valid difficulty', async () => {
    sessionUser = { user: { id: 'p1' } }
    requestBody = { heroSelf: 'daemon', difficulty: 'hard' }
    await handler(makeEvent())

    const [players, opts] = startLiveGameMock.mock.calls[0]!
    expect(players[0]).toMatchObject({ playerId: 'p1', heroId: 'daemon' })
    expect(opts?.botOptions).toMatchObject({ difficulty: 'hard' })
  })

  it('falls back to a default hero for an unrecognised heroSelf, and to easy for an unrecognised difficulty', async () => {
    sessionUser = { user: { id: 'p1' } }
    requestBody = { heroSelf: 'not-a-real-hero', difficulty: 'nonsense' }
    await handler(makeEvent())

    const [players, opts] = startLiveGameMock.mock.calls[0]!
    expect(players[0]!.heroId).not.toBe('not-a-real-hero')
    expect(opts?.botOptions).toMatchObject({ difficulty: 'easy' })
  })

  it('returns the gameId startLiveGame produced', async () => {
    sessionUser = { user: { id: 'p1' } }
    startLiveGameMock.mockResolvedValueOnce({ gameId: 'prac_xyz' })
    const result = await handler(makeEvent())
    expect(result).toEqual({ gameId: 'prac_xyz' })
  })
})
