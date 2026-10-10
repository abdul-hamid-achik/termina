/**
 * A guest who signs in (or registers) mid-practice leaves the guest's practice
 * game running on its Workflow clock — every 4s, for nobody. The sign-in ends it:
 * the row goes to phase 'ended' (fencing any in-flight tick), the run then
 * finalizes it as practice (nothing recorded) and stops, and the old tab is told
 * why on its own channel.
 */
import { describe, it, expect, vi } from 'vitest'
import { Effect } from 'effect'
import { endFormerGuestPractice } from '~~/server/utils/guestPracticeEnd'
import {
  finalizeGame,
  runOneTick,
  type DbRunner,
  type LiveGamesRepo,
  type TickDeps,
} from '~~/server/workflows/gameTickCore'
import { serializeStateForTransport } from '~~/server/game/engine/replayArtifact'
import type { GameState } from '~~/shared/types/game'
import type { LiveGame, LiveGameRoster } from '~~/server/db/schema'

const GUEST = 'guest_a1b2c3d4e5f6'

function makeState(over: Partial<GameState> = {}): GameState {
  return {
    cycle: 5,
    phase: 'playing',
    mode: 'tutorial',
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
    ...over,
  } as GameState
}

const ROSTER: LiveGameRoster = {
  players: [
    { playerId: GUEST, team: 'chaff', heroId: 'echo', mmr: 1000 },
    { playerId: 'bot_e1', team: 'audit', heroId: 'malloc', mmr: 1000 },
  ],
}

function row(over: Partial<LiveGame> = {}): LiveGame {
  return {
    gameId: 'prac_1',
    state: {
      ...serializeStateForTransport(makeState()),
      runEpoch: 'run-1',
      consumedActionIds: [7],
    },
    cycle: 5,
    roster: ROSTER,
    mode: 'tutorial',
    mapId: 'one-lane',
    updatedAt: new Date(),
    ...over,
  }
}

/** live_games with the real CAS semantics (cycle + optional runEpoch fence). */
function memoryRepo(rows: LiveGame[]): LiveGamesRepo & { rows: Map<string, LiveGame> } {
  const map = new Map(rows.map((r) => [r.gameId, structuredClone(r)]))
  return {
    rows: map,
    async get(id) {
      const r = map.get(id)
      return r ? structuredClone(r) : null
    },
    async casUpdate(id, loadedCycle, nextState, nextCycle, epoch) {
      const r = map.get(id)
      if (!r || r.cycle !== loadedCycle) return null
      if (epoch !== undefined && r.state.runEpoch !== epoch) return null
      const updated = { ...r, state: nextState, cycle: nextCycle }
      map.set(id, updated)
      return structuredClone(updated)
    },
    async claimRun() {
      return true
    },
    async delete(id) {
      map.delete(id)
    },
  }
}

function deps(repo: LiveGamesRepo) {
  const publish = vi.fn().mockResolvedValue(undefined)
  return {
    publish,
    deps: {
      repo,
      findGameIds: async (id: string) =>
        [...(repo as ReturnType<typeof memoryRepo>).rows.values()]
          .filter((r) => r.roster.players.some((p) => p.playerId === id))
          .map((r) => r.gameId),
      publish,
    },
  }
}

function fakeDb() {
  const api = {
    getCurrentSeason: vi.fn(() => Effect.succeed({ seasonNumber: 1 })),
    recordMatch: vi.fn(() => Effect.succeed('inserted' as const)),
    applyMatchDerivedStats: vi.fn(() => Effect.succeed(true)),
    saveMatchReplay: vi.fn(() => Effect.succeed(true)),
    markTutorialCompleted: vi.fn(() => Effect.succeed(undefined)),
  }
  const run: DbRunner = (f) => Effect.runPromise(f(api as never))
  return { api, run }
}

const pending = () => ({
  read: vi.fn().mockResolvedValue([]),
  deleteByIds: vi.fn(),
  deleteAll: vi.fn(),
})

