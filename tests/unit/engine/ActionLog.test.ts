import { describe, it, expect, vi } from 'vitest'
import { Effect } from 'effect'
import type { RedisServiceApi } from '~~/server/services/RedisService'
import {
  ACTION_LOG_MAX,
  appendActions,
  readActions,
  readActionLog,
  deleteActionLog,
} from '~~/server/game/engine/ActionLog'

function makeMockRedis(): RedisServiceApi & {
  _list: Map<string, string[]>
  _store: Map<string, string>
} {
  const lists = new Map<string, string[]>()
  const store = new Map<string, string>()
  return {
    _list: lists,
    _store: store,
    get: vi.fn((key: string) => Effect.succeed(store.get(key) ?? null)),
    set: vi.fn((key: string, value: string) => {
      store.set(key, value)
      return Effect.void
    }),
    del: vi.fn((key: string) => {
      lists.delete(key)
      store.delete(key)
      return Effect.void
    }),
    rpush: vi.fn((key: string, value: string) => {
      const arr = lists.get(key) ?? []
      arr.push(value)
      lists.set(key, arr)
      return Effect.void
    }),
    lpush: vi.fn(() => Effect.void),
    rpop: vi.fn(() => Effect.succeed(null)),
    llen: vi.fn((key: string) => Effect.succeed(lists.get(key)?.length ?? 0)),
    lrange: vi.fn((key: string, start: number, stop: number) => {
      const arr = lists.get(key) ?? []
      // Replicate Redis semantics for negative indices
      const len = arr.length
      const lo = start < 0 ? Math.max(0, len + start) : start
      const hi = stop < 0 ? len + stop + 1 : stop + 1
      return Effect.succeed(arr.slice(lo, hi))
    }),
    ltrim: vi.fn((key: string, start: number, stop: number) => {
      const arr = lists.get(key) ?? []
      const len = arr.length
      const lo = start < 0 ? Math.max(0, len + start) : start
      const hi = stop < 0 ? len + stop + 1 : stop + 1
      lists.set(key, arr.slice(lo, hi))
      return Effect.void
    }),
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
  } as RedisServiceApi & { _list: Map<string, string[]>; _store: Map<string, string> }
}

