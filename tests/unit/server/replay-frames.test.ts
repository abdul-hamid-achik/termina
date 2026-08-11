/**
 * Unit tests for GET /api/replay/[gameId]/frames — archive-only lookup and
 * mapId/mode preservation into createGame.
 *
 * Archive-only (all-Vercel cutover): the DO-era Redis fast path is gone with
 * the WS game server — the only source left is the Postgres archive
 * (match_replays), read via runtime.dbService.getMatchReplay.
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
const mockRuntime = { dbService: { getMatchReplay } }

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
const { submitReplayAction } = await import('~~/server/game/engine/GameLoop')

function archivedReplay(
  over: {
    rngSeed?: number | null
    finalSummaryHash?: string | null
    rulesetVersion?: number
    finalState?: Record<string, unknown>
    meta?: Record<string, unknown>
    actions?: unknown[]
  } = {},
) {
  return {
    matchId: 'g1',
    rngSeed: over.rngSeed ?? null,
    finalSummaryHash: over.finalSummaryHash ?? null,
    rulesetVersion: over.rulesetVersion ?? 1,
    finalState: { cycle: 2, phase: 'ended', ...over.finalState },
    meta: {
      players: [{ playerId: 'p1', team: 'chaff', heroId: 'echo', mmr: 1000 }],
      mapId: 'seawall',
      mode: 'tutorial',
      ...over.meta,
    },
    actions: over.actions ?? [],
  }
}

describe('GET /api/replay/[gameId]/frames', () => {
  beforeEach(() => {
    routerParam = 'g1'
    thrownError = null
    vi.clearAllMocks()
    vi.mocked(getGameRuntime).mockReturnValue(mockRuntime as never)
    getMatchReplay.mockReturnValue(Effect.succeed(null))
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

  it('404 when no archived replay exists', async () => {
    getMatchReplay.mockReturnValue(Effect.succeed(null))
    await expect(framesHandler(makeEvent())).rejects.toThrow()
    expect(thrownError?.statusCode).toBe(404)
  })

  it('passes mapId/mode from archived meta into createGame', async () => {
    getMatchReplay.mockReturnValue(Effect.succeed(archivedReplay() as never))

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
      source: 'archive',
      integrity: { complete: true, truncated: false },
      meta: { mapId: 'seawall', mode: 'tutorial' },
    })
  })

  it('replays synthesized flags through submitReplayAction', async () => {
    getMatchReplay.mockReturnValue(
      Effect.succeed(
        archivedReplay({
          finalState: { cycle: 1, phase: 'ended' },
          actions: [
            {
              cycle: 1,
              playerId: 'p1',
              command: { type: 'move', zone: 'coldstore-cross' },
              synthesized: true,
            },
          ],
        }) as never,
      ),
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
