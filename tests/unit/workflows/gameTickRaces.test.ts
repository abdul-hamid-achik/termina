import { describe, it, expect, vi } from 'vitest'
import type * as GameLoopModule from '~~/server/game/engine/GameLoop'

const submitSpy = vi.hoisted(() => vi.fn())
vi.mock('~~/server/game/engine/GameLoop', async (orig) => ({
  ...(await orig<typeof GameLoopModule>()),
  submitAction: submitSpy,
}))
import { Effect } from 'effect'
import {
  claimRun,
  finalizeGame,
  forceDeleteGame,
  persistMatch,
  runOneTick,
  tutorialGraduates,
  type DbRunner,
  type DrainedAction,
  type LiveGamesRepo,
  type PendingActionsRepo,
  type TickDeps,
} from '~~/server/workflows/gameTickCore'
import { serializeStateForTransport } from '~~/server/game/engine/replayArtifact'
import { TUTORIAL_STEP_COUNT } from '~~/shared/constants/tutorial'
import type { GameState } from '~~/shared/types/game'
import type { LiveGame, LiveGameRoster } from '~~/server/db/schema'

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    cycle: 5,
    phase: 'playing',
    teams: {
      chaff: { id: 'chaff', kills: 0, iceKills: 0, scrip: 0, hardenUsedCycle: null },
      audit: { id: 'audit', kills: 0, iceKills: 0, scrip: 0, hardenUsedCycle: null },
    },
    players: {},
    zones: {},
    waves: [],
    neutrals: [],
    ice: [],
    terminals: {},
    caches: [],
    tenant: { alive: true, integ: 500, maxInteg: 500, deathCycle: null },
    backup: null,
    events: [],
    surrenderVotes: { chaff: new Set(), audit: new Set() },
    timeOfDay: 'day',
    dayNightCycle: 0,
    ...overrides,
  } as GameState
}

const ROSTER: LiveGameRoster = {
  players: [
    { playerId: 'p1', team: 'chaff', heroId: 'echo', mmr: 1000 },
    { playerId: 'bot_a1', team: 'audit', heroId: 'daemon', mmr: 1000 },
  ],
}

function makeRow(
  over: Partial<LiveGame> = {},
  state: Partial<GameState> = {},
  extra: Record<string, unknown> = {},
): LiveGame {
  const gs = makeGameState(state)
  return {
    gameId: 'g1',
    state: { ...serializeStateForTransport(gs), ...extra },
    cycle: gs.cycle,
    roster: ROSTER,
    mode: 'normal',
    mapId: null,
    updatedAt: new Date(),
    ...over,
  }
}

const action = (id: number, forCycle: number | null = null): DrainedAction => ({
  id,
  playerId: 'p1',
  command: { type: 'move', zone: 'a' } as DrainedAction['command'],
  forCycle,
})

function makeDeps(over: {
  rows: LiveGame[]
  cas: LiveGame | null
  queued?: DrainedAction[]
  next?: GameState
  extra?: Partial<TickDeps>
}) {
  const get = vi.fn()
  for (const r of over.rows) get.mockResolvedValueOnce(r)
  get.mockResolvedValue(over.rows[over.rows.length - 1])
  const casUpdate = vi.fn().mockResolvedValue(over.cas)
  const read = vi.fn().mockResolvedValue(over.queued ?? [])
  const deleteByIds = vi.fn().mockResolvedValue(undefined)
  const publish = vi.fn().mockResolvedValue(undefined)
  const runCycle = vi.fn().mockResolvedValue({ state: over.next ?? makeGameState({ cycle: 6 }) })
  const deps: TickDeps = {
    liveGamesRepo: { get, casUpdate, claimRun: vi.fn(), delete: vi.fn() },
    pendingActionsRepo: { read, deleteByIds, deleteAll: vi.fn() },
    runCycle,
    publish,
    rehydrate: vi.fn(),
    ...over.extra,
  }
  return { deps, get, casUpdate, read, deleteByIds, publish, runCycle }
}

