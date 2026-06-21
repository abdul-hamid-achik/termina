import { describe, it, expect, vi } from 'vitest'
import { Effect } from 'effect'
import type { GameState } from '../../../shared/types/game'
import type { RedisServiceApi } from '../../../server/services/RedisService'
import type { SnapshotMeta } from '../../../server/game/engine/StateSnapshot'
import {
  flushFinalSnapshots,
  type ShutdownGameEntry,
} from '../../../server/game/engine/gracefulShutdown'

const META: SnapshotMeta = {
  players: [{ playerId: 'p1', team: 'radiant', heroId: 'malloc', mmr: 1000 }],
}

const mockState = (): GameState =>
  ({
    tick: 7,
    surrenderVotes: { radiant: new Set<string>(), dire: new Set<string>() },
  }) as unknown as GameState

function mockRedis() {
  const setKeys: string[] = []
  const redis = {
    set: vi.fn((key: string) =>
      Effect.sync(() => {
        setKeys.push(key)
      }),
    ),
  } as unknown as RedisServiceApi
  return { redis, setKeys }
}

const entry = (
  meta: SnapshotMeta | undefined,
  getState: ShutdownGameEntry['stateManager']['getState'] = () => Effect.succeed(mockState()),
): ShutdownGameEntry => ({ stateManager: { getState }, meta })

describe('flushFinalSnapshots', () => {
  it('writes a snapshot for each game that has captured meta', async () => {
    const { redis, setKeys } = mockRedis()
    const games = new Map<string, ShutdownGameEntry>([
      ['g1', entry(META)],
      ['g2', entry(META)],
    ])
    await Effect.runPromise(flushFinalSnapshots(games, redis))
    expect(setKeys.sort()).toEqual(['gamesnap:g1', 'gamesnap:g2'])
  })

  it('skips games without meta (a meta-less snapshot would break resume)', async () => {
    const { redis, setKeys } = mockRedis()
    const games = new Map<string, ShutdownGameEntry>([
      ['withMeta', entry(META)],
      ['noMeta', entry(undefined)],
    ])
    await Effect.runPromise(flushFinalSnapshots(games, redis))
    expect(setKeys).toEqual(['gamesnap:withMeta'])
  })

  it('swallows a getState failure and still flushes the other games', async () => {
    const { redis, setKeys } = mockRedis()
    const games = new Map<string, ShutdownGameEntry>([
      ['bad', entry(META, () => Effect.fail(new Error('game gone')))],
      ['good', entry(META)],
    ])
    await expect(Effect.runPromise(flushFinalSnapshots(games, redis))).resolves.toBeUndefined()
    expect(setKeys).toEqual(['gamesnap:good'])
  })

  it('resolves to void on an empty game set', async () => {
    const { redis } = mockRedis()
    await expect(Effect.runPromise(flushFinalSnapshots(new Map(), redis))).resolves.toBeUndefined()
  })
})
