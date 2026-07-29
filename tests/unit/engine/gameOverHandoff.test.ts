/**
 * What the game loop hands over at the final tick: the replay snapshot and the
 * farm tally. Both are one-shot — the fiber interrupts immediately afterwards
 * and its finalizer drops the per-game maps — so both are exercised against a
 * real running loop rather than a hand-called phase function.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Effect } from 'effect'
import type { RedisServiceApi } from '../../../server/services/RedisService'
import type { TeamId } from '../../../shared/types/game'
import {
  startGameLoop,
  stopGameLoop,
  submitAction,
  type PlayerFarm,
} from '../../../server/game/engine/GameLoop'
import { createInMemoryStateManager } from '../../../server/game/engine/StateManager'
import { SNAPSHOT_EVERY_N_TICKS } from '../../../server/game/engine/StateSnapshot'

function mockRedis() {
  const store = new Map<string, string>()
  const redis = {
    get: vi.fn((key: string) => Effect.succeed(store.get(key) ?? null)),
    set: vi.fn((key: string, value: string) =>
      Effect.sync(() => {
        store.set(key, value)
      }),
    ),
    del: vi.fn(() => Effect.void),
    rpush: vi.fn(() => Effect.void),
    ltrim: vi.fn(() => Effect.void),
    expire: vi.fn(() => Effect.void),
  } as unknown as RedisServiceApi
  return { redis, store }
}

const started: string[] = []

afterEach(async () => {
  for (const id of started.splice(0)) await Effect.runPromise(stopGameLoop(id))
})

/**
 * A game one tick away from ending, seeded at a tick where the periodic
 * snapshot writer does NOT fire — which is 14 games out of 15.
 */
async function seedGameEndingOffSnapshotBeat(gameId: string) {
  const sm = createInMemoryStateManager()
  await Effect.runPromise(
    sm.createGame(gameId, [
      { id: 'p1', name: 'p1', team: 'radiant', heroId: 'echo' },
      { id: 'p2', name: 'p2', team: 'dire', heroId: 'daemon' },
    ]),
  )
  // tick 41 → the loop's tick is 42, and 42 % 15 !== 0.
  const startTick = 41
  expect((startTick + 1) % SNAPSHOT_EVERY_N_TICKS).not.toBe(0)
  await Effect.runPromise(
    sm.updateState(gameId, (s) => ({
      ...s,
      tick: startTick,
      phase: 'playing' as const,
      ancients: { ...s.ancients!, dire: { ...s.ancients!.dire, hp: 0, alive: false } },
    })),
  )
  return sm
}

function gameOverPromise() {
  let resolve!: (v: { winner: TeamId; farm: Record<string, PlayerFarm> }) => void
  const done = new Promise<{ winner: TeamId; farm: Record<string, PlayerFarm> }>((r) => {
    resolve = r
  })
  return { done, resolve }
}

describe('game loop: final handoff', () => {
  it('writes a closing snapshot when the game ends between periodic writes', async () => {
    // REGRESSION: snapshots were periodic only, so ~14 games in 15 ended with no
    // `phase: 'ended'` snapshot and the replay endpoint 403'd the [WATCH REPLAY]
    // link the post-game screen offers.
    const gameId = 'gsnap_1'
    const sm = await seedGameEndingOffSnapshotBeat(gameId)
    const { redis, store } = mockRedis()
    const { done, resolve } = gameOverPromise()

    started.push(gameId)
    startGameLoop(
      gameId,
      sm,
      {
        onTickState: () => {},
        onEvents: () => {},
        onGameOver: (_id, winner, farm) => resolve({ winner, farm }),
      },
      undefined,
      redis,
    )

    const { winner } = await done
    expect(winner).toBe('radiant')

    const snapshot = store.get(`gamesnap:${gameId}`)
    expect(snapshot).toBeDefined()
    const parsed = JSON.parse(snapshot!) as { state: { phase: string; tick: number } }
    expect(parsed.state.phase).toBe('ended')
    expect(parsed.state.tick % SNAPSHOT_EVERY_N_TICKS).not.toBe(0)
  })

  it('hands the farm tally to onGameOver rather than leaving it to be looked up', async () => {
    // The loop's finalizer clears the per-game maps the moment onGameOver
    // returns, so an async consumer reading them after its first await finds
    // nothing — the tally has to travel as an argument.
    const gameId = 'gsnap_2'
    const sm = await seedGameEndingOffSnapshotBeat(gameId)
    const { redis } = mockRedis()
    const { done, resolve } = gameOverPromise()

    // A last hit banked on the final tick: the creep is already at a sliver and
    // co-located with the hero.
    await Effect.runPromise(
      sm.updateState(gameId, (s) => ({
        ...s,
        players: { ...s.players, p1: { ...s.players.p1!, zone: 'mid-river' } },
        creeps: [{ id: 'c1', team: 'dire', zone: 'mid-river', hp: 5, type: 'melee' as const }],
      })),
    )
    submitAction(gameId, 'p1', { type: 'attack', target: { kind: 'creep', index: 0 } })

    started.push(gameId)
    startGameLoop(
      gameId,
      sm,
      {
        onTickState: () => {},
        onEvents: () => {},
        onGameOver: (_id, winner, farm) => resolve({ winner, farm }),
      },
      undefined,
      redis,
    )

    const { farm } = await done
    expect(farm.p1).toEqual({ lastHits: 1, denies: 0 })
  })
})