describe('runOneTick — pending orders survive a lost CAS', () => {
  it('does not delete the queued orders when the CAS loses (the winner still needs them)', async () => {
    const t = makeDeps({
      rows: [makeRow({ cycle: 5 }), makeRow({ cycle: 6 }, { cycle: 6 })],
      cas: null,
      queued: [action(1, 5), action(2, null)],
    })

    const res = await runOneTick('g1', t.deps)

    expect(res.skipped).toBe(true)
    expect(t.read).toHaveBeenCalledTimes(1)
    expect(t.deleteByIds).not.toHaveBeenCalled()
  })

  it('deletes exactly the rows it read (incl. late-dropped ones) once the CAS wins', async () => {
    const t = makeDeps({
      rows: [makeRow({ cycle: 5 })],
      cas: makeRow({ cycle: 6 }),
      queued: [action(7, 4) /* late */, action(8, 5), action(9, null)],
    })

    const res = await runOneTick('g1', t.deps)

    expect(res.skipped).toBe(false)
    expect(t.deleteByIds).toHaveBeenCalledTimes(1)
    expect(t.deleteByIds).toHaveBeenCalledWith('g1', [7, 8, 9])
  })

  it('still publishes the cycle when deleting the consumed rows fails', async () => {
    const t = makeDeps({
      rows: [makeRow({ cycle: 5 })],
      cas: makeRow({ cycle: 6 }),
      queued: [action(1)],
    })
    t.deleteByIds.mockRejectedValueOnce(new Error('neon blip'))

    const res = await runOneTick('g1', t.deps)

    expect(res.skipped).toBe(false)
    expect(t.publish).toHaveBeenCalledTimes(1)
  })
})

describe('runOneTick — run epoch fences duplicate runs', () => {
  it('exits as stale (no orders read, no engine run) when a newer run owns the game', async () => {
    const t = makeDeps({
      rows: [makeRow({ cycle: 5 }, {}, { runEpoch: 'newer' })],
      cas: makeRow({ cycle: 6 }),
    })

    const res = await runOneTick('g1', t.deps, 'older')

    expect(res).toMatchObject({ stale: true, skipped: true, ended: false, cycle: 5 })
    expect(t.read).not.toHaveBeenCalled()
    expect(t.runCycle).not.toHaveBeenCalled()
    expect(t.casUpdate).not.toHaveBeenCalled()
    expect(t.publish).not.toHaveBeenCalled()
  })

  it('carries the epoch into the CAS and writes it into the persisted state', async () => {
    const t = makeDeps({
      rows: [makeRow({ cycle: 5 }, {}, { runEpoch: 'mine' })],
      cas: makeRow({ cycle: 6 }),
    })

    const res = await runOneTick('g1', t.deps, 'mine')

    expect(res.skipped).toBe(false)
    const [, loaded, written, nextCycle, epoch] = t.casUpdate.mock.calls[0]!
    expect(loaded).toBe(5)
    expect(nextCycle).toBe(6)
    expect(epoch).toBe('mine')
    expect((written as Record<string, unknown>).runEpoch).toBe('mine')
  })

  it('reports stale (not merely skipped) when the CAS loses because ownership changed mid-tick', async () => {
    const t = makeDeps({
      rows: [
        makeRow({ cycle: 5 }, {}, { runEpoch: 'mine' }),
        makeRow({ cycle: 5 }, {}, { runEpoch: 'newer' }),
      ],
      cas: null,
    })

    const res = await runOneTick('g1', t.deps, 'mine')

    expect(res.stale).toBe(true)
    expect(res.skipped).toBe(true)
    expect(t.publish).not.toHaveBeenCalled()
    expect(t.deleteByIds).not.toHaveBeenCalled()
  })

  it('does not report stale when it merely lost a same-epoch cycle race', async () => {
    const t = makeDeps({
      rows: [
        makeRow({ cycle: 5 }, {}, { runEpoch: 'mine' }),
        makeRow({ cycle: 6 }, { cycle: 6 }, { runEpoch: 'mine' }),
      ],
      cas: null,
    })

    const res = await runOneTick('g1', t.deps, 'mine')

    expect(res.stale).toBeUndefined()
    expect(res.cycle).toBe(6)
  })
})

