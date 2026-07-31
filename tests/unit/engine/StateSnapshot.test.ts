import { describe, it, expect, vi } from 'vitest'
import { Effect } from 'effect'
import type { GameState } from '~~/shared/types/game'
import type { RedisServiceApi } from '~~/server/services/RedisService'
import {
  SNAPSHOT_SCHEMA_VERSION,
  writeSnapshot,
  readSnapshot,
  deleteSnapshot,
} from '~~/server/game/engine/StateSnapshot'
import { initializeZoneStates, initializeIce } from '~~/server/game/map/zones'

function makeGameState(): GameState {
  return {
    cycle: 42,
    phase: 'playing',
    teams: {
      chaff: { id: 'chaff', kills: 1, iceKills: 0, scrip: 0 },
      audit: { id: 'audit', kills: 2, iceKills: 1, scrip: 0 },
    },
    players: {},
    zones: initializeZoneStates(),
    waves: [],
    neutrals: [],
    ice: initializeIce(),
    caches: [],
    tenant: { alive: true, integ: 5000, maxInteg: 5000, deathCycle: null },
    backup: null,
    events: [],
    surrenderVotes: { chaff: new Set(['p1', 'p2']), audit: new Set(['p3']) },
    timeOfDay: 'day',
    dayNightCycle: 0,
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
    scan: vi.fn(() => Effect.succeed([])),
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
    expect(JSON.parse(redis._store.get('gamesnap2:g1')!).schemaVersion).toBe(
      SNAPSHOT_SCHEMA_VERSION,
    )
    const result = await Effect.runPromise(readSnapshot(redis, 'g1'))

    expect(result).not.toBeNull()
    expect(result!.state.cycle).toBe(42)
    expect(result!.state.teams.audit.kills).toBe(2)
  })

  it('preserves Set fields (surrenderVotes) across serialization', async () => {
    const redis = makeMockRedis()
    const state = makeGameState()

    await Effect.runPromise(writeSnapshot(redis, 'g1', state))
    const result = await Effect.runPromise(readSnapshot(redis, 'g1'))

    expect(result).not.toBeNull()
    expect(result!.state.surrenderVotes.chaff).toBeInstanceOf(Set)
    expect(result!.state.surrenderVotes.audit).toBeInstanceOf(Set)
    expect(result!.state.surrenderVotes.chaff.has('p1')).toBe(true)
    expect(result!.state.surrenderVotes.chaff.has('p2')).toBe(true)
    expect(result!.state.surrenderVotes.audit.has('p3')).toBe(true)
  })

  it('returns null for a missing snapshot', async () => {
    const redis = makeMockRedis()
    const result = await Effect.runPromise(readSnapshot(redis, 'nonexistent'))
    expect(result).toBeNull()
  })

  it('returns null when stored data is unparseable', async () => {
    const redis = makeMockRedis()
    redis._store.set('gamesnap2:bad', 'not-json{')
    const result = await Effect.runPromise(readSnapshot(redis, 'bad'))
    expect(result).toBeNull()
  })

  it('accepts a snapshot with the current schema version', async () => {
    const redis = makeMockRedis()
    await Effect.runPromise(writeSnapshot(redis, 'current', makeGameState()))

    const result = await Effect.runPromise(readSnapshot(redis, 'current'))

    expect(result).not.toBeNull()
  })

  it('rejects a snapshot with a missing schema version', async () => {
    const redis = makeMockRedis()
    await Effect.runPromise(writeSnapshot(redis, 'missing-version', makeGameState()))
    const payload = JSON.parse(redis._store.get('gamesnap2:missing-version')!) as Record<
      string,
      unknown
    >
    delete payload.schemaVersion
    redis._store.set('gamesnap2:missing-version', JSON.stringify(payload))

    const result = await Effect.runPromise(readSnapshot(redis, 'missing-version'))

    expect(result).toBeNull()
  })

  it('rejects a stale snapshot schema version', async () => {
    const redis = makeMockRedis()
    await Effect.runPromise(writeSnapshot(redis, 'stale-version', makeGameState()))
    const payload = JSON.parse(redis._store.get('gamesnap2:stale-version')!) as Record<
      string,
      unknown
    >
    payload.schemaVersion = SNAPSHOT_SCHEMA_VERSION - 1
    redis._store.set('gamesnap2:stale-version', JSON.stringify(payload))

    const result = await Effect.runPromise(readSnapshot(redis, 'stale-version'))

    expect(result).toBeNull()
  })

  it('persists mapId and mode on snapshot meta for honest replay setup', async () => {
    const redis = makeMockRedis()
    const state = { ...makeGameState(), mapId: 'classic', mode: 'normal' as const }
    await Effect.runPromise(
      writeSnapshot(redis, 'meta', state, {
        players: [{ playerId: 'p1', team: 'chaff', heroId: 'echo', mmr: 1000 }],
        mapId: 'seawall',
        mode: 'tutorial',
      }),
    )

    const result = await Effect.runPromise(readSnapshot(redis, 'meta'))
    expect(result?.meta).toMatchObject({ mapId: 'seawall', mode: 'tutorial' })
  })

  it('deletes the snapshot key', async () => {
    const redis = makeMockRedis()
    const state = makeGameState()

    await Effect.runPromise(writeSnapshot(redis, 'g1', state))
    expect(redis._store.has('gamesnap2:g1')).toBe(true)

    await Effect.runPromise(deleteSnapshot(redis, 'g1'))
    expect(redis._store.has('gamesnap2:g1')).toBe(false)
  })

  it('does not throw when redis.set fails — snapshot is best-effort', async () => {
    const redis = makeMockRedis()
    redis.set = vi.fn(() => Effect.fail(new Error('redis down') as never))

    await expect(
      Effect.runPromise(writeSnapshot(redis, 'g1', makeGameState())),
    ).resolves.toBeUndefined()
  })
})
