import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Effect } from 'effect'
import {
  joinQueue,
  leaveQueue,
  getQueueSize,
  startMatchmakingLoop,
} from '../../../server/game/matchmaking/queue'
import type { QueueEntry } from '../../../server/game/matchmaking/queue'

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock('../../../server/game/matchmaking/lobby', () => ({
  createLobby: vi.fn(),
}))

vi.mock('../../../server/game/ai/BotManager', () => ({
  isBot: (id: string) => id.startsWith('bot_'),
  createBotPlayers: (count: number, _existingIds: string[]) =>
    Array.from({ length: count }, (_, i) => ({
      playerId: `bot_${i}`,
      mmr: 1000,
      joinedAt: Date.now(),
      mode: 'ranked_5v5' as const,
    })),
}))

vi.mock('../../../server/services/PeerRegistry', () => ({
  sendToPeer: vi.fn(),
}))

function mockRedis() {
  const store: { zadd: [string, number, string][] } = { zadd: [] }

  return {
    get: vi.fn(() => Effect.succeed(null)),
    set: vi.fn(() => Effect.void),
    del: vi.fn(() => Effect.void),
    publish: vi.fn(() => Effect.void),
    subscribe: vi.fn(() => Effect.void),
    zadd: vi.fn((key: string, score: number, member: string) => {
      store.zadd.push([key, score, member])
      return Effect.void
    }),
    zrem: vi.fn(() => Effect.void),
    zcard: vi.fn(() => Effect.succeed(store.zadd.length)),
    zrangebyscore: vi.fn(() =>
      Effect.succeed(store.zadd.map(([, , member]) => member)),
    ),
    _store: store,
  }
}

function mockWs() {
  return {
    addConnection: vi.fn(() => Effect.void),
    removeConnection: vi.fn(() => Effect.void),
    sendToPlayer: vi.fn(() => Effect.void),
    broadcastToGame: vi.fn(() => Effect.void),
  }
}

function mockDb() {
  return {
    saveGame: vi.fn(() => Effect.void),
    loadGame: vi.fn(() => Effect.succeed(null)),
    savePlayerStats: vi.fn(() => Effect.void),
  }
}

function makeEntry(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    playerId: 'player_1',
    mmr: 1000,
    joinedAt: Date.now(),
    mode: 'ranked_5v5',
    ...overrides,
  }
}

// ── Tests ──────────────────────────────────────────────────────────

describe('Queue', () => {
  let redis: ReturnType<typeof mockRedis>
  let ws: ReturnType<typeof mockWs>
  let db: ReturnType<typeof mockDb>

  beforeEach(() => {
    vi.useFakeTimers()
    redis = mockRedis()
    ws = mockWs()
    db = mockDb()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('joinQueue', () => {
    it('adds player to Redis sorted set with MMR as score', async () => {
      const entry = makeEntry({ playerId: 'p1', mmr: 1200 })
      await Effect.runPromise(joinQueue(redis as never, entry))

      expect(redis.zadd).toHaveBeenCalledWith(
        'matchmaking:queue',
        1200,
        JSON.stringify(entry),
      )
    })

    it('stores queue join time in Redis', async () => {
      const entry = makeEntry({ playerId: 'p2', joinedAt: 12345 })
      await Effect.runPromise(joinQueue(redis as never, entry))

      expect(redis.set).toHaveBeenCalledWith(
        'matchmaking:queue_times:p2',
        '12345',
      )
    })

    it('accepts different game modes', async () => {
      for (const mode of ['ranked_5v5', 'quick_3v3', '1v1'] as const) {
        const entry = makeEntry({ playerId: `p_${mode}`, mode })
        await Effect.runPromise(joinQueue(redis as never, entry))
      }
      expect(redis.zadd).toHaveBeenCalledTimes(3)
    })
  })

  describe('leaveQueue', () => {
    it('removes player entry from Redis sorted set', async () => {
      const entry = makeEntry({ playerId: 'leaving_player', mmr: 1000 })
      redis.zrangebyscore.mockReturnValue(
        Effect.succeed([JSON.stringify(entry)]),
      )

      await Effect.runPromise(leaveQueue(redis as never, 'leaving_player', 1000))

      expect(redis.zrem).toHaveBeenCalledWith(
        'matchmaking:queue',
        JSON.stringify(entry),
      )
    })

    it('cleans up queue time key', async () => {
      redis.zrangebyscore.mockReturnValue(Effect.succeed([]))

      await Effect.runPromise(leaveQueue(redis as never, 'p_leave', 1000))

      expect(redis.del).toHaveBeenCalledWith('matchmaking:queue_times:p_leave')
    })

    it('handles player not found in queue gracefully', async () => {
      redis.zrangebyscore.mockReturnValue(Effect.succeed([]))

      await expect(
        Effect.runPromise(leaveQueue(redis as never, 'nonexistent', 1000)),
      ).resolves.toBeUndefined()
    })

    it('only removes the matching player entry', async () => {
      const entry1 = makeEntry({ playerId: 'p1', mmr: 1000 })
      const entry2 = makeEntry({ playerId: 'p2', mmr: 1010 })
      redis.zrangebyscore.mockReturnValue(
        Effect.succeed([JSON.stringify(entry1), JSON.stringify(entry2)]),
      )

      await Effect.runPromise(leaveQueue(redis as never, 'p1', 1000))

      expect(redis.zrem).toHaveBeenCalledTimes(1)
      expect(redis.zrem).toHaveBeenCalledWith(
        'matchmaking:queue',
        JSON.stringify(entry1),
      )
    })
  })

  describe('getQueueSize', () => {
    it('returns the cardinality of the queue set', async () => {
      redis.zcard.mockReturnValue(Effect.succeed(7))

      const size = await Effect.runPromise(getQueueSize(redis as never))
      expect(size).toBe(7)
    })

    it('returns 0 when queue is empty', async () => {
      redis.zcard.mockReturnValue(Effect.succeed(0))

      const size = await Effect.runPromise(getQueueSize(redis as never))
      expect(size).toBe(0)
    })
  })

  describe('startMatchmakingLoop', () => {
    it('returns an interval handle that can be cleared', () => {
      const handle = startMatchmakingLoop(
        redis as never,
        ws as never,
        db as never,
      )
      expect(handle).toBeDefined()
      clearInterval(handle)
    })

    it('polls at 5-second intervals', () => {
      const handle = startMatchmakingLoop(
        redis as never,
        ws as never,
        db as never,
      )

      // No calls yet at t=0
      expect(redis.zcard).not.toHaveBeenCalled()

      // Advance 5 seconds — first poll
      vi.advanceTimersByTime(5000)
      // zcard is called inside tryFormMatch via zrangebyscore
      expect(redis.zcard).toHaveBeenCalled()

      clearInterval(handle)
    })
  })

  describe('QueueEntry interface', () => {
    it('supports all required fields', () => {
      const entry: QueueEntry = {
        playerId: 'test_player',
        mmr: 1500,
        joinedAt: Date.now(),
        mode: 'ranked_5v5',
      }
      expect(entry.playerId).toBe('test_player')
      expect(entry.mmr).toBe(1500)
      expect(entry.mode).toBe('ranked_5v5')
    })

    it('serializes to JSON and back correctly', () => {
      const entry: QueueEntry = {
        playerId: 'json_test',
        mmr: 2000,
        joinedAt: 1000000,
        mode: '1v1',
      }
      const parsed: QueueEntry = JSON.parse(JSON.stringify(entry))
      expect(parsed).toEqual(entry)
    })
  })
})
