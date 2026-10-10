import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { H3Event } from 'h3'

// Failure paths of the Neon queue endpoints: a join that loses the
// unique-violation race is a 409, and a formed match whose game fails to start
// is a surfaced 503 (startFormedMatch has already requeued the players).

let sessionUser: { user?: { id?: string; username?: string } } | null = null
let requestBody: unknown = {}

vi.stubGlobal('defineEventHandler', (fn: (event: H3Event) => unknown) => fn)
vi.stubGlobal('getUserSession', async () => sessionUser)
vi.stubGlobal('readBody', async () => requestBody)
vi.stubGlobal('createError', (opts: { statusCode: number; message: string }) => {
  const err = new Error(opts.message) as Error & { statusCode: number }
  err.statusCode = opts.statusCode
  return err
})

vi.mock('~~/server/utils/RateLimiter', () => ({ checkScopedRateLimit: vi.fn(() => true) }))
vi.mock('~~/server/db', () => ({
  useDb: () => ({
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => [{ username: 'alice', mmr: 1000 }] }) }),
    }),
  }),
}))

const joinQueueMock = vi.fn()
const checkQueueStatusNeonMock = vi.fn()
vi.mock('~~/server/game/matchmaking/queueNeon', () => ({
  joinQueue: (...a: unknown[]) => joinQueueMock(...a),
  isPlayerInQueue: async () => false,
  queueSize: async () => 0,
  rosterIncludes: (m: { roster: { playerId: string }[] }, id: string) =>
    m.roster.some((p) => p.playerId === id),
  checkQueueStatusNeon: (...a: unknown[]) => checkQueueStatusNeonMock(...a),
}))
const startFormedMatchMock = vi.fn()
vi.mock('~~/server/game/matchmaking/matchStart', () => ({
  startFormedMatch: (...a: unknown[]) => startFormedMatchMock(...a),
}))
vi.mock('~~/server/game/liveGame', () => ({ findLiveGameForPlayer: async () => null }))

const join = (await import('~~/server/api/queue/join-neon.post')).default as unknown as (
  e: H3Event,
) => Promise<unknown>
const status = (await import('~~/server/api/queue/status-neon.get')).default as unknown as (
  e: H3Event,
) => Promise<unknown>
const ev = {} as H3Event

const match = {
  mode: '1v1',
  players: [],
  bots: [],
  roster: [{ playerId: 'p1', username: 'alice', mmr: 1000, mode: '1v1' }],
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionUser = { user: { id: 'p1', username: 'alice' } }
  requestBody = { mode: '1v1' }
})

describe('POST /api/queue/join-neon — failures', () => {
  it('maps the join unique-violation race (409 from the queue layer) to a 409', async () => {
    joinQueueMock.mockRejectedValue(
      Object.assign(new Error('already in queue'), { statusCode: 409 }),
    )
    await expect(join(ev)).rejects.toMatchObject({ statusCode: 409, message: 'Already in queue' })
  })

  it('does not swallow an unrelated queue error as a 409', async () => {
    joinQueueMock.mockRejectedValue(new Error('connection reset'))
    await expect(join(ev)).rejects.toThrow('connection reset')
    await expect(join(ev)).rejects.not.toMatchObject({ statusCode: 409 })
  })

  it('surfaces a failed game start as a 503 (the players were requeued, not dropped)', async () => {
    joinQueueMock.mockResolvedValue({ matched: true, match })
    startFormedMatchMock.mockRejectedValue(new Error('workflow start failed'))
    await expect(join(ev)).rejects.toMatchObject({ statusCode: 503 })
    expect(startFormedMatchMock).toHaveBeenCalledWith(match)
  })
})

describe('GET /api/queue/status-neon — failures', () => {
  it('surfaces a failed game start as a 503 instead of an unhandled 500', async () => {
    checkQueueStatusNeonMock.mockResolvedValue({ status: 'matched', match })
    startFormedMatchMock.mockRejectedValue(new Error('workflow start failed'))
    await expect(status(ev)).rejects.toMatchObject({ statusCode: 503 })
  })
})
