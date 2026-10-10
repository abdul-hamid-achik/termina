import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { H3Event } from 'h3'

let sessionUser: { user?: { id?: string }; secure?: { formerGuestId?: string } } | null = null
let requestBody: unknown = {}

vi.stubGlobal('defineEventHandler', (fn: (event: H3Event) => unknown) => fn)
vi.stubGlobal('getUserSession', async () => sessionUser)
vi.stubGlobal('readBody', async () => requestBody)
vi.stubGlobal('createError', (opts: { statusCode: number; message: string; data?: unknown }) => {
  const err = new Error(opts.message) as Error & { statusCode: number; data?: unknown }
  err.statusCode = opts.statusCode
  err.data = opts.data
  return err
})
vi.mock('~~/server/utils/RateLimiter', () => ({ checkRateLimit: vi.fn(() => true) }))

// select() is called up to twice: the initial row load, then (only when the
// atomic insert is refused) a re-read to explain why.
let selectResults: unknown[][] = []
const execute = vi.fn()
const dbMock = {
  select: vi.fn(() => ({
    from: () => ({ where: () => ({ limit: async () => selectResults.shift() ?? [] }) }),
  })),
  execute: (...a: unknown[]) => execute(...a),
}
vi.mock('~~/server/db', () => ({ useDb: () => dbMock }))

const handler = (await import('~~/server/api/game/action.post')).default as (
  e: H3Event,
) => Promise<Record<string, unknown>>
const event = {} as H3Event

function liveRow(cycle: number, phase = 'playing', aiControlled = false) {
  return {
    gameId: 'g1',
    cycle,
    state: { phase, players: { p1: { aiControlled } } },
    roster: { players: [{ playerId: 'p1', team: 'chaff', heroId: 'echo', mmr: 1000 }] },
  }
}

describe('POST /api/game/action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionUser = { user: { id: 'p1' } }
    requestBody = { gameId: 'g1', command: { type: 'harden' } }
    selectResults = []
    execute.mockResolvedValue([{ id: 1 }])
  })

  it('accepts an order for the open cycle through ONE atomic conditional insert', async () => {
    selectResults = [[liveRow(5)]]
    requestBody = { gameId: 'g1', command: { type: 'harden' }, forCycle: 5, clientSeq: 9 }

    const res = await handler(event)

    expect(res).toMatchObject({ type: 'action_ack', accepted: true, cycle: 5, clientSeq: 9 })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('rejects orders for an ended game without queueing anything', async () => {
    selectResults = [[liveRow(40, 'ended')]]

    const res = await handler(event)

    expect(res).toMatchObject({ type: 'action_ack', accepted: false, reason: 'late', cycle: 40 })
    expect(execute).not.toHaveBeenCalled()
  })

  it('rejects a stale or future forCycle up front', async () => {
    selectResults = [[liveRow(5)]]
    requestBody = { gameId: 'g1', command: { type: 'harden' }, forCycle: 4 }
    expect(await handler(event)).toMatchObject({ accepted: false, reason: 'late' })

    selectResults = [[liveRow(5)]]
    requestBody = { gameId: 'g1', command: { type: 'harden' }, forCycle: 6 }
    expect(await handler(event)).toMatchObject({ accepted: false, reason: 'future' })
    expect(execute).not.toHaveBeenCalled()
  })

  it('does NOT ack accepted when a tick commits between the read and the insert', async () => {
    // Row read says cycle 5, but by the time the insert runs the tick has
    // committed cycle 6: the conditional insert affects 0 rows.
    selectResults = [[liveRow(5)], [{ cycle: 6, state: { phase: 'playing' } }]]
    execute.mockResolvedValue([])
    requestBody = { gameId: 'g1', command: { type: 'harden' }, forCycle: 5 }

    const res = await handler(event)

    expect(res).toMatchObject({ type: 'action_ack', accepted: false, reason: 'late', cycle: 6 })
  })

  it('reports the game as over if it ended between the read and the insert', async () => {
    selectResults = [[liveRow(5)], [{ cycle: 6, state: { phase: 'ended' } }]]
    execute.mockResolvedValue([])
    requestBody = { gameId: 'g1', command: { type: 'harden' } }

    expect(await handler(event)).toMatchObject({ accepted: false, reason: 'late', cycle: 6 })
  })

  it('404s when the game vanished during a refused insert', async () => {
    selectResults = [[liveRow(5)], []]
    execute.mockResolvedValue([])
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('403s for a player not on the roster', async () => {
    selectResults = [[liveRow(5)]]
    sessionUser = { user: { id: 'intruder' } }
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 403 })
  })

  describe('a guest who signed in while their practice game ran (playtest 2)', () => {
    function guestRow() {
      return {
        ...liveRow(5),
        roster: { players: [{ playerId: 'guest_abc', team: 'chaff', heroId: 'echo', mmr: 1000 }] },
      }
    }

    it('409 GAME_SESSION_CHANGED with a message the old tab can show — nothing queued', async () => {
      selectResults = [[guestRow()]]
      sessionUser = { user: { id: 'local_new' }, secure: { formerGuestId: 'guest_abc' } }
      await expect(handler(event)).rejects.toMatchObject({
        statusCode: 409,
        message: 'You signed in — this guest practice ended. Start a new one.',
        data: { code: 'GAME_SESSION_CHANGED' },
      })
      expect(execute).not.toHaveBeenCalled()
    })

    it('a former guest of a DIFFERENT game is still just not on this roster (403)', async () => {
      selectResults = [[guestRow()]]
      sessionUser = { user: { id: 'local_new' }, secure: { formerGuestId: 'guest_zzz' } }
      await expect(handler(event)).rejects.toMatchObject({ statusCode: 403 })
    })
  })

  describe('AFK-converted (aiControlled) humans', () => {
    it('rejects their orders with a clear 409 instead of acking and then being overridden by the bot', async () => {
      selectResults = [[liveRow(5, 'playing', true)]]
      requestBody = { gameId: 'g1', command: { type: 'harden' } }

      await expect(handler(event)).rejects.toMatchObject({
        statusCode: 409,
        message: expect.stringMatching(/taken over by AI/),
      })
      expect(execute).not.toHaveBeenCalled()
    })

    it('still accepts a surrender vote from a converted player', async () => {
      selectResults = [[liveRow(5, 'playing', true)]]
      requestBody = { gameId: 'g1', command: { type: 'surrender', vote: 'yes' } }

      const res = await handler(event)

      expect(res).toMatchObject({ type: 'action_ack', accepted: true })
      expect(execute).toHaveBeenCalledTimes(1)
    })

    it('does not affect a normal (not converted) player', async () => {
      selectResults = [[liveRow(5, 'playing', false)]]
      const res = await handler(event)
      expect(res).toMatchObject({ accepted: true })
    })
  })
})
