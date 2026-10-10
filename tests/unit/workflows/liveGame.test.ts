import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'

const insertValues = vi.fn(async () => undefined)
const deleteWhere = vi.fn(async () => undefined)
const dbMock = {
  insert: vi.fn(() => ({ values: insertValues })),
  delete: vi.fn(() => ({ where: deleteWhere })),
}
vi.mock('~~/server/db', () => ({ useDb: () => dbMock }))
const startMock = vi.fn()
vi.mock('workflow/api', () => ({ start: (...a: unknown[]) => startMock(...a) }))
vi.mock('~~/server/workflows/gameTick', () => ({ runGame: () => undefined }))

const { startLiveGame, liveGameForPlayerCondition, LIVE_GAME_STALE_MS } =
  await import('~~/server/game/liveGame')

const PLAYERS = [
  { playerId: 'p1', team: 'chaff' as const, heroId: 'echo', mmr: 1000 },
  { playerId: 'bot_a', team: 'audit' as const, heroId: 'daemon', mmr: 1000 },
]

describe('startLiveGame', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    startMock.mockResolvedValue(undefined)
  })

  it('inserts the row then starts the workflow', async () => {
    const res = await startLiveGame(PLAYERS, { gameId: 'g_ok' })
    expect(res.gameId).toBe('g_ok')
    expect(insertValues).toHaveBeenCalledTimes(1)
    expect(startMock).toHaveBeenCalledTimes(1)
    expect(dbMock.delete).not.toHaveBeenCalled()
  })

  it('removes the orphan live_games row and rethrows when start() fails', async () => {
    startMock.mockRejectedValue(new Error('workflow unavailable'))

    await expect(startLiveGame(PLAYERS, { gameId: 'g_fail' })).rejects.toThrow(
      'workflow unavailable',
    )

    expect(insertValues).toHaveBeenCalledTimes(1)
    expect(dbMock.delete).toHaveBeenCalledTimes(1)
    expect(deleteWhere).toHaveBeenCalledTimes(1)
  })

  it('still surfaces the start() error if the cleanup itself fails', async () => {
    startMock.mockRejectedValue(new Error('workflow unavailable'))
    deleteWhere.mockRejectedValueOnce(new Error('neon down'))

    await expect(startLiveGame(PLAYERS, { gameId: 'g_fail2' })).rejects.toThrow(
      'workflow unavailable',
    )
  })
})

describe('liveGameForPlayerCondition — a stuck game must not lock its players out', () => {
  const NOW = Date.UTC(2026, 9, 10, 12, 0, 0)
  const render = () => new PgDialect().sqlToQuery(liveGameForPlayerCondition('p1', NOW))

  it('excludes rows already in phase ended (finalize may be failing forever)', () => {
    expect(render().sql).toMatch(/<> 'ended'/)
  })

  it('excludes rows whose clock is dead (updated_at older than the stale window)', () => {
    const { sql: text, params } = render()
    expect(text).toMatch(/"updated_at" >/)
    const cutoff = params.find((p) => p instanceof Date || /^\d{4}-\d\d-\d\dT/.test(String(p)))
    expect(new Date(cutoff as string | Date).getTime()).toBe(NOW - LIVE_GAME_STALE_MS)
  })

  it('still matches on roster membership for the given player', () => {
    const { sql: text, params } = render()
    expect(text).toMatch(/jsonb_array_elements/)
    expect(params).toContain('p1')
  })
})