describe('claimRun', () => {
  it('stamps the GIVEN epoch (the run id) through the repo and returns it — a retried claim writes the same value', async () => {
    const claim = vi.fn().mockResolvedValue(true)
    const repo = { claimRun: claim } as unknown as LiveGamesRepo
    expect(await claimRun('g1', 'wrun_1', repo)).toBe('wrun_1')
    expect(await claimRun('g1', 'wrun_1', repo)).toBe('wrun_1')
    expect(claim.mock.calls).toEqual([
      ['g1', 'wrun_1'],
      ['g1', 'wrun_1'],
    ])
  })

  it('returns null when the live_games row is gone', async () => {
    const repo = { claimRun: vi.fn().mockResolvedValue(false) } as unknown as LiveGamesRepo
    expect(await claimRun('g1', 'x', repo)).toBeNull()
  })
})

describe('tutorialGraduates', () => {
  const tutorialRoster: LiveGameRoster = {
    players: [
      { playerId: 'human', team: 'chaff', heroId: 'echo', mmr: 1000 },
      { playerId: 'bot_ally', team: 'chaff', heroId: 'daemon', mmr: 1000 },
      { playerId: 'bot_e1', team: 'audit', heroId: 'malloc', mmr: 1000 },
    ],
  }
  const graduated = (over: Partial<GameState> = {}) =>
    makeGameState({
      phase: 'ended',
      winner: 'chaff',
      mode: 'tutorial',
      tutorialStep: TUTORIAL_STEP_COUNT,
      tutorialSkips: 0,
      ...over,
    })

  it('returns only the real human on the winning team after full mastery', () => {
    expect(tutorialGraduates(graduated(), 'tutorial', tutorialRoster)).toEqual(['human'])
  })

  it('never returns guests', () => {
    const roster: LiveGameRoster = {
      players: [{ playerId: 'guest_abc', team: 'chaff', heroId: 'echo', mmr: 1000 }],
    }
    expect(tutorialGraduates(graduated(), 'tutorial', roster)).toEqual([])
  })

  it('returns nobody for a normal game, an unfinished tutorial, skipped drills, or a loss', () => {
    expect(tutorialGraduates(graduated(), 'normal', tutorialRoster)).toEqual([])
    expect(
      tutorialGraduates(
        graduated({ tutorialStep: TUTORIAL_STEP_COUNT - 1 }),
        'tutorial',
        tutorialRoster,
      ),
    ).toEqual([])
    expect(tutorialGraduates(graduated({ tutorialSkips: 1 }), 'tutorial', tutorialRoster)).toEqual(
      [],
    )
    expect(tutorialGraduates(graduated({ winner: 'audit' }), 'tutorial', tutorialRoster)).toEqual(
      [],
    )
    expect(tutorialGraduates(graduated({ phase: 'playing' }), 'tutorial', tutorialRoster)).toEqual(
      [],
    )
  })
})

