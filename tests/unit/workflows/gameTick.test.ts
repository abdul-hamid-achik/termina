import { describe, it, expect, vi } from 'vitest'
import {
  applyDrainedActions,
  hydrate,
  runOneTick,
  shouldChainAt,
  CHAIN_EVERY_TICKS,
  type DrainedAction,
  type LiveGamesRepo,
  type PendingActionsRepo,
  type TickDeps,
} from '~~/server/workflows/gameTick'
import { serializeStateForTransport } from '~~/server/game/engine/replayArtifact'
import type { GameState } from '~~/shared/types/game'
import type { LiveGame } from '~~/server/db/schema'

/** Minimal-but-typed GameState fixture — mirrors the shape used by
 *  tests/unit/engine/StateDelta.test.ts's makeState, extended with the
 *  server-only fields GameState carries that PlayerVisibleState doesn't
 *  (surrenderVotes, winner, backup). */
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
    terminals: {
      chaff: { team: 'chaff', integ: 750, maxInteg: 750, alive: true, vulnerable: false },
      audit: { team: 'audit', integ: 750, maxInteg: 750, alive: true, vulnerable: false },
    },
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

function makeRow(overrides: Partial<LiveGame> = {}): LiveGame {
  const state = makeGameState()
  return {
    gameId: 'g1',
    state: serializeStateForTransport(state),
    cycle: state.cycle,
    roster: {
      players: [
        { playerId: 'p1', team: 'chaff', heroId: 'echo', mmr: 1000 },
        { playerId: 'bot_a1', team: 'audit', heroId: 'daemon', mmr: 1000 },
      ],
    },
    mode: 'normal',
    mapId: null,
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('gameTick — hydrate/serialize roundtrip', () => {
  it('round-trips surrenderVotes Sets through jsonb-safe arrays', () => {
    const state = makeGameState({
      cycle: 42,
      surrenderVotes: { chaff: new Set(['p1', 'p2']), audit: new Set(['p3']) },
    })
    const transported = serializeStateForTransport(state)
    expect(Array.isArray((transported.surrenderVotes as { chaff: unknown }).chaff)).toBe(true)

    const rehydrated = hydrate(transported)
    expect(rehydrated.surrenderVotes.chaff).toBeInstanceOf(Set)
    expect(rehydrated.surrenderVotes.audit).toBeInstanceOf(Set)
    expect([...rehydrated.surrenderVotes.chaff]).toEqual(['p1', 'p2'])
    expect([...rehydrated.surrenderVotes.audit]).toEqual(['p3'])
    expect(rehydrated.cycle).toBe(42)
  })

  it('defaults to empty Sets when the raw row has no surrenderVotes', () => {
    const rehydrated = hydrate({ cycle: 1, phase: 'playing' })
    expect(rehydrated.surrenderVotes.chaff.size).toBe(0)
    expect(rehydrated.surrenderVotes.audit.size).toBe(0)
  })
})

describe('gameTick — applyDrainedActions (for_cycle late-drop)', () => {
  it('drops only actions whose forCycle is strictly before loadedCycle, submits the rest', () => {
    const submit = vi.fn()
    const actions: DrainedAction[] = [
      { id: 1, playerId: 'p1', command: { type: 'move', zone: 'a' }, forCycle: 4 }, // late
      { id: 2, playerId: 'p2', command: { type: 'move', zone: 'b' }, forCycle: 5 }, // on-time
      { id: 3, playerId: 'p3', command: { type: 'move', zone: 'c' }, forCycle: null }, // unstamped
    ]

    const { submitted, droppedLate } = applyDrainedActions('g1', 5, actions, submit)

    expect(droppedLate.map((a) => a.id)).toEqual([1])
    expect(submitted).toBe(2)
    expect(submit).toHaveBeenCalledTimes(2)
    expect(submit).toHaveBeenCalledWith('g1', 'p2', actions[1]!.command)
    expect(submit).toHaveBeenCalledWith('g1', 'p3', actions[2]!.command)
    expect(submit).not.toHaveBeenCalledWith('g1', 'p1', expect.anything())
  })

  it('submits everything when nothing is late', () => {
    const submit = vi.fn()
    const actions: DrainedAction[] = [
      { id: 1, playerId: 'p1', command: { type: 'move', zone: 'a' }, forCycle: 5 },
    ]
    const { submitted, droppedLate } = applyDrainedActions('g1', 5, actions, submit)
    expect(submitted).toBe(1)
    expect(droppedLate).toEqual([])
  })
})

describe('gameTick — shouldChainAt (child-chain trigger boundary)', () => {
  it('triggers only exactly at multiples of the chain interval, never at 0', () => {
    expect(shouldChainAt(0)).toBe(false)
    expect(shouldChainAt(CHAIN_EVERY_TICKS - 1)).toBe(false)
    expect(shouldChainAt(CHAIN_EVERY_TICKS)).toBe(true)
    expect(shouldChainAt(CHAIN_EVERY_TICKS + 1)).toBe(false)
    expect(shouldChainAt(CHAIN_EVERY_TICKS * 2)).toBe(true)
  })

  it('respects a custom interval', () => {
    expect(shouldChainAt(10, 10)).toBe(true)
    expect(shouldChainAt(9, 10)).toBe(false)
    expect(shouldChainAt(20, 10)).toBe(true)
  })
})

describe('gameTick — runOneTick CAS idempotency guard', () => {
  /**
   * THE scenario the task calls out explicitly: a duplicate execution loads
   * the same row (cycle 5), runs the engine, and loses the UPDATE ... WHERE
   * cycle = 5 race because another execution already committed cycle 6.
   * This must be a no-op: no publish (no double-broadcast), and the
   * reported cycle must be the WINNER's (6), never advanced a second time
   * (no double-tick, which would report 7).
   */
  it('skips publishing and reports the current cycle when the CAS update affects 0 rows', async () => {
    const loadedRow = makeRow({
      cycle: 5,
      state: serializeStateForTransport(makeGameState({ cycle: 5 })),
    })
    const winnerRow = makeRow({
      cycle: 6,
      state: serializeStateForTransport(makeGameState({ cycle: 6 })),
    })

    const get = vi.fn().mockResolvedValueOnce(loadedRow).mockResolvedValueOnce(winnerRow)
    const casUpdate = vi.fn().mockResolvedValue(null) // 0 rows affected — stale WHERE cycle = 5
    const deleteFn = vi.fn()
    const liveGamesRepo: LiveGamesRepo = { get, casUpdate, delete: deleteFn }

    const drain = vi.fn().mockResolvedValue([])
    const pendingActionsRepo: PendingActionsRepo = { drain, deleteAll: vi.fn() }

    const runCycle = vi.fn().mockResolvedValue({ state: makeGameState({ cycle: 6 }) })
    const publish = vi.fn().mockResolvedValue(undefined)
    const rehydrate = vi.fn()

    const deps: TickDeps = { liveGamesRepo, pendingActionsRepo, runCycle, publish, rehydrate }

    const result = await runOneTick('g1', deps)

    expect(casUpdate).toHaveBeenCalledTimes(1)
    expect(casUpdate).toHaveBeenCalledWith('g1', 5, expect.anything(), 6)
    // THE guard: no publish happened for this losing execution.
    expect(publish).not.toHaveBeenCalled()
    expect(result.skipped).toBe(true)
    expect(result.ended).toBe(false)
    // Reports the row the WINNER left behind, not a second local advance.
    expect(result.cycle).toBe(6)
  })

  it('publishes to non-bot players and reports the advanced cycle when the CAS succeeds', async () => {
    const loadedRow = makeRow({ cycle: 5 })
    const nextState = makeGameState({ cycle: 6 })

    const get = vi.fn().mockResolvedValue(loadedRow)
    const casUpdate = vi.fn().mockResolvedValue(makeRow({ cycle: 6 }))
    const liveGamesRepo: LiveGamesRepo = { get, casUpdate, delete: vi.fn() }
    const pendingActionsRepo: PendingActionsRepo = {
      drain: vi.fn().mockResolvedValue([]),
      deleteAll: vi.fn(),
    }
    const runCycle = vi.fn().mockResolvedValue({ state: nextState })
    const publish = vi.fn().mockResolvedValue(undefined)
    const rehydrate = vi.fn()

    const deps: TickDeps = { liveGamesRepo, pendingActionsRepo, runCycle, publish, rehydrate }

    const result = await runOneTick('g1', deps)

    expect(result.skipped).toBe(false)
    expect(result.cycle).toBe(6)
    expect(rehydrate).toHaveBeenCalledWith('g1', loadedRow.roster)
    expect(publish).toHaveBeenCalledTimes(1)
    const specs = publish.mock.calls[0]![0] as Array<{ channel: string }>
    // bot_a1 is filtered out — bots never get an Ably channel.
    expect(specs).toHaveLength(1)
    expect(specs[0]!.channel).toBe('game:g1:p:p1')
  })

  it('is a no-op (no engine run, no publish) once the row is already ended', async () => {
    const endedRow = makeRow({
      cycle: 9,
      state: serializeStateForTransport(makeGameState({ cycle: 9, phase: 'ended' })),
    })
    const get = vi.fn().mockResolvedValue(endedRow)
    const casUpdate = vi.fn()
    const runCycle = vi.fn()
    const publish = vi.fn()
    const deps: TickDeps = {
      liveGamesRepo: { get, casUpdate, delete: vi.fn() },
      pendingActionsRepo: { drain: vi.fn(), deleteAll: vi.fn() },
      runCycle,
      publish,
      rehydrate: vi.fn(),
    }

    const result = await runOneTick('g1', deps)

    expect(result).toEqual({ ended: true, cycle: 9, skipped: true })
    expect(runCycle).not.toHaveBeenCalled()
    expect(casUpdate).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it('reports missing when the row is already gone (duplicate run after finalize+delete)', async () => {
    const get = vi.fn().mockResolvedValue(null)
    const deps: TickDeps = {
      liveGamesRepo: { get, casUpdate: vi.fn(), delete: vi.fn() },
      pendingActionsRepo: { drain: vi.fn(), deleteAll: vi.fn() },
      runCycle: vi.fn(),
      publish: vi.fn(),
      rehydrate: vi.fn(),
    }

    const result = await runOneTick('g1', deps)
    expect(result.missing).toBe(true)
    expect(result.skipped).toBe(true)
  })
})