describe('endFormerGuestPractice', () => {
  it('ends the guest’s practice game: phase ended, cycle fenced, run bookkeeping kept', async () => {
    const repo = memoryRepo([row()])
    const { deps: d } = deps(repo)
    expect(await endFormerGuestPractice(GUEST, d)).toEqual(['prac_1'])
    const after = repo.rows.get('prac_1')!
    expect(after.state.phase).toBe('ended')
    expect(after.state.winner).toBe('audit')
    expect(after.cycle).toBe(6)
    expect(after.state.runEpoch).toBe('run-1')
    expect(after.state.consumedActionIds).toEqual([7])
  })

  it('tells the old tab on the guest’s own channel, with the 409’s code and words', async () => {
    const repo = memoryRepo([row()])
    const { deps: d, publish } = deps(repo)
    await endFormerGuestPractice(GUEST, d)
    expect(publish).toHaveBeenCalledWith([
      {
        channel: `game:prac_1:p:${GUEST}`,
        name: 'error',
        data: {
          code: 'GAME_SESSION_CHANGED',
          message: 'You signed in — this guest practice ended. Start a new one.',
        },
      },
    ])
  })

  it('the Workflow run then finalizes it as practice — nothing recorded — and stops', async () => {
    const repo = memoryRepo([row()])
    await endFormerGuestPractice(GUEST, deps(repo).deps)
    const runCycle = vi.fn()
    const tick = await runOneTick(
      'prac_1',
      {
        liveGamesRepo: repo,
        pendingActionsRepo: pending(),
        runCycle,
        publish: vi.fn(),
        rehydrate: vi.fn(),
      } as unknown as TickDeps,
      'run-1',
    )
    expect(tick.ended).toBe(true)
    expect(runCycle).not.toHaveBeenCalled()

    const { api, run } = fakeDb()
    await finalizeGame('prac_1', { liveGamesRepo: repo, pendingActionsRepo: pending(), run })
    expect(api.recordMatch).not.toHaveBeenCalled()
    expect(api.saveMatchReplay).not.toHaveBeenCalled()
    expect(api.markTutorialCompleted).not.toHaveBeenCalled()
    expect(repo.rows.has('prac_1')).toBe(false)
  })

  it('wins against a tick already in flight (its CAS loses; it reads ended)', async () => {
    const repo = memoryRepo([row()])
    const end = deps(repo).deps
    const runCycle = vi.fn(async () => {
      // The sign-in lands while this tick is computing cycle 6.
      await endFormerGuestPractice(GUEST, end)
      return { state: makeState({ cycle: 6 }) }
    })
    const tick = await runOneTick(
      'prac_1',
      {
        liveGamesRepo: repo,
        pendingActionsRepo: pending(),
        runCycle,
        publish: vi.fn(),
        rehydrate: vi.fn(),
      } as unknown as TickDeps,
      'run-1',
    )
    expect(tick.ended).toBe(true)
    expect(repo.rows.get('prac_1')!.state.phase).toBe('ended')
  })

  it('leaves a non-practice game and an already-ended one alone', async () => {
    const repo = memoryRepo([
      row({ gameId: 'normal_1', mode: 'normal' }),
      row({
        gameId: 'done_1',
        state: { ...serializeStateForTransport(makeState({ phase: 'ended', winner: 'chaff' })) },
      }),
    ])
    const { deps: d, publish } = deps(repo)
    expect(await endFormerGuestPractice(GUEST, d)).toEqual([])
    expect(repo.rows.get('normal_1')!.state.phase).toBe('playing')
    expect(repo.rows.get('done_1')!.state.winner).toBe('chaff')
    expect(publish).not.toHaveBeenCalled()
  })

  it('never throws — a sign-in must not fail over a stale practice game', async () => {
    const boom = vi.fn().mockRejectedValue(new Error('neon down'))
    await expect(
      endFormerGuestPractice(GUEST, { findGameIds: boom, repo: memoryRepo([]), publish: vi.fn() }),
    ).resolves.toEqual([])
    const repo = memoryRepo([row()])
    const publish = vi.fn().mockRejectedValue(new Error('ably down'))
    await expect(endFormerGuestPractice(GUEST, { ...deps(repo).deps, publish })).resolves.toEqual([
      'prac_1',
    ])
  })

  it('ignores a non-guest id', async () => {
    const repo = memoryRepo([row()])
    expect(await endFormerGuestPractice('local_abc', deps(repo).deps)).toEqual([])
    expect(repo.rows.get('prac_1')!.state.phase).toBe('playing')
  })
})