describe('runOneTick — tutorial completion lands before the final publish', () => {
  it('marks graduates before publishing, and still publishes if marking fails', async () => {
    const order: string[] = []
    const roster: LiveGameRoster = {
      players: [
        { playerId: 'human', team: 'chaff', heroId: 'echo', mmr: 1000 },
        { playerId: 'bot_e1', team: 'audit', heroId: 'malloc', mmr: 1000 },
      ],
    }
    const next = makeGameState({
      cycle: 6,
      phase: 'ended',
      winner: 'chaff',
      mode: 'tutorial',
      tutorialStep: TUTORIAL_STEP_COUNT,
      tutorialSkips: 0,
    })
    const mark = vi.fn(async () => {
      order.push('mark')
      throw new Error('db down')
    })
    const t = makeDeps({
      rows: [makeRow({ cycle: 5, mode: 'tutorial', roster })],
      cas: makeRow({ cycle: 6 }),
      next,
      extra: { markTutorialComplete: mark },
    })
    t.publish.mockImplementation(async () => {
      order.push('publish')
    })

    await runOneTick('g1', t.deps)

    expect(mark).toHaveBeenCalledWith(['human'])
    expect(order).toEqual(['mark', 'publish'])
  })
})

// ── finalize ──────────────────────────────────────────────────────────

function fakeDb(over: Partial<Record<string, unknown>> = {}) {
  const api = {
    getCurrentSeason: vi.fn(() => Effect.succeed({ seasonNumber: 1 })),
    recordMatch: vi.fn(() => Effect.succeed('inserted' as const)),
    applyMatchDerivedStats: vi.fn(() => Effect.succeed(true)),
    saveMatchReplay: vi.fn(() => Effect.succeed(true)),
    markTutorialCompleted: vi.fn(() => Effect.succeed(undefined)),
    ...over,
  }
  const run: DbRunner = (f) => Effect.runPromise(f(api as never))
  return { api, run }
}

describe('persistMatch', () => {
  it('THROWS when the match could not be persisted so the Workflow step retries', async () => {
    const { run } = fakeDb({ recordMatch: vi.fn(() => Effect.succeed('failed' as const)) })
    await expect(
      persistMatch('g1', makeGameState({ phase: 'ended', winner: 'chaff' }), ROSTER, run),
    ).rejects.toThrow(/persistence failed/)
  })

  it('applies derived stats on success', async () => {
    const { api, run } = fakeDb()
    await persistMatch('g1', makeGameState({ phase: 'ended', winner: 'chaff' }), ROSTER, run)
    expect(api.applyMatchDerivedStats).toHaveBeenCalledTimes(1)
  })
})

