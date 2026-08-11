import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks for the DB + Workflow boundary ─────────────────────────────
// startLiveGame's own logic (build the roster row, flip phase to 'playing',
// insert, kick off the workflow) is what's under test here — the actual
// Postgres insert and the workflow runtime are out of scope (covered by
// tests/unit/workflows/gameTick.test.ts and the integration suite).

const insertValues = vi.fn(async () => undefined)
let selectImpl: () => unknown = () => ({
  from: () => ({ where: () => ({ limit: async () => [] }) }),
})
const dbMock = {
  insert: vi.fn(() => ({ values: insertValues })),
  select: vi.fn((...args: unknown[]) => (selectImpl as (...a: unknown[]) => unknown)(...args)),
}
vi.mock('~~/server/db', () => ({ useDb: () => dbMock }))

const startMock = vi.fn(async () => ({ id: 'run1' }))
vi.mock('workflow/api', () => ({ start: startMock }))

vi.mock('~~/server/workflows/gameTick', () => ({ runGame: vi.fn() }))

const { startLiveGame, findLiveGameForPlayer } = await import('~~/server/game/liveGame')

describe('startLiveGame', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates the live_games row with a playing-phase state and starts the workflow', async () => {
    const players = [
      { playerId: 'p1', team: 'chaff' as const, heroId: 'echo', mmr: 1000 },
      { playerId: 'bot_a1', team: 'audit' as const, heroId: 'daemon', mmr: 1000 },
    ]
    const result = await startLiveGame(players, { mode: 'normal' })

    expect(result.gameId).toBeTruthy()
    expect(dbMock.insert).toHaveBeenCalledTimes(1)
    expect(insertValues).toHaveBeenCalledTimes(1)
    const row = insertValues.mock.calls[0]![0] as {
      gameId: string
      roster: { players: unknown }
      mode: string
      state: { phase: string }
    }
    expect(row.gameId).toBe(result.gameId)
    expect(row.roster.players).toEqual(players)
    expect(row.mode).toBe('normal')
    expect(row.state.phase).toBe('playing')
    expect(startMock).toHaveBeenCalledWith(expect.anything(), [result.gameId])
  })

  it('uses an explicit gameId over a generated one, and gameIdPrefix when generating', async () => {
    const players = [{ playerId: 'p1', team: 'chaff' as const, heroId: 'echo', mmr: 1000 }]

    const explicit = await startLiveGame(players, { gameId: 'fixed_1' })
    expect(explicit.gameId).toBe('fixed_1')

    const generated = await startLiveGame(players, { gameIdPrefix: 'q' })
    expect(generated.gameId).toMatch(/^q_/)

    const defaulted = await startLiveGame(players)
    expect(defaulted.gameId).toMatch(/^wf_/)
  })

  it('carries botOptions into the roster only when given', async () => {
    const players = [{ playerId: 'p1', team: 'chaff' as const, heroId: 'echo', mmr: 1000 }]

    await startLiveGame(players, { botOptions: { difficulty: 'easy' } })
    const withBots = insertValues.mock.calls[0]![0] as { roster: { botOptions?: unknown } }
    expect(withBots.roster.botOptions).toEqual({ difficulty: 'easy' })

    insertValues.mockClear()
    await startLiveGame(players)
    const withoutBots = insertValues.mock.calls[0]![0] as { roster: { botOptions?: unknown } }
    expect(withoutBots.roster.botOptions).toBeUndefined()
  })
})

describe('findLiveGameForPlayer', () => {
  it('returns the gameId when the containment query matches a row', async () => {
    selectImpl = () => ({
      from: () => ({ where: () => ({ limit: async () => [{ gameId: 'g1' }] }) }),
    })
    expect(await findLiveGameForPlayer('p1')).toBe('g1')
  })

  it('returns null when nothing matches', async () => {
    selectImpl = () => ({
      from: () => ({ where: () => ({ limit: async () => [] }) }),
    })
    expect(await findLiveGameForPlayer('nobody')).toBeNull()
  })
})
