import { describe, it, expect, vi } from 'vitest'
import {
  runOneTick,
  stampPresence,
  type LiveGamesRepo,
  type PendingActionsRepo,
  type TickDeps,
} from '~~/server/workflows/gameTickCore'
import { serializeStateForTransport } from '~~/server/game/engine/replayArtifact'
import type { GameState, PlayerState } from '~~/shared/types/game'
import type { LiveGame } from '~~/server/db/schema'

/**
 * The tick's half of AFK presence: on an AFK-check cycle ONLY, ask Ably (one
 * batch lookup) which idle humans are still present, and stamp the answer into
 * the state handed to processCycle. Anything short of a definite "not there"
 * leaves the state untouched (⇒ connected).
 */

function player(id: string, lastActionCycle?: number, extra: Partial<PlayerState> = {}) {
  return {
    id,
    team: 'chaff',
    alive: true,
    ...(lastActionCycle !== undefined ? { lastActionCycle } : {}),
    ...extra,
  } as PlayerState
}

function state(cycle: number, players: PlayerState[]): GameState {
  return {
    cycle,
    phase: 'playing',
    players: Object.fromEntries(players.map((p) => [p.id, p])),
    events: [],
    surrenderVotes: { chaff: new Set(), audit: new Set() },
  } as unknown as GameState
}

const present = (entries: Record<string, string[]>) =>
  vi.fn(async () => new Map(Object.entries(entries).map(([c, ids]) => [c, new Set(ids)])))

describe('stampPresence', () => {
  it('samples on the cycle BEFORE the check (processCycle increments first)', async () => {
    const lookup = present({ 'game:g:p:idle': [] })
    const s = state(59, [player('idle', 0)])
    const out = await stampPresence('g', s, lookup)
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(out.presenceOffline).toEqual({ 60: ['idle'] })
  })

  it('makes no lookup off the AFK cadence (one tick early or late)', async () => {
    const lookup = present({})
    for (const cycle of [58, 60, 61, 118]) {
      const s = state(cycle, [player('idle', 0)])
      expect(await stampPresence('g', s, lookup)).toBe(s)
    }
    expect(lookup).not.toHaveBeenCalled()
  })

  it('asks only about idle humans — never bots, takeovers or active players', async () => {
    const lookup = present({})
    const s = state(119, [
      player('idle', 10),
      player('busy', 100),
      player('bot_x'),
      player('taken', 0, { aiControlled: true }),
    ])
    await stampPresence('g', s, lookup)
    expect(lookup).toHaveBeenCalledWith(['game:g:p:idle'])
  })

  it('makes NO Ably call when every human is active', async () => {
    const lookup = present({})
    const s = state(59, [player('a', 50), player('bot_b')])
    expect(await stampPresence('g', s, lookup)).toBe(s)
    expect(lookup).not.toHaveBeenCalled()
  })

  it('records a player offline only when Ably answered for their channel without them', async () => {
    const lookup = present({
      'game:g:p:gone': [],
      'game:g:p:here': ['here'],
      // 'game:g:p:unknown' omitted: a per-channel error ⇒ unknown, not gone
    })
    const s = state(59, [player('gone', 0), player('here', 0), player('unknown', 0)])
    const out = await stampPresence('g', s, lookup)
    expect(out.presenceOffline).toEqual({ 60: ['gone'] })
  })

  it('a null lookup (no ABLY_API_KEY / failure) or a throw leaves the state untouched', async () => {
    const s = state(59, [player('idle', 0)])
    expect(
      await stampPresence(
        'g',
        s,
        vi.fn(async () => null),
      ),
    ).toBe(s)
    expect(
      await stampPresence(
        'g',
        s,
        vi.fn(async () => {
          throw new Error('timeout')
        }),
      ),
    ).toBe(s)
    expect(await stampPresence('g', s, undefined)).toBe(s)
  })
})

describe('runOneTick — presence reaches processCycle as state', () => {
  function deps(loaded: GameState, lookup: TickDeps['presence']) {
    const row: LiveGame = {
      gameId: 'g',
      state: serializeStateForTransport(loaded),
      cycle: loaded.cycle,
      // Roster is a bot only, so the publish side builds no fog-filtered views
      // (this fixture state is too thin for VisionCalculator) — presence
      // candidates come from STATE players, which is what's under test.
      roster: { players: [{ playerId: 'bot_z', team: 'audit', heroId: 'echo', mmr: 1000 }] },
      mode: 'normal',
      mapId: null,
      updatedAt: new Date(),
    }
    const liveGamesRepo: LiveGamesRepo = {
      get: vi.fn().mockResolvedValue(row),
      casUpdate: vi.fn().mockResolvedValue(row),
      claimRun: vi.fn(),
      delete: vi.fn(),
    }
    const pendingActionsRepo: PendingActionsRepo = {
      read: vi.fn().mockResolvedValue([]),
      deleteByIds: vi.fn().mockResolvedValue(undefined),
      deleteAll: vi.fn(),
    }
    const runCycle = vi.fn(async (_id: string, s: GameState) => ({
      state: { ...s, cycle: s.cycle + 1 },
    }))
    const d: TickDeps = {
      liveGamesRepo,
      pendingActionsRepo,
      runCycle,
      publish: vi.fn().mockResolvedValue(undefined),
      rehydrate: vi.fn(),
      presence: lookup,
    }
    return { d, runCycle, liveGamesRepo }
  }

  it('hands processCycle the stamped sample and persists it with the cycle', async () => {
    const lookup = present({ 'game:g:p:idle': [] })
    const { d, runCycle, liveGamesRepo } = deps(state(59, [player('idle', 0)]), lookup)
    await runOneTick('g', d)

    const input = runCycle.mock.calls[0]![1]
    expect(input.presenceOffline).toEqual({ 60: ['idle'] })
    // Persisted with the committed state ⇒ lands in the archived finalState.
    const written = (liveGamesRepo.casUpdate as ReturnType<typeof vi.fn>).mock.calls[0]![2]
    expect(written.presenceOffline).toEqual({ 60: ['idle'] })
  })

  it('a tick off the cadence never calls Ably', async () => {
    const lookup = present({})
    const { d } = deps(state(30, [player('idle', 0)]), lookup)
    await runOneTick('g', d)
    expect(lookup).not.toHaveBeenCalled()
  })
})
