import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { H3Event } from 'h3'

let sessionUser: { user?: { id?: string } } | null = { user: { id: 'p1' } }

function makeEvent(): H3Event {
  return { method: 'GET', path: '/api/queue/status-neon', context: {} } as unknown as H3Event
}

vi.stubGlobal('defineEventHandler', (fn: (event: H3Event) => unknown) => fn)
vi.stubGlobal('getUserSession', async () => sessionUser)

const findLiveGameForPlayerMock = vi.fn(async () => null as string | null)
vi.mock('~~/server/game/liveGame', () => ({
  findLiveGameForPlayer: (...args: unknown[]) => findLiveGameForPlayerMock(...args),
}))

const checkQueueStatusNeonMock = vi.fn()
vi.mock('~~/server/game/matchmaking/queueNeon', () => ({
  checkQueueStatusNeon: (...args: unknown[]) => checkQueueStatusNeonMock(...args),
}))

const startFormedMatchMock = vi.fn(async () => ({ gameId: 'q_9' }))
vi.mock('~~/server/game/matchmaking/matchStart', () => ({
  startFormedMatch: (...args: unknown[]) => startFormedMatchMock(...args),
}))

let joinedAtRow: { joinedAt: Date } | null = null
const dbMock = {
  select: vi.fn(() => ({
    from: () => ({ where: () => ({ limit: async () => (joinedAtRow ? [joinedAtRow] : []) }) }),
  })),
}
vi.mock('~~/server/db', () => ({ useDb: () => dbMock }))

const handler = (await import('~~/server/api/queue/status-neon.get')).default

describe('GET /api/queue/status-neon', () => {
  beforeEach(() => {
    sessionUser = { user: { id: 'p1' } }
    joinedAtRow = null
    vi.clearAllMocks()
    findLiveGameForPlayerMock.mockResolvedValue(null)
    checkQueueStatusNeonMock.mockResolvedValue({ status: 'idle' })
    startFormedMatchMock.mockResolvedValue({ gameId: 'q_9' })
  })

  it('reports idle with no session, never touching the DB', async () => {
    sessionUser = null
    const result = await handler(makeEvent())
    expect(result).toEqual({ status: 'idle' })
    expect(findLiveGameForPlayerMock).not.toHaveBeenCalled()
  })

  // MUTATION-CHECK target: the exact discriminant that flips a poller from
  // 'searching'/'idle' into a game — pins the live_games check as the FIRST
  // thing consulted (a queue row is already gone once a match starts).
  it('reports found with the live_games gameId BEFORE ever checking the queue table', async () => {
    findLiveGameForPlayerMock.mockResolvedValue('g_live')
    const result = await handler(makeEvent())
    expect(result).toEqual({ status: 'found', gameId: 'g_live' })
    expect(checkQueueStatusNeonMock).not.toHaveBeenCalled()
  })

  it('reports idle when neither a live game nor a queue entry exists', async () => {
    checkQueueStatusNeonMock.mockResolvedValue({ status: 'idle' })
    const result = await handler(makeEvent())
    expect(result).toEqual({ status: 'idle' })
    expect(startFormedMatchMock).not.toHaveBeenCalled()
  })

  it('reports searching with queueSize and botFillDue=false when the wait is short', async () => {
    checkQueueStatusNeonMock.mockResolvedValue({ status: 'searching', queueSize: 3 })
    joinedAtRow = { joinedAt: new Date(Date.now() - 1000) } // 1s, well under the 10s threshold
    const result = await handler(makeEvent())
    expect(result).toEqual({ status: 'searching', queueSize: 3, botFillDue: false })
  })

  it('reports botFillDue=true once the wait crosses the bot-fill threshold', async () => {
    checkQueueStatusNeonMock.mockResolvedValue({ status: 'searching', queueSize: 1 })
    joinedAtRow = { joinedAt: new Date(Date.now() - 15_000) } // > 10s threshold
    const result = await handler(makeEvent())
    expect(result).toEqual({ status: 'searching', queueSize: 1, botFillDue: true })
  })

  // MUTATION-CHECK target: this is the SAME "matched → start the live game →
  // report found" path join-neon exercises for the completing joiner, here
  // exercised for the opportunistic bot-fill/status-poll trigger instead.
  it('starts the live game and reports found when checkQueueStatusNeon reports matched', async () => {
    const match = {
      mode: '1v1',
      players: [],
      bots: [],
      roster: [{ playerId: 'p1', username: 'alice', mmr: 1000, mode: '1v1' }],
    }
    checkQueueStatusNeonMock.mockResolvedValue({ status: 'matched', match })

    const result = await handler(makeEvent())

    expect(startFormedMatchMock).toHaveBeenCalledWith(match)
    expect(result).toEqual({ status: 'found', gameId: 'q_9' })
  })
})
