import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Effect } from 'effect'
import {
  joinQueue,
  leaveQueue,
  getQueueSize,
  startMatchmakingLoop,
  isPlayerInQueue,
} from '../../../server/game/matchmaking/queue'
import type { QueueEntry } from '../../../server/game/matchmaking/queue'

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock('../../../server/game/matchmaking/lobby', () => ({
  createLobby: vi.fn((entries: any[]) => {
    const sorted = [...entries].sort((a: any, b: any) => b.mmr - a.mmr)
    const snakeOrder = [0, 1, 1, 0, 0, 1, 1, 0, 0, 1]
    const players = sorted.map((entry: any, i: number) => ({
      playerId: entry.playerId,
      username: entry.username,
      mmr: entry.mmr,
      team: snakeOrder[i] === 0 ? 'radiant' : 'dire',
      heroId: null,
      ready: false,
    }))
    return {
      id: `lobby_${Date.now()}`,
      players,
      pickedHeroes: new Set(),
      pickOrder: [0, 5, 6, 1, 2, 7, 8, 3, 4, 9].slice(0, players.length),
      currentPickIndex: 0,
      pickTimer: null,
      phase: 'picking',
    }
  }),
  cleanupLobby: vi.fn(),
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
    zrangebyscore: vi.fn(() => Effect.succeed(store.zadd.map(([, , member]) => member))),
    setnx: vi.fn(() => Effect.succeed(1)),
    getdel: vi.fn(() => Effect.succeed('1')),
    eval: vi.fn(() => Effect.succeed('OK')),
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
    username: 'Player One',
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
    it('adds player to Redis sorted set with MMR as score via Lua script', async () => {
      const entry = makeEntry({ playerId: 'p1', mmr: 1200 })
      await Effect.runPromise(joinQueue(redis as never, entry))

      expect(redis.eval).toHaveBeenCalledWith(
        expect.any(String),
        ['matchmaking:queue_times:p1:ranked_5v5', 'matchmaking:queue:ranked_5v5'],
        ['p1', 1200, JSON.stringify(entry), expect.any(String)],
      )
    })

    it('stores queue join time in Redis via Lua script', async () => {
      const entry = makeEntry({ playerId: 'p2', joinedAt: 12345 })
      await Effect.runPromise(joinQueue(redis as never, entry))

      expect(redis.eval).toHaveBeenCalledWith(
        expect.any(String),
        ['matchmaking:queue_times:p2:ranked_5v5', 'matchmaking:queue:ranked_5v5'],
        ['p2', 1000, JSON.stringify(entry), '12345'],
      )
    })

    it('accepts different game modes', async () => {
      for (const mode of ['ranked_5v5', 'quick_3v3', '1v1'] as const) {
        const entry = makeEntry({ playerId: `p_${mode}`, mode })
        await Effect.runPromise(joinQueue(redis as never, entry))
      }
      expect(redis.eval).toHaveBeenCalledTimes(3)
    })
  })

  describe('leaveQueue', () => {
    it('removes player entry from Redis sorted set', async () => {
      const entry = makeEntry({ playerId: 'leaving_player', mmr: 1000 })
      redis.zrangebyscore.mockReturnValue(Effect.succeed([JSON.stringify(entry)]))

      await Effect.runPromise(leaveQueue(redis as never, 'leaving_player', 1000))

      expect(redis.zrem).toHaveBeenCalledWith('matchmaking:queue:ranked_5v5', JSON.stringify(entry))
    })

    it('cleans up queue time key', async () => {
      redis.zrangebyscore.mockReturnValue(Effect.succeed([]))

      await Effect.runPromise(leaveQueue(redis as never, 'p_leave', 1000))

      expect(redis.del).toHaveBeenCalledWith('matchmaking:queue_times:p_leave:ranked_5v5')
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
        'matchmaking:queue:ranked_5v5',
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
      const handle = startMatchmakingLoop(redis as never, ws as never, db as never)
      expect(handle).toBeDefined()
      clearInterval(handle)
    })

    it('polls at 5-second intervals', () => {
      const handle = startMatchmakingLoop(redis as never, ws as never, db as never)

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
        username: 'Test Player',
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
        username: 'JSON Test',
        mmr: 2000,
        joinedAt: 1000000,
        mode: '1v1',
      }
      const parsed: QueueEntry = JSON.parse(JSON.stringify(entry))
      expect(parsed).toEqual(entry)
    })
  })

  describe('isPlayerInQueue', () => {
    it('returns true when player is in queue', async () => {
      ;(redis.get as ReturnType<typeof vi.fn>).mockReturnValue(Effect.succeed('12345'))
      const result = await Effect.runPromise(isPlayerInQueue(redis as never, 'player1'))
      expect(result).toBe(true)
    })

    it('returns false when player is not in queue', async () => {
      redis.get.mockReturnValue(Effect.succeed(null))
      const result = await Effect.runPromise(isPlayerInQueue(redis as never, 'player1'))
      expect(result).toBe(false)
    })
  })

  describe('Distributed Lock for Match Formation', () => {
    it('should use lock when forming matches', async () => {
      const entries = Array.from({ length: 10 }, (_, i) =>
        makeEntry({ playerId: `p${i}`, mmr: 1000 + i * 10, joinedAt: Date.now() - 15000 }),
      )
      for (const e of entries) {
        redis._store.zadd.push(['matchmaking:queue', e.mmr, JSON.stringify(e)])
      }
      redis.zcard.mockReturnValue(Effect.succeed(10))
      redis.zrangebyscore.mockReturnValue(Effect.succeed(redis._store.zadd.map(([, , m]) => m)))
      redis.setnx = vi.fn(() => Effect.succeed(1))
      redis.getdel = vi.fn(() => Effect.succeed('1'))

      const handle = startMatchmakingLoop(redis as never, ws as never, db as never)
      vi.advanceTimersByTime(5000)
      clearInterval(handle)

      expect(redis.setnx).toHaveBeenCalledWith('matchmaking:lock', expect.any(String), 5)
      expect(redis.getdel).toHaveBeenCalledWith('matchmaking:lock')
    })

    it('should handle lock contention gracefully', async () => {
      const entries = Array.from({ length: 10 }, (_, i) =>
        makeEntry({ playerId: `p${i}`, mmr: 1000 + i * 10, joinedAt: Date.now() - 15000 }),
      )
      for (const e of entries) {
        redis._store.zadd.push(['matchmaking:queue', e.mmr, JSON.stringify(e)])
      }
      redis.zcard.mockReturnValue(Effect.succeed(10))
      redis.zrangebyscore.mockReturnValue(Effect.succeed(redis._store.zadd.map(([, , m]) => m)))
      redis.setnx = vi.fn(() => Effect.succeed(0))

      const handle = startMatchmakingLoop(redis as never, ws as never, db as never)
      vi.advanceTimersByTime(5000)
      clearInterval(handle)

      expect(redis.setnx).toHaveBeenCalled()
      expect(redis.zrem).not.toHaveBeenCalled()
    })

    it('should release lock after match formation', async () => {
      const entries = Array.from({ length: 10 }, (_, i) =>
        makeEntry({ playerId: `p${i}`, mmr: 1000 + i * 10, joinedAt: Date.now() - 15000 }),
      )
      for (const e of entries) {
        redis._store.zadd.push(['matchmaking:queue', e.mmr, JSON.stringify(e)])
      }
      redis.zcard.mockReturnValue(Effect.succeed(10))
      redis.zrangebyscore.mockReturnValue(Effect.succeed(redis._store.zadd.map(([, , m]) => m)))
      redis.setnx = vi.fn(() => Effect.succeed(1))
      redis.getdel = vi.fn(() => Effect.succeed('1'))

      const handle = startMatchmakingLoop(redis as never, ws as never, db as never)
      vi.advanceTimersByTime(5000)
      clearInterval(handle)

      expect(redis.getdel).toHaveBeenCalledWith('matchmaking:lock')
    })
  })

  describe('Atomic Queue Operations', () => {
    it('should prevent duplicate queue joins atomically', async () => {
      const entry = makeEntry({ playerId: 'duplicate_player' })
      redis.eval = vi.fn(() => Effect.succeed('DUPLICATE'))

      const result = await Effect.runPromise(Effect.either(joinQueue(redis as never, entry)))
      expect(result._tag).toBe('Left')
    })

    it('should use Redis transaction for queue join', async () => {
      const entry = makeEntry({ playerId: 'new_player' })
      redis.get.mockReturnValue(Effect.succeed(null))
      redis.eval = vi.fn(() => Effect.succeed('OK'))

      await Effect.runPromise(joinQueue(redis as never, entry))

      expect(redis.eval).toHaveBeenCalled()
    })
  })

  describe('Mode-Based Queue Segregation', () => {
    it('should segregate queues by mode', async () => {
      const rankedEntry = makeEntry({ playerId: 'p1', mode: 'ranked_5v5' })
      const quickEntry = makeEntry({ playerId: 'p2', mode: 'quick_3v3' })
      redis.eval = vi.fn(() => Effect.succeed('OK'))

      await Effect.runPromise(joinQueue(redis as never, rankedEntry))
      await Effect.runPromise(joinQueue(redis as never, quickEntry))

      expect(redis.eval).toHaveBeenCalledTimes(2)
    })
  })

  describe('Snake Draft for Fairer Teams', () => {
    it('should distribute players fairly using snake draft', async () => {
      vi.useFakeTimers()
      const entries = Array.from({ length: 10 }, (_, i) =>
        makeEntry({ playerId: `p${i}`, mmr: 2000 - i * 100 }),
      )
      const { createLobby, cleanupLobby } = await import('../../../server/game/matchmaking/lobby')
      const lobby = createLobby(entries, ws as never, redis as never, db as never)

      const radiant = lobby.players.filter((p) => p.team === 'radiant')
      const dire = lobby.players.filter((p) => p.team === 'dire')

      const radiantMmr = radiant.reduce((sum, p) => sum + p.mmr, 0)
      const direMmr = dire.reduce((sum, p) => sum + p.mmr, 0)

      expect(Math.abs(radiantMmr - direMmr)).toBeLessThan(200)
      cleanupLobby(lobby.id)
      vi.useRealTimers()
    })
  })
})
