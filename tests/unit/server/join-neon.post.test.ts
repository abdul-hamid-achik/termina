import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { H3Event } from 'h3'

// ── Stubs for Nitro/h3 auto-imports ─────────────────────────────────

let sessionUser: { user?: { id?: string; username?: string } } | null = null
let requestBody: unknown = {}
let thrownError: { statusCode: number; message: string } | null = null

function makeEvent(): H3Event {
  return { method: 'POST', path: '/api/queue/join-neon', context: {} } as unknown as H3Event
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

let playerRow: { username: string; mmr: number } | null = { username: 'alice', mmr: 1000 }
const dbMock = {
  select: vi.fn(() => ({
    from: () => ({ where: () => ({ limit: async () => (playerRow ? [playerRow] : []) }) }),
  })),
}
vi.mock('~~/server/db', () => ({ useDb: () => dbMock }))

const joinQueueMock = vi.fn()
const isPlayerInQueueMock = vi.fn(async () => false)
vi.mock('~~/server/game/matchmaking/queueNeon', () => ({
  joinQueue: (...args: unknown[]) => joinQueueMock(...args),
  isPlayerInQueue: (...args: unknown[]) => isPlayerInQueueMock(...args),
}))

const startFormedMatchMock = vi.fn(async () => ({ gameId: 'q_1' }))
vi.mock('~~/server/game/matchmaking/matchStart', () => ({
  startFormedMatch: (...args: unknown[]) => startFormedMatchMock(...args),
}))

const findLiveGameForPlayerMock = vi.fn(async () => null as string | null)
vi.mock('~~/server/game/liveGame', () => ({
  findLiveGameForPlayer: (...args: unknown[]) => findLiveGameForPlayerMock(...args),
}))

const handler = (await import('~~/server/api/queue/join-neon.post')).default
const { checkScopedRateLimit } = await import('~~/server/utils/RateLimiter')

describe('POST /api/queue/join-neon', () => {
  beforeEach(() => {
    sessionUser = { user: { id: 'p1', username: 'alice' } }
    requestBody = { mode: '1v1' }
    thrownError = null
    playerRow = { username: 'alice', mmr: 1000 }
    vi.clearAllMocks()
    vi.mocked(checkScopedRateLimit).mockReturnValue(true)
    isPlayerInQueueMock.mockResolvedValue(false)
    findLiveGameForPlayerMock.mockResolvedValue(null)
    joinQueueMock.mockResolvedValue({ matched: false, queueSize: 1 })
    startFormedMatchMock.mockResolvedValue({ gameId: 'q_1' })
  })

  it('401s when not signed in', async () => {
    sessionUser = null
    await expect(handler(makeEvent())).rejects.toThrow()
    expect(thrownError?.statusCode).toBe(401)
    expect(joinQueueMock).not.toHaveBeenCalled()
  })

  it('403s a guest session before ever touching the queue', async () => {
    sessionUser = { user: { id: 'guest_abc123' } }
    await expect(handler(makeEvent())).rejects.toThrow()
    expect(thrownError?.statusCode).toBe(403)
    expect(joinQueueMock).not.toHaveBeenCalled()
  })

  it('429s when rate-limited', async () => {
    vi.mocked(checkScopedRateLimit).mockReturnValue(false)
    await expect(handler(makeEvent())).rejects.toThrow()
    expect(thrownError?.statusCode).toBe(429)
    expect(joinQueueMock).not.toHaveBeenCalled()
  })

  it('400s an invalid mode', async () => {
    requestBody = { mode: 'nonsense' }
    await expect(handler(makeEvent())).rejects.toThrow()
    expect(thrownError?.statusCode).toBe(400)
  })

  it('409s when already in an active live game', async () => {
    findLiveGameForPlayerMock.mockResolvedValue('g1')
    await expect(handler(makeEvent())).rejects.toThrow()
    expect(thrownError?.statusCode).toBe(409)
    expect(joinQueueMock).not.toHaveBeenCalled()
  })

  it('409s when already queued', async () => {
    isPlayerInQueueMock.mockResolvedValue(true)
    await expect(handler(makeEvent())).rejects.toThrow()
    expect(thrownError?.statusCode).toBe(409)
    expect(joinQueueMock).not.toHaveBeenCalled()
  })

  it('joins with the players-row username/mmr and returns queueSize when not matched', async () => {
    const result = await handler(makeEvent())
    expect(joinQueueMock).toHaveBeenCalledWith({
      playerId: 'p1',
      username: 'alice',
      mmr: 1000,
      mode: '1v1',
    })
    expect(result).toEqual({ success: true, queueSize: 1 })
    expect(startFormedMatchMock).not.toHaveBeenCalled()
  })

  it('falls back to the session username and 1000 mmr when there is no players row', async () => {
    playerRow = null
    await handler(makeEvent())
    expect(joinQueueMock).toHaveBeenCalledWith({
      playerId: 'p1',
      username: 'alice',
      mmr: 1000,
      mode: '1v1',
    })
  })

  it('starts the live game and returns its gameId when joinQueue reports a formed match', async () => {
    const match = {
      mode: '1v1',
      players: [],
      bots: [],
      roster: [
        { playerId: 'p1', username: 'alice', mmr: 1000, mode: '1v1' },
        { playerId: 'p2', username: 'bob', mmr: 1010, mode: '1v1' },
      ],
    }
    joinQueueMock.mockResolvedValue({ matched: true, match })

    const result = await handler(makeEvent())

    expect(startFormedMatchMock).toHaveBeenCalledWith(match)
    expect(result).toEqual({ success: true, queueSize: 0, gameId: 'q_1' })
  })
})
