import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { H3Event } from 'h3'

let requestBody: unknown = {}
vi.stubGlobal('defineEventHandler', (fn: (event: H3Event) => unknown) => fn)
vi.stubGlobal('readBody', async () => requestBody)
vi.stubGlobal('createError', (opts: { statusCode: number; message: string }) => {
  const err = new Error(opts.message) as Error & { statusCode: number }
  err.statusCode = opts.statusCode
  return err
})

vi.mock('~~/server/utils/admin', () => ({ requireAdmin: async () => 'admin1' }))
vi.mock('~~/server/utils/ablyRest', () => ({ ablyPublishBatch: async () => undefined }))
vi.mock('~~/server/utils/log', () => ({
  matchLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
const finalizeGame = vi.fn()
const forceDeleteGame = vi.fn()
vi.mock('~~/server/workflows/gameTickCore', () => ({
  finalizeGame: (...a: unknown[]) => finalizeGame(...a),
  forceDeleteGame: (...a: unknown[]) => forceDeleteGame(...a),
}))

// db: select().from().where().limit() → rows; update().set().where().returning()
let selectRows: unknown[][] = []
const setSpy = vi.fn()
let updateResults: unknown[][] = []
const dbMock = {
  select: vi.fn(() => ({
    from: () => ({
      where: () => ({ limit: async () => selectRows.shift() ?? [] }),
    }),
  })),
  update: vi.fn(() => ({
    set: (v: unknown) => {
      setSpy(v)
      return { where: () => ({ returning: async () => updateResults.shift() ?? [] }) }
    },
  })),
}
vi.mock('~~/server/db', () => ({ useDb: () => dbMock }))

const handler = (await import('~~/server/api/admin/halt-game.post')).default as (
  e: H3Event,
) => Promise<{ halted: string[]; unrecorded: string[] }>
const event = {} as H3Event

const row = (cycle: number, phase = 'playing') => ({
  gameId: 'g1',
  cycle,
  state: { phase, cycle, runEpoch: 'wrun_1', players: {} },
  roster: { players: [{ playerId: 'p1', team: 'chaff', heroId: 'echo', mmr: 1000 }] },
})

describe('POST /api/admin/halt-game', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requestBody = { gameId: 'g1' }
    selectRows = [[row(7)]]
    updateResults = [[{ gameId: 'g1' }]]
    finalizeGame.mockResolvedValue(undefined)
    forceDeleteGame.mockResolvedValue(undefined)
  })

  it('bumps the cycle (column AND state) so an in-flight tick loses its CAS and cannot undo the halt', async () => {
    const res = await handler(event)

    const set = setSpy.mock.calls[0]![0] as {
      cycle: number
      state: { phase: string; cycle: number; runEpoch: string }
    }
    expect(set.state.phase).toBe('ended')
    expect(set.cycle).toBe(8)
    expect(set.state.cycle).toBe(8)
    expect(set.state.runEpoch).toBe('wrun_1')
    expect(finalizeGame).toHaveBeenCalledWith('g1')
    expect(res).toEqual({ halted: ['g1'], unrecorded: [] })
  })

  it('retries after losing the CAS to an in-flight tick, re-reading the new cycle', async () => {
    selectRows = [[row(7)], [row(8)]]
    updateResults = [[], [{ gameId: 'g1' }]]

    const res = await handler(event)

    expect(setSpy).toHaveBeenCalledTimes(2)
    expect((setSpy.mock.calls[1]![0] as { cycle: number }).cycle).toBe(9)
    expect(res.halted).toEqual(['g1'])
  })

  it('always frees the players: force-deletes the rows when finalize throws', async () => {
    finalizeGame.mockRejectedValue(new Error('neon down'))

    const res = await handler(event)

    expect(forceDeleteGame).toHaveBeenCalledWith('g1')
    expect(res).toEqual({ halted: ['g1'], unrecorded: ['g1'] })
  })

  it('does not force-delete when finalize succeeds', async () => {
    await handler(event)
    expect(forceDeleteGame).not.toHaveBeenCalled()
  })

  it('skips the state write for a row that is already ended but still finalizes it', async () => {
    selectRows = [[row(7, 'ended')]]
    await handler(event)
    expect(setSpy).not.toHaveBeenCalled()
    expect(finalizeGame).toHaveBeenCalledWith('g1')
  })
})
