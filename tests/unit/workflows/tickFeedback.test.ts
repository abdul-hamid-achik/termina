import { describe, it, expect, vi } from 'vitest'
import {
  runOneTick,
  type CycleOutcome,
  type DrainedAction,
  type LiveGamesRepo,
  type PendingActionsRepo,
  type TickDeps,
} from '~~/server/workflows/gameTickCore'
import { serializeStateForTransport } from '~~/server/game/engine/replayArtifact'
import type { AblyBatchSpec } from '~~/server/utils/ablyRest'
import type { GameState, PlayerState } from '~~/shared/types/game'
import type { LiveGame } from '~~/server/db/schema'

/**
 * runOneTick used to keep only `state` from processCycle, so a rejected order
 * ("why didn't my order happen?") and tutorial coaching never reached a live
 * player. They now ride the SAME Ably batch as the cycle_state, as
 * `announcement` messages on the owning player's channel only.
 */

function player(
  id: string,
  team: 'chaff' | 'audit',
  extra: Partial<PlayerState> = {},
): PlayerState {
  return {
    id,
    name: id,
    team,
    heroId: 'echo',
    zone: team === 'chaff' ? 'rookery-anchor' : 'landing-anchor',
    integ: 500,
    maxInteg: 500,
    bw: 200,
    maxBw: 200,
    level: 1,
    xp: 0,
    scrip: 0,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnCycle: null,
    plate: 3,
    ice: 15,
    kills: 0,
    deaths: 0,
    assists: 0,
    damageDealt: 0,
    iceDamageDealt: 0,
    killStreak: 0,
    ...extra,
  }
}

function state(cycle: number): GameState {
  return {
    cycle,
    phase: 'playing',
    teams: {
      chaff: { id: 'chaff', kills: 0, iceKills: 0, scrip: 0, hardenUsedCycle: null },
      audit: { id: 'audit', kills: 0, iceKills: 0, scrip: 0, hardenUsedCycle: null },
    },
    players: {
      p1: player('p1', 'chaff'),
      p2: player('p2', 'chaff'),
      p3: player('p3', 'audit', { aiControlled: true }),
      bot_a1: player('bot_a1', 'audit'),
    },
    zones: {},
    waves: [],
    neutrals: [],
    ice: [],
    caches: [],
    tenant: { alive: true, integ: 500, maxInteg: 500, deathCycle: null },
    backup: null,
    events: [],
    surrenderVotes: { chaff: new Set(), audit: new Set() },
    timeOfDay: 'day',
    dayNightCycle: 0,
  } as GameState
}

function row(cycle: number): LiveGame {
  return {
    gameId: 'g1',
    state: serializeStateForTransport(state(cycle)),
    cycle,
    roster: {
      players: [
        { playerId: 'p1', team: 'chaff', heroId: 'echo', mmr: 1000 },
        { playerId: 'p2', team: 'chaff', heroId: 'echo', mmr: 1000 },
        { playerId: 'p3', team: 'audit', heroId: 'echo', mmr: 1000 },
        { playerId: 'bot_a1', team: 'audit', heroId: 'daemon', mmr: 1000 },
      ],
    },
    mode: 'normal',
    mapId: null,
    updatedAt: new Date(),
  }
}

function deps(
  outcome: Omit<CycleOutcome, 'state'>,
  opts: { casWins?: boolean; queued?: DrainedAction[] } = {},
) {
  const casWins = opts.casWins ?? true
  const liveGamesRepo: LiveGamesRepo = {
    get: vi.fn().mockResolvedValue(row(5)),
    casUpdate: vi.fn().mockResolvedValue(casWins ? row(6) : null),
    claimRun: vi.fn(),
    delete: vi.fn(),
  }
  const pendingActionsRepo: PendingActionsRepo = {
    read: vi.fn().mockResolvedValue(opts.queued ?? []),
    deleteByIds: vi.fn().mockResolvedValue(undefined),
    deleteAll: vi.fn(),
  }
  const publish = vi.fn().mockResolvedValue(undefined)
  const d: TickDeps = {
    liveGamesRepo,
    pendingActionsRepo,
    runCycle: vi.fn().mockResolvedValue({ state: state(6), ...outcome }),
    publish,
    rehydrate: vi.fn(),
  }
  return { d, publish }
}

const announcements = (publish: ReturnType<typeof vi.fn>) =>
  (publish.mock.calls[0]![0] as AblyBatchSpec[]).filter((s) => s.name === 'announcement')

describe('runOneTick — per-player feedback publish', () => {
  it("a rejection reaches ONLY its player's channel, in the same single batch", async () => {
    const { d, publish } = deps({
      rejectedActions: [{ playerId: 'p1', reason: 'Cannot move while rooted' }],
    })
    await runOneTick('g1', d)

    expect(publish).toHaveBeenCalledTimes(1) // one Ably batch per tick
    const specs = publish.mock.calls[0]![0] as AblyBatchSpec[]
    // p1, p2 and the AFK-converted p3 still watch the board; bot_a1 never does.
    expect(specs.filter((s) => (s.name ?? 'cycle_state') === 'cycle_state')).toHaveLength(3)
    expect(announcements(publish)).toEqual([
      {
        channel: 'game:g1:p:p1',
        name: 'announcement',
        data: { message: 'Cannot move while rooted', level: 'warning' },
        id: expect.stringMatching(/^game:g1:p:p1:\d+:announcement\.0$/),
      },
    ])
  })

  it('never to a bot, never to an AFK-converted slot, and once per identical line', async () => {
    const { d, publish } = deps({
      rejectedActions: [
        { playerId: 'bot_a1', reason: 'No path' },
        { playerId: 'p3', reason: 'Not enough BW' },
        { playerId: 'p2', reason: 'Not enough BW' },
        { playerId: 'p2', reason: 'Not enough BW' },
      ],
    })
    await runOneTick('g1', d)
    expect(announcements(publish).map((s) => s.channel)).toEqual(['game:g1:p:p2'])
  })

  it('a tutorial notice reaches the human as info', async () => {
    const { d, publish } = deps({
      notices: [{ playerId: 'p1', message: '🎓 Nice — that was a strip.' }],
    })
    await runOneTick('g1', d)
    expect(announcements(publish)).toEqual([
      {
        channel: 'game:g1:p:p1',
        name: 'announcement',
        data: { message: '🎓 Nice — that was a strip.', level: 'info' },
        id: expect.stringMatching(/^game:g1:p:p1:\d+:announcement\.0$/),
      },
    ])
  })

  it('an order dropped as late at drain time is told to its player', async () => {
    const { d, publish } = deps(
      {},
      { queued: [{ id: 9, playerId: 'p2', command: { type: 'move', zone: 'x' }, forCycle: 3 }] },
    )
    await runOneTick('g1', d)
    const [late] = announcements(publish)
    expect(late?.channel).toBe('game:g1:p:p2')
    expect((late!.data as { message: string }).message).toMatch(/cycle 3 committed/)
  })

  it('a CAS loser publishes nothing — not even feedback', async () => {
    const { d, publish } = deps(
      { rejectedActions: [{ playerId: 'p1', reason: 'Cannot move while rooted' }] },
      { casWins: false },
    )
    const result = await runOneTick('g1', d)
    expect(result.skipped).toBe(true)
    expect(publish).not.toHaveBeenCalled()
  })
})
