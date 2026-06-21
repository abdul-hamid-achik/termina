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
import { createLobby } from '../../../server/game/matchmaking/lobby'

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock('../../../server/game/matchmaking/lobby', () => ({
  createLobby: vi.fn((entries: QueueEntry[]) => {
    const sorted = [...entries].sort((a, b) => b.mmr - a.mmr)
    const snakeOrder = [0, 1, 1, 0, 0, 1, 1, 0, 0, 1]
    const players = sorted.map((entry, i) => ({
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
  const store: { zadd: [string, number, string][]; hset: Map<string, string> } = {
    zadd: [],
    hset: new Map(),
  }

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
    hset: vi.fn((key: string, field: string, value: string) => {
      store.hset.set(`${key}:${field}`, value)
      return Effect.void
    }),
    hget: vi.fn((key: string, field: string) => {
      const v = store.hset.get(`${key}:${field}`)
      return Effect.succeed(v ?? null)
    }),
    hdel: vi.fn(() => Effect.void),
    hgetall: vi.fn(() => Effect.succeed({})),
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
        [
          'matchmaking:queue_times:p1:ranked_5v5',
          'matchmaking:queue:ranked_5v5',
          'matchmaking:queue_members',
        ],
        ['p1', 1200, JSON.stringify(entry), expect.any(String), 'ranked_5v5'],
      )
    })

    it('stores queue join time in Redis via Lua script', async () => {
      const entry = makeEntry({ playerId: 'p2', joinedAt: 12345 })
      await Effect.runPromise(joinQueue(redis as never, entry))

      expect(redis.eval).toHaveBeenCalledWith(
        expect.any(String),
        [
          'matchmaking:queue_times:p2:ranked_5v5',
          'matchmaking:queue:ranked_5v5',
          'matchmaking:queue_members',
        ],
        ['p2', 1000, JSON.stringify(entry), '12345', 'ranked_5v5'],
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
    it('removes player entry from Redis sorted set via the member hash (O(1))', async () => {
      const entry = makeEntry({ playerId: 'leaving_player', mmr: 1000 })
      const member = JSON.stringify(entry)
      redis.hget.mockReturnValue(Effect.succeed(member))

      await Effect.runPromise(leaveQueue(redis as never, 'leaving_player'))

      expect(redis.zrem).toHaveBeenCalledWith('matchmaking:queue:ranked_5v5', member)
      expect(redis.hdel).toHaveBeenCalledWith(
        'matchmaking:queue_members',
        'leaving_player:ranked_5v5',
      )
    })

    it('cleans up queue time key', async () => {
      redis.hget.mockReturnValue(Effect.succeed(null))

      await Effect.runPromise(leaveQueue(redis as never, 'p_leave'))

      expect(redis.del).toHaveBeenCalledWith('matchmaking:queue_times:p_leave:ranked_5v5')
    })

    it('handles player not found in queue gracefully', async () => {
      redis.hget.mockReturnValue(Effect.succeed(null))

      await expect(
        Effect.runPromise(leaveQueue(redis as never, 'nonexistent')),
      ).resolves.toBeUndefined()
    })

    it('does not call zrem when the player has no member mapping', async () => {
      redis.hget.mockReturnValue(Effect.succeed(null))

      await Effect.runPromise(leaveQueue(redis as never, 'ghost'))

      expect(redis.zrem).not.toHaveBeenCalled()
    })

    it('targets the mode-specific queue + time + member keys when a mode is given', async () => {
      const entry = makeEntry({ playerId: 'p_q', mode: 'quick_3v3' })
      const member = JSON.stringify(entry)
      redis.hget.mockReturnValue(Effect.succeed(member))

      await Effect.runPromise(leaveQueue(redis as never, 'p_q', 'quick_3v3'))

      expect(redis.zrem).toHaveBeenCalledWith('matchmaking:queue:quick_3v3', member)
      expect(redis.del).toHaveBeenCalledWith('matchmaking:queue_times:p_q:quick_3v3')
      expect(redis.hdel).toHaveBeenCalledWith('matchmaking:queue_members', 'p_q:quick_3v3')
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

    it('queries the mode-specific queue key when a mode is given', async () => {
      redis.zcard.mockReturnValue(Effect.succeed(3))

      const size = await Effect.runPromise(getQueueSize(redis as never, 'quick_3v3'))
      expect(size).toBe(3)
      expect(redis.zcard).toHaveBeenCalledWith('matchmaking:queue:quick_3v3')
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

    it('fills a long-waiting partial queue with bots and forms a match', async () => {
      vi.mocked(createLobby).mockClear()
      // One real player who joined well past BOT_FILL_WAIT_MS (10s) ago.
      const waited = makeEntry({ playerId: 'human_1', joinedAt: Date.now() - 30_000 })
      redis._store.zadd.push(['matchmaking:queue:ranked_5v5', waited.mmr, JSON.stringify(waited)])

      const handle = startMatchmakingLoop(redis as never, ws as never, db as never)
      // advanceTimersByTimeAsync flushes the async Effect program to completion.
      await vi.advanceTimersByTimeAsync(5000)

      // Bot-fill: the queue entry is removed and a lobby forms with player + bots.
      expect(redis.zrem).toHaveBeenCalled()
      expect(vi.mocked(createLobby)).toHaveBeenCalledTimes(1)
      const formed = vi.mocked(createLobby).mock.calls[0]![0]
      expect(formed).toHaveLength(10) // MATCH_SIZE: 1 human + 9 bots
      expect(formed.some((p) => p.playerId === 'human_1')).toBe(true)
      expect(formed.some((p) => p.playerId.startsWith('bot_'))).toBe(true)

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

    it('checks only the given mode when one is specified', async () => {
      redis.get.mockReturnValue(Effect.succeed('123'))
      const result = await Effect.runPromise(isPlayerInQueue(redis as never, 'p9', '1v1'))
      expect(result).toBe(true)
      expect(redis.get).toHaveBeenCalledWith('matchmaking:queue_times:p9:1v1')
      expect(redis.get).toHaveBeenCalledTimes(1)
    })

    it('scans all modes and finds a player registered under a non-default mode', async () => {
      // Absent from ranked_5v5 and quick_3v3, present in 1v1 — the loop must
      // keep scanning past the early misses before returning true.
      redis.get
        .mockReturnValueOnce(Effect.succeed(null))
        .mockReturnValueOnce(Effect.succeed(null))
        .mockReturnValueOnce(Effect.succeed('77'))
      const result = await Effect.runPromise(isPlayerInQueue(redis as never, 'p_late'))
      expect(result).toBe(true)
      expect(redis.get).toHaveBeenCalledTimes(3)
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
      // Lock release is now a Lua compare-and-delete (not getdel) so a TTL
      // expiry + peer reacquire can't have our release steal their lock.
      expect(redis.eval).toHaveBeenCalledWith(
        expect.stringContaining("redis.call('del'"),
        ['matchmaking:lock'],
        [expect.any(String)],
      )
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
      redis.eval = vi.fn(() => Effect.succeed(1))

      const handle = startMatchmakingLoop(redis as never, ws as never, db as never)
      vi.advanceTimersByTime(5000)
      clearInterval(handle)

      // Compare-and-delete Lua release (not getdel).
      expect(redis.eval).toHaveBeenCalledWith(
        expect.stringContaining("redis.call('del'"),
        ['matchmaking:lock'],
        [expect.any(String)],
      )
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

  describe('MMR-range match formation', () => {
    it('forms no match when a full queue is too far apart in MMR', async () => {
      vi.mocked(createLobby).mockClear()
      const now = Date.now()
      // 10 players just joined, spread 500..5000 — far wider than even the
      // widest allowed window, so no MATCH_SIZE group is within range.
      for (let i = 0; i < 10; i++) {
        const e = makeEntry({ playerId: `wide${i}`, mmr: 500 + i * 500, joinedAt: now })
        redis._store.zadd.push(['matchmaking:queue:ranked_5v5', e.mmr, JSON.stringify(e)])
      }
      redis.zcard.mockReturnValue(Effect.succeed(10))
      redis.zrangebyscore.mockReturnValue(Effect.succeed(redis._store.zadd.map(([, , m]) => m)))

      const handle = startMatchmakingLoop(redis as never, ws as never, db as never)
      await vi.advanceTimersByTimeAsync(5000)
      clearInterval(handle)

      expect(vi.mocked(createLobby)).not.toHaveBeenCalled()
    })

    it('widens the MMR window over wait time, matching a spread-out full queue after a long wait', async () => {
      vi.mocked(createLobby).mockClear()
      const now = Date.now()
      // Spread ~300 (1000..1297): outside the 0s window (±50 → 100) but inside
      // the 60s+ window (±200 → 400). All have waited 70s, so the range widens
      // and the match forms — exercising getMmrRange's higher bracket.
      for (let i = 0; i < 10; i++) {
        const e = makeEntry({ playerId: `wait${i}`, mmr: 1000 + i * 33, joinedAt: now - 70_000 })
        redis._store.zadd.push(['matchmaking:queue:ranked_5v5', e.mmr, JSON.stringify(e)])
      }
      redis.zcard.mockReturnValue(Effect.succeed(10))
      redis.zrangebyscore.mockReturnValue(Effect.succeed(redis._store.zadd.map(([, , m]) => m)))

      const handle = startMatchmakingLoop(redis as never, ws as never, db as never)
      await vi.advanceTimersByTimeAsync(5000)
      clearInterval(handle)

      expect(vi.mocked(createLobby)).toHaveBeenCalledTimes(1)
      expect(vi.mocked(createLobby).mock.calls[0]![0]).toHaveLength(10) // a real 10-human match
    })
  })
})