describe('finalizeGame', () => {
  function finalizeDeps(row: LiveGame, run: DbRunner) {
    const del = vi.fn().mockResolvedValue(undefined)
    const deleteAll = vi.fn().mockResolvedValue(undefined)
    return {
      del,
      deleteAll,
      deps: {
        liveGamesRepo: {
          get: vi.fn().mockResolvedValue(row),
          casUpdate: vi.fn(),
          claimRun: vi.fn(),
          delete: del,
        } as LiveGamesRepo,
        pendingActionsRepo: {
          read: vi.fn(),
          deleteByIds: vi.fn(),
          deleteAll,
        } as PendingActionsRepo,
        run,
      },
    }
  }

  const tutorialRoster: LiveGameRoster = {
    players: [
      { playerId: 'human', team: 'chaff', heroId: 'echo', mmr: 1000 },
      { playerId: 'bot_e1', team: 'audit', heroId: 'malloc', mmr: 1000 },
    ],
  }
  const tutorialEnd = (over: Partial<GameState> = {}) =>
    makeRow(
      { mode: 'tutorial', roster: tutorialRoster },
      {
        phase: 'ended',
        winner: 'chaff',
        mode: 'tutorial',
        tutorialStep: TUTORIAL_STEP_COUNT,
        tutorialSkips: 0,
        ...over,
      },
    )

  it('archives the Ably-presence samples with the replay so AFK takeovers replay faithfully', async () => {
    const { api, run } = fakeDb()
    const row = makeRow(
      { mode: 'normal', roster: ROSTER },
      {
        phase: 'ended',
        winner: 'chaff',
        presenceOffline: { 60: ['p1'] },
        terminals: {
          chaff: { team: 'chaff', integ: 100, maxInteg: 6000, alive: true, vulnerable: true },
          audit: { team: 'audit', integ: 0, maxInteg: 6000, alive: false, vulnerable: true },
        },
      },
    )
    const { deps } = finalizeDeps(row, run)
    await finalizeGame('g1', deps)
    expect(api.saveMatchReplay).toHaveBeenCalledTimes(1)
    const artifact = (
      api.saveMatchReplay.mock.calls[0] as unknown as [{ meta: { presenceOffline?: unknown } }]
    )[0]
    expect(artifact.meta.presenceOffline).toEqual({ 60: ['p1'] })
  })

  it('marks the human tutorial-complete on graduation, but banks NO match, wins or stats', async () => {
    const { api, run } = fakeDb()
    const { deps, del } = finalizeDeps(tutorialEnd(), run)

    await finalizeGame('g1', deps)

    expect(api.markTutorialCompleted).toHaveBeenCalledTimes(1)
    expect(api.markTutorialCompleted).toHaveBeenCalledWith('human')
    expect(api.recordMatch).not.toHaveBeenCalled()
    expect(api.applyMatchDerivedStats).not.toHaveBeenCalled()
    expect(api.saveMatchReplay).not.toHaveBeenCalled()
    expect(del).toHaveBeenCalledWith('g1')
  })

  it('does not mark completion when drills were skipped', async () => {
    const { api, run } = fakeDb()
    const { deps } = finalizeDeps(tutorialEnd({ tutorialSkips: 2 }), run)
    await finalizeGame('g1', deps)
    expect(api.markTutorialCompleted).not.toHaveBeenCalled()
  })

  it('still deletes the row when the tutorial completion write fails (best-effort, never blocks)', async () => {
    const { run } = fakeDb({
      markTutorialCompleted: vi.fn(() => Effect.die(new Error('neon down'))),
    })
    const { deps, del, deleteAll } = finalizeDeps(tutorialEnd(), run)
    await expect(finalizeGame('g1', deps)).resolves.toBeUndefined()
    expect(deleteAll).toHaveBeenCalledWith('g1')
    expect(del).toHaveBeenCalledWith('g1')
  })

  it('keeps the live_games row when a normal match fails to persist', async () => {
    const { run } = fakeDb({ recordMatch: vi.fn(() => Effect.succeed('failed' as const)) })
    const row = makeRow({}, { phase: 'ended', winner: 'chaff' })
    const { deps, del } = finalizeDeps(row, run)
    await expect(finalizeGame('g1', deps)).rejects.toThrow(/persistence failed/)
    expect(del).not.toHaveBeenCalled()
  })
})

describe('forceDeleteGame', () => {
  it('drops both the pending actions and the live_games row without touching the DB runner', async () => {
    const del = vi.fn().mockResolvedValue(undefined)
    const deleteAll = vi.fn().mockResolvedValue(undefined)
    await forceDeleteGame('g1', {
      liveGamesRepo: { delete: del } as unknown as LiveGamesRepo,
      pendingActionsRepo: { deleteAll } as unknown as PendingActionsRepo,
    })
    expect(deleteAll).toHaveBeenCalledWith('g1')
    expect(del).toHaveBeenCalledWith('g1')
  })
})