describe('ActionLog', () => {
  it('appends actions and reads them back in order', async () => {
    const redis = makeMockRedis()
    await Effect.runPromise(
      appendActions(redis, 'g1', [
        { cycle: 1, playerId: 'p1', command: { type: 'move', zone: 'coldstore-cross' } },
        {
          cycle: 1,
          playerId: 'p2',
          command: { type: 'attack', target: { kind: 'hero', id: 'p1' } },
        },
      ]),
    )

    const result = await Effect.runPromise(readActions(redis, 'g1'))
    expect(result).toHaveLength(2)
    expect(result[0]!.playerId).toBe('p1')
    expect(result[0]!.command.type).toBe('move')
    expect(result[1]!.playerId).toBe('p2')
  })

  it('preserves order across multiple appends', async () => {
    const redis = makeMockRedis()
    await Effect.runPromise(
      appendActions(redis, 'g1', [
        { cycle: 1, playerId: 'p1', command: { type: 'move', zone: 'a' } },
      ]),
    )
    await Effect.runPromise(
      appendActions(redis, 'g1', [
        { cycle: 2, playerId: 'p1', command: { type: 'move', zone: 'b' } },
      ]),
    )
    await Effect.runPromise(
      appendActions(redis, 'g1', [
        { cycle: 3, playerId: 'p1', command: { type: 'move', zone: 'c' } },
      ]),
    )

    const result = await Effect.runPromise(readActions(redis, 'g1'))
    expect(result.map((a) => a.cycle)).toEqual([1, 2, 3])
  })

  it('is a no-op for an empty batch', async () => {
    const redis = makeMockRedis()
    await Effect.runPromise(appendActions(redis, 'g1', []))
    expect(redis._list.has('gamelog:g1')).toBe(false)
    expect(redis.rpush).not.toHaveBeenCalled()
  })

  it('returns an empty complete log for a missing key', async () => {
    const redis = makeMockRedis()
    const result = await Effect.runPromise(readActionLog(redis, 'nonexistent'))
    expect(result.actions).toEqual([])
    expect(result.integrity).toMatchObject({
      complete: true,
      truncated: false,
      readFailed: false,
      entryCount: 0,
      firstLoggedCycle: null,
      lastLoggedCycle: null,
      initialSnapshotCycle: 0,
    })
  })

  it('reports complete integrity for a retained head-to-tail log', async () => {
    const redis = makeMockRedis()
    await Effect.runPromise(
      appendActions(redis, 'g1', [
        { cycle: 1, playerId: 'p1', command: { type: 'move', zone: 'a' } },
        { cycle: 4, playerId: 'p1', command: { type: 'move', zone: 'b' } },
      ]),
    )

    const result = await Effect.runPromise(readActionLog(redis, 'g1'))
    expect(result.integrity).toMatchObject({
      complete: true,
      truncated: false,
      readFailed: false,
      entryCount: 2,
      firstLoggedCycle: 1,
      lastLoggedCycle: 4,
      initialSnapshotCycle: 0,
    })
  })

  it('marks integrity truncated once LTRIM discards the head', async () => {
    const redis = makeMockRedis()
    const seeded = Array.from({ length: ACTION_LOG_MAX }, (_, i) =>
      JSON.stringify({
        cycle: i + 1,
        playerId: 'p1',
        command: { type: 'move', zone: 'a' },
      }),
    )
    redis._list.set('gamelog:g1', seeded)

    await Effect.runPromise(
      appendActions(redis, 'g1', [
        { cycle: ACTION_LOG_MAX + 1, playerId: 'p1', command: { type: 'move', zone: 'b' } },
      ]),
    )

    const result = await Effect.runPromise(readActionLog(redis, 'g1'))
    expect(result.actions).toHaveLength(ACTION_LOG_MAX)
    expect(result.integrity.truncated).toBe(true)
    expect(result.integrity.complete).toBe(false)
    expect(result.integrity.firstLoggedCycle).toBeGreaterThan(1)
    expect(result.integrity.lastLoggedCycle).toBe(ACTION_LOG_MAX + 1)
    expect(JSON.parse(redis._store.get('gamelogmeta:g1')!).truncated).toBe(true)
  })

  it('surfaces readFailed instead of a silent empty complete log', async () => {
    const redis = makeMockRedis()
    redis.lrange = vi.fn(() => Effect.fail(new Error('redis down') as never))

    const result = await Effect.runPromise(readActionLog(redis, 'g1'))
    expect(result.actions).toEqual([])
    expect(result.integrity).toMatchObject({
      complete: false,
      readFailed: true,
      truncated: false,
    })
  })

  it('deletes the log and integrity meta keys', async () => {
    const redis = makeMockRedis()
    await Effect.runPromise(
      appendActions(redis, 'g1', [
        { cycle: 1, playerId: 'p1', command: { type: 'move', zone: 'a' } },
      ]),
    )
    expect(redis._list.has('gamelog:g1')).toBe(true)
    expect(redis._store.has('gamelogmeta:g1')).toBe(true)

    await Effect.runPromise(deleteActionLog(redis, 'g1'))
    expect(redis._list.has('gamelog:g1')).toBe(false)
    expect(redis._store.has('gamelogmeta:g1')).toBe(false)
  })

  it('does not throw when Redis fails — best-effort', async () => {
    const redis = makeMockRedis()
    redis.rpush = vi.fn(() => Effect.fail(new Error('redis down') as never))

    await expect(
      Effect.runPromise(
        appendActions(redis, 'g1', [
          { cycle: 1, playerId: 'p1', command: { type: 'move', zone: 'a' } },
        ]),
      ),
    ).resolves.toBeUndefined()
  })

  it('skips unparseable entries on read without throwing', async () => {
    const redis = makeMockRedis()
    redis._list.set('gamelog:bad', ['not-json{', '{"valid":"but-wrong-shape"}'])
    // Should not throw — returns whatever it can parse, or empty on full failure
    await expect(Effect.runPromise(readActions(redis, 'bad'))).resolves.toBeDefined()
  })
})
