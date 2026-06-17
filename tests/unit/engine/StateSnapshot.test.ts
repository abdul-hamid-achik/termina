import { describe, it, expect, vi } from 'vitest'
import { Effect } from 'effect'
import type { GameState } from '../../../shared/types/game'
import type { RedisServiceApi } from '../../../server/services/RedisService'
import {
  writeSnapshot,
  readSnapshot,
  deleteSnapshot,
} from '../../../server/game/engine/StateSnapshot'
import { initializeZoneStates, initializeTowers } from '../../../server/game/map/zones'

function makeGameState(): GameState {
  return {
    tick: 42,
    phase: 'playing',
    teams: {
      radiant: { id: 'radiant', kills: 1, towerKills: 0, gold: 0 },
      dire: { id: 'dire', kills: 2, towerKills: 1, gold: 0 },
    },
    players: {},
    zones: initializeZoneStates(),
    creeps: [],
    neutrals: [],
    towers: initializeTowers(),
    runes: [],
    roshan: { alive: true, hp: 5000, maxHp: 5000, deathTick: null },
    aegis: null,
    events: [],
    surrenderVotes: { radiant: new Set(['p1', 'p2']), dire: new Set(['p3']) },
    timeOfDay: 'day',
    dayNightTick: 0,
  }
}

function makeMockRedis(): RedisServiceApi & { _store: Map<string, string> } {
  const store = new Map<string, string>()
  return {
    _store: store,
    get: vi.fn((key: string) => Effect.succeed(store.get(key) ?? null)),
    set: vi.fn((key: string, value: string) => {
      store.set(key, value)
      return Effect.void
    }),
    del: vi.fn((key: string) => {
      store.delete(key)
      return Effect.void
    }),
    // Unused stubs — only the three above are exercised by snapshot module
    lpush: vi.fn(() => Effect.void),
    rpush: vi.fn(() => Effect.void),
    rpop: vi.fn(() => Effect.succeed(null)),
    llen: vi.fn(() => Effect.succeed(0)),
    lrange: vi.fn(() => Effect.succeed([])),
    ltrim: vi.fn(() => Effect.void),
    publish: vi.fn(() => Effect.void),
    subscribe: vi.fn(() => Effect.void),
    unsubscribe: vi.fn(() => Effect.void),
    zadd: vi.fn(() => Effect.void),
    zrangebyscore: vi.fn(() => Effect.succeed([])),
    zrem: vi.fn(() => Effect.void),
    zcard: vi.fn(() => Effect.succeed(0)),
    setnx: vi.fn(() => Effect.succeed(1)),
    getdel: vi.fn(() => Effect.succeed(null)),
    keys: vi.fn(() => Effect.succeed([])),
    expire: vi.fn(() => Effect.void),
    eval: vi.fn(() => Effect.succeed(null)),
    shutdown: vi.fn(() => Effect.void),
  } as RedisServiceApi & { _store: Map<string, string> }
}

describe('StateSnapshot', () => {
  it('round-trips a GameState through write + read', async () => {
    const redis = makeMockRedis()
    const state = makeGameState()

    await Effect.runPromise(writeSnapshot(redis, 'g1', state))
    const result = await Effect.runPromise(readSnapshot(redis, 'g1'))

    expect(result).not.toBeNull()
    expect(result!.state.tick).toBe(42)
    expect(result!.state.teams.dire.kills).toBe(2)
  })

  it('preserves Set fields (surrenderVotes) across serialization', async () => {
    const redis = makeMockRedis()
    const state = makeGameState()

    await Effect.runPromise(writeSnapshot(redis, 'g1', state))
    const result = await Effect.runPromise(readSnapshot(redis, 'g1'))

    expect(result).not.toBeNull()
    expect(result!.state.surrenderVotes.radiant).toBeInstanceOf(Set)
    expect(result!.state.surrenderVotes.dire).toBeInstanceOf(Set)
    expect(result!.state.surrenderVotes.radiant.has('p1')).toBe(true)
    expect(result!.state.surrenderVotes.radiant.has('p2')).toBe(true)
    expect(result!.state.surrenderVotes.dire.has('p3')).toBe(true)
  })

  it('returns null for a missing snapshot', async () => {
    const redis = makeMockRedis()
    const result = await Effect.runPromise(readSnapshot(redis, 'nonexistent'))
    expect(result).toBeNull()
  })

  it('returns null when stored data is unparseable', async () => {
    const redis = makeMockRedis()
    redis._store.set('gamesnap:bad', 'not-json{')
    const result = await Effect.runPromise(readSnapshot(redis, 'bad'))
    expect(result).toBeNull()
  })

  it('deletes the snapshot key', async () => {
    const redis = makeMockRedis()
    const state = makeGameState()

    await Effect.runPromise(writeSnapshot(redis, 'g1', state))
    expect(redis._store.has('gamesnap:g1')).toBe(true)

    await Effect.runPromise(deleteSnapshot(redis, 'g1'))
    expect(redis._store.has('gamesnap:g1')).toBe(false)
  })

  it('does not throw when redis.set fails — snapshot is best-effort', async () => {
    const redis = makeMockRedis()
    redis.set = vi.fn(() => Effect.fail(new Error('redis down') as never))

    await expect(
      Effect.runPromise(writeSnapshot(redis, 'g1', makeGameState())),
    ).resolves.toBeUndefined()
  })
})