describe('runOneTick — a lost publish after the winning CAS (Ably blip)', () => {
  it('does not throw out of the step on a mid-game publish failure (a retry would run an off-grid cycle)', async () => {
    const t = makeDeps({ rows: [makeRow({ cycle: 5 })], cas: makeRow({ cycle: 6 }) })
    t.publish.mockRejectedValue(new Error('ably 503'))

    const res = await runOneTick('g1', t.deps)

    expect(res).toMatchObject({ skipped: false, cycle: 6, ended: false })
    expect(t.publish).toHaveBeenCalledTimes(1)
  })

  it('retries the FINAL tick publish inline so game_over still reaches clients', async () => {
    const ended = makeGameState({ cycle: 6, phase: 'ended', winner: 'chaff' })
    const t = makeDeps({
      rows: [makeRow({ cycle: 5 })],
      cas: makeRow({ cycle: 6 }),
      next: ended,
      extra: { publishRetryDelayMs: 0 },
    })
    t.publish.mockRejectedValueOnce(new Error('ably 503')).mockResolvedValue(undefined)

    const res = await runOneTick('g1', t.deps)

    expect(res).toMatchObject({ ended: true, skipped: false })
    expect(t.publish).toHaveBeenCalledTimes(2)
  })

  it('gives up after a few attempts on the final tick but still reports ended (finalize must run)', async () => {
    const ended = makeGameState({ cycle: 6, phase: 'ended', winner: 'chaff' })
    const t = makeDeps({
      rows: [makeRow({ cycle: 5 })],
      cas: makeRow({ cycle: 6 }),
      next: ended,
      extra: { publishRetryDelayMs: 0 },
    })
    t.publish.mockRejectedValue(new Error('ably down'))

    const res = await runOneTick('g1', t.deps)

    expect(res).toMatchObject({ ended: true, skipped: false })
    expect(t.publish).toHaveBeenCalledTimes(3)
  })
})

describe('runOneTick — consumed orders are durable in the state, not just in the DELETE', () => {
  it('records the consumed ids in the CAS-written state', async () => {
    const t = makeDeps({
      rows: [makeRow({ cycle: 5 })],
      cas: makeRow({ cycle: 6 }),
      queued: [action(7), action(9)],
    })
    await runOneTick('g1', t.deps)
    const written = t.casUpdate.mock.calls[0]![2] as Record<string, unknown>
    expect(written.consumedActionIds).toEqual([7, 9])
  })

  it('does not execute (or call late) an order a previous tick consumed whose DELETE failed', async () => {
    submitSpy.mockClear()
    // Row says ids 3 and 4 were consumed by the prior tick; both rows survived
    // the failed delete. 3 is un-stamped (would run twice), 4 is stamped for a
    // cycle that already committed (would be falsely reported "late"). 5 is new.
    const t = makeDeps({
      rows: [makeRow({ cycle: 6 }, { cycle: 6 }, { consumedActionIds: [3, 4] })],
      cas: makeRow({ cycle: 7 }),
      queued: [action(3, null), action(4, 5), action(5, 6)],
      next: makeGameState({ cycle: 7 }),
    })

    await runOneTick('g1', t.deps)

    // Only the NEW order (id 5) reaches the engine queue — exactly once.
    expect(submitSpy).toHaveBeenCalledTimes(1)
    // No false "dropped, retype it" announcement for the already-consumed id 4.
    const specs = t.publish.mock.calls[0]![0] as Array<{
      name?: string
      data: { message?: string }
    }>
    expect(specs.filter((x) => x.name === 'announcement')).toHaveLength(0)
    // Cleanup retries the stale ids alongside the newly consumed one…
    expect(t.deleteByIds).toHaveBeenCalledWith('g1', [3, 4, 5])
    // …and they stay recorded until a delete finally lands.
    const written = t.casUpdate.mock.calls[0]![2] as Record<string, unknown>
    expect(written.consumedActionIds).toEqual([3, 4, 5])
  })

  it('carries a previously consumed id forward only while its row still exists', async () => {
    const t = makeDeps({
      rows: [makeRow({ cycle: 6 }, { cycle: 6 }, { consumedActionIds: [3, 4] })],
      cas: makeRow({ cycle: 7 }),
      queued: [action(5, 6)], // 3 and 4 were deleted since — gone from the table
      next: makeGameState({ cycle: 7 }),
    })
    await runOneTick('g1', t.deps)
    const written = t.casUpdate.mock.calls[0]![2] as Record<string, unknown>
    expect(written.consumedActionIds).toEqual([5])
  })
})
