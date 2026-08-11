/**
 * Unit tests for GET /api/replay/[gameId]/frames — active-game lockout,
 * integrity rejection, and mapId/mode preservation into createGame.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Effect } from 'effect'
import type { H3Event } from 'h3'

let routerParam: string | undefined
let thrownError: { statusCode: number; message: string; data?: unknown } | null = null

function makeEvent(): H3Event {
  return {
    method: 'GET',
    path: '/api/replay/g1/frames',
    node: { req: { method: 'GET', headers: {} }, res: {} },
    context: {},
  } as unknown as H3Event
}

vi.stubGlobal('defineEventHandler', (fn: (event: H3Event) => unknown) => fn)
vi.stubGlobal('createError', (opts: { statusCode: number; message: string; data?: unknown }) => {
  thrownError = opts
  const err = new Error(opts.message) as Error & { statusCode: number; data?: unknown }
  err.statusCode = opts.statusCode
  err.data = opts.data
  throw err
})
vi.stubGlobal('getRouterParam', () => routerParam)

const getMatchReplay = vi.fn(() => Effect.succeed(null))
const mockRuntime = { redisService: { tag: 'redis' }, dbService: { getMatchReplay } }

const createGame = vi.fn(() => Effect.succeed(undefined))
const updateState = vi.fn(() => Effect.succeed(undefined))
const getState = vi.fn(() =>
  Effect.succeed({
    cycle: 0,
    phase: 'playing',
    teams: {
      chaff: { kills: 0, iceKills: 0 },
      audit: { kills: 0, iceKills: 0 },
    },
    timeOfDay: 'day',
    players: {},
  }),
)

vi.mock('~~/server/plugins/game-server', () => ({
  getGameRuntime: vi.fn(() => mockRuntime),
}))
vi.mock('~~/server/game/engine/StateSnapshot', () => ({
  readSnapshot: vi.fn(() => Effect.succeed(null)),
}))
vi.mock('~~/server/game/engine/ActionLog', () => ({
  readActionLog: vi.fn(() =>
    Effect.succeed({
      actions: [],
      integrity: {
        complete: true,
        truncated: false,
        readFailed: false,
        entryCount: 0,
        firstLoggedCycle: null,
        lastLoggedCycle: null,
        initialSnapshotCycle: 0,
      },
    }),
  ),
}))
vi.mock('~~/server/game/engine/StateManager', () => ({
  createInMemoryStateManager: vi.fn(() => ({ createGame, updateState, getState })),
}))
vi.mock('~~/server/game/engine/GameLoop', () => ({
  processCycle: vi.fn(() =>
    Effect.succeed({
      state: {
        cycle: 1,
        phase: 'ended',
        teams: {
          chaff: { kills: 0, iceKills: 0 },
          audit: { kills: 0, iceKills: 0 },
        },
        timeOfDay: 'day',
        players: {},
      },
    }),
  ),
  submitReplayAction: vi.fn(),
}))

const framesHandler = (await import('../../../server/api/replay/[gameId]/frames.get')).default
const { getGameRuntime } = await import('~~/server/plugins/game-server')
const { readSnapshot } = await import('~~/server/game/engine/StateSnapshot')
const { readActionLog } = await import('~~/server/game/engine/ActionLog')
const { submitReplayAction } = await import('~~/server/game/engine/GameLoop')

function endedSnap(
  over: {
    cycle?: number
    phase?: string
    mapId?: string
    mode?: string
    meta?: Record<string, unknown>
  } = {},
) {
  return {
    savedAt: 100,
    state: {
      cycle: 2,
      phase: 'ended',
      mapId: 'classic',
      mode: 'normal',
      ...over,
    },
    meta: {
      players: [{ playerId: 'p1', team: 'chaff', heroId: 'echo', mmr: 1000 }],
      mapId: 'seawall',
      mode: 'tutorial',
      ...over.meta,
    },
  }
}

describe('GET /api/replay/[gameId]/frames', () => {
  beforeEach(() => {
    routerParam = 'g1'
    thrownError = null
    vi.clearAllMocks()
    vi.mocked(getGameRuntime).mockReturnValue(mockRuntime as never)
    vi.mocked(readSnapshot).mockReturnValue(Effect.succeed(null))
    vi.mocked(readActionLog).mockReturnValue(
      Effect.succeed({
        actions: [],
        integrity: {
          complete: true,
          truncated: false,
          readFailed: false,
          entryCount: 0,
          firstLoggedCycle: null,
          lastLoggedCycle: null,
          initialSnapshotCycle: 0,
        },
      }),
    )
    createGame.mockImplementation(() => Effect.succeed(undefined))
    updateState.mockImplementation(() => Effect.succeed(undefined))
    getState.mockImplementation(() =>
      Effect.succeed({
        cycle: 0,
        phase: 'playing',
        teams: {
          chaff: { kills: 0, iceKills: 0 },
          audit: { kills: 0, iceKills: 0 },
        },
        timeOfDay: 'day',
        players: {},
      }),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('503 when runtime is not ready', async () => {
    vi.mocked(getGameRuntime).mockReturnValue(null)
    await expect(framesHandler(makeEvent())).rejects.toThrow()
    expect(thrownError?.statusCode).toBe(503)
  })

  it('400 when no gameId param', async () => {
    routerParam = undefined
    await expect(framesHandler(makeEvent())).rejects.toThrow()
    expect(thrownError?.statusCode).toBe(400)
  })

  it('404 when no snapshot exists', async () => {
    vi.mocked(readSnapshot).mockReturnValue(Effect.succeed(null))
    await expect(framesHandler(makeEvent())).rejects.toThrow()
    expect(thrownError?.statusCode).toBe(404)
  })

  it('403 for a mid-game snapshot — replays are post-game only', async () => {
    vi.mocked(readSnapshot).mockReturnValue(
      Effect.succeed({
        savedAt: 1,
        state: { cycle: 9, phase: 'playing' },
        meta: { players: [] },
      } as never),
    )
    await expect(framesHandler(makeEvent())).rejects.toThrow()
    expect(thrownError?.statusCode).toBe(403)
    expect(thrownError?.message).toMatch(/after the game ends/i)
  })

  it('422 when setup metadata is missing', async () => {
    vi.mocked(readSnapshot).mockReturnValue(
      Effect.succeed({
        savedAt: 1,
        state: { cycle: 2, phase: 'ended' },
        meta: undefined,
      } as never),
    )
    await expect(framesHandler(makeEvent())).rejects.toThrow()
    expect(thrownError?.statusCode).toBe(422)
  })

  it('503 when the action log read failed', async () => {
    vi.mocked(readSnapshot).mockReturnValue(Effect.succeed(endedSnap() as never))
    vi.mocked(readActionLog).mockReturnValue(
      Effect.succeed({
        actions: [],
        integrity: {
          complete: false,
          truncated: false,
          readFailed: true,
          entryCount: 0,
          firstLoggedCycle: null,
          lastLoggedCycle: null,
          initialSnapshotCycle: 0,
        },
      }),
    )
    await expect(framesHandler(makeEvent())).rejects.toThrow()
    expect(thrownError?.statusCode).toBe(503)
  })

  it('409 when the action log was truncated — never serve a fake full replay', async () => {
    vi.mocked(readSnapshot).mockReturnValue(Effect.succeed(endedSnap() as never))
    vi.mocked(readActionLog).mockReturnValue(
      Effect.succeed({
        actions: [{ cycle: 500, playerId: 'p1', command: { type: 'move', zone: 'a' } }],
        integrity: {
          complete: false,
          truncated: true,
          readFailed: false,
          entryCount: 10000,
          firstLoggedCycle: 500,
          lastLoggedCycle: 900,
          initialSnapshotCycle: 0,
        },
      } as never),
    )
    await expect(framesHandler(makeEvent())).rejects.toThrow()
    expect(thrownError?.statusCode).toBe(409)
    expect(thrownError?.data).toMatchObject({
      integrity: expect.objectContaining({ truncated: true, complete: false }),
    })
  })

  it('passes mapId/mode from snapshot meta into createGame', async () => {
    vi.mocked(readSnapshot).mockReturnValue(Effect.succeed(endedSnap() as never))
    vi.mocked(readActionLog).mockReturnValue(
      Effect.succeed({
        actions: [],
        integrity: {
          complete: true,
          truncated: false,
          readFailed: false,
          entryCount: 0,
          firstLoggedCycle: null,
          lastLoggedCycle: null,
          initialSnapshotCycle: 0,
        },
      }),
    )

    const result = await framesHandler(makeEvent())
    expect(createGame).toHaveBeenCalledWith(
      // Reconstruction ids are unique per call (per-gameId module state must
      // never leak between two re-runs), so only the prefix is stable.
      expect.stringMatching(/^replay_/),
      [{ id: 'p1', name: 'p1', team: 'chaff', heroId: 'echo' }],
      { mapId: 'seawall', mode: 'tutorial' },
    )
    expect(result).toMatchObject({
      gameId: 'g1',
      integrity: { complete: true, truncated: false },
      meta: { mapId: 'seawall', mode: 'tutorial' },
    })
  })

  it('replays synthesized flags through submitReplayAction', async () => {
    vi.mocked(readSnapshot).mockReturnValue(Effect.succeed(endedSnap({ cycle: 1 }) as never))
    vi.mocked(readActionLog).mockReturnValue(
      Effect.succeed({
        actions: [
          {
            cycle: 1,
            playerId: 'p1',
            command: { type: 'move', zone: 'coldstore-cross' },
            synthesized: true,
          },
        ],
        integrity: {
          complete: true,
          truncated: false,
          readFailed: false,
          entryCount: 1,
          firstLoggedCycle: 1,
          lastLoggedCycle: 1,
          initialSnapshotCycle: 0,
        },
      } as never),
    )

    await framesHandler(makeEvent())
    expect(submitReplayAction).toHaveBeenCalledWith(
      expect.stringMatching(/^replay_/),
      'p1',
      { type: 'move', zone: 'coldstore-cross' },
      true,
    )
  })
})
