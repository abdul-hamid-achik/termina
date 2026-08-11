import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getRankTier } from '~~/shared/constants/ranks'
import { Effect } from 'effect'
import type { H3Event } from 'h3'

// ── Stubs for Nitro/h3 auto-imports ─────────────────────────────────

let sessionUser: {
  user?: { id?: string; username?: string; guest?: boolean }
} | null = null
let requestHeaders: Record<string, string> = {}
let requestBody: unknown = {}
let requestQuery: Record<string, unknown> = {}
let routerParam: string | undefined
let thrownError: { statusCode: number; message: string } | null = null
let sessionSets: Array<{ user: Record<string, unknown> }> = []

function makeEvent(method: string, path: string): H3Event {
  return {
    method,
    path,
    node: { req: { method, headers: requestHeaders }, res: {} },
    context: {},
  } as unknown as H3Event
}

vi.stubGlobal('defineEventHandler', (fn: (event: H3Event) => unknown) => fn)
vi.stubGlobal('getUserSession', async () => sessionUser)
vi.stubGlobal('createError', (opts: { statusCode: number; message: string }) => {
  thrownError = opts
  const err = new Error(opts.message) as Error & { statusCode: number }
  err.statusCode = opts.statusCode
  throw err
})
vi.stubGlobal('readBody', async () => requestBody)
vi.stubGlobal('getQuery', () => requestQuery)
vi.stubGlobal('setHeader', () => {})
vi.stubGlobal('getRequestIP', () => '127.0.0.1')
vi.stubGlobal(
  'setUserSession',
  async (_event: H3Event, payload: { user: Record<string, unknown> }) => {
    sessionSets.push(payload)
  },
)
vi.stubGlobal('getRouterParam', () => routerParam)

// ── Mocks for module imports ────────────────────────────────────────

const mockRuntime = {
  redisService: {
    get: vi.fn(),
    set: vi.fn(),
    zadd: vi.fn(),
    zcard: vi.fn(),
    zrangebyscore: vi.fn(() => []),
    zrem: vi.fn(),
    sismember: vi.fn(),
    sadd: vi.fn(),
    srem: vi.fn(),
    scard: vi.fn(),
    del: vi.fn(),
    keys: vi.fn(() => []),
    scan: vi.fn(() => []),
    hget: vi.fn(),
    hset: vi.fn(),
    hdel: vi.fn(),
    hgetall: vi.fn(() => ({})),
    publish: vi.fn(),
  },
  dbService: {
    getPlayer: vi.fn(() => Effect.succeed(null)),
    getMatchReplay: vi.fn(() => Effect.succeed(null)),
    getPlayerByProvider: vi.fn(() => Effect.succeed(null)),
    getLeaderboard: vi.fn(() => Effect.succeed([])),
    getSeasonLeaderboard: vi.fn(() => Effect.succeed([])),
    getGuildsByIds: vi.fn(() => Effect.succeed([])),
    createGuild: vi.fn(() =>
      Effect.succeed({ id: 'g1', name: 'Void', tag: 'VOID', leaderId: 'p1' }),
    ),
    getGuild: vi.fn(() => Effect.succeed(null)),
    getGuildByName: vi.fn(() => Effect.succeed(null)),
    getPlayerGuild: vi.fn(() => Effect.succeed(null)),
    getGuildMembers: vi.fn(() => Effect.succeed([])),
    listGuilds: vi.fn(() => Effect.succeed([])),
    joinGuild: vi.fn(() => Effect.succeed(undefined)),
    leaveGuild: vi.fn(() => Effect.succeed(undefined)),
    getCurrentSeason: vi.fn(() =>
      Effect.succeed({ seasonNumber: 1, startedAt: new Date(), active: true }),
    ),
    getMatchHistory: vi.fn(() => Effect.succeed([])),
    getHeroStats: vi.fn(() => Effect.succeed([])),
    recordMatch: vi.fn(() => Effect.succeed(true)),
    getPlayerStats: vi.fn(() => Effect.succeed(null)),
    updatePlayerAvatar: vi.fn(() => Effect.succeed(undefined)),
  },
}

vi.mock('~~/server/plugins/game-server', () => ({
  getGameRuntime: vi.fn(() => mockRuntime),
  createTutorialGame: vi.fn(),
  stopDevGame: vi.fn(),
}))

vi.mock('~~/server/game/matchmaking/queue', () => ({
  joinQueue: vi.fn(() => Effect.succeed('ok')),
  leaveQueue: vi.fn(() => Effect.succeed('ok')),
  getQueueSize: vi.fn(() => Effect.succeed(0)),
  isPlayerInQueue: vi.fn(() => Effect.succeed(false)),
}))

vi.mock('~~/server/services/PeerRegistry', () => ({
  getPlayerGame: vi.fn(),
  clearPlayerGame: vi.fn(),
  sendToPeer: vi.fn(),
}))

vi.mock('~~/server/game/matchmaking/lobby', () => ({
  getPlayerLobby: vi.fn(),
  getLobby: vi.fn(),
}))

vi.mock('~~/server/utils/RateLimiter', () => ({
  checkScopedRateLimit: vi.fn(() => true),
}))

vi.mock('~~/server/game/engine/StateSnapshot', () => ({
  readSnapshot: vi.fn(() => Effect.succeed(null)),
}))

vi.mock('~~/server/game/engine/ActionLog', () => ({
  readActions: vi.fn(() => Effect.succeed([])),
  readActionLog: vi.fn(() =>
    Effect.succeed({
      actions: [],
      integrity: {
        complete: true,
        truncated: false,
        readFailed: false,
        entryCount: 0,
        firstLoggedCycle: null,
        lastLoggedCycle: null,
        initialSnapshotCycle: 0,
      },
    }),
  ),
}))

// ── Subjects ────────────────────────────────────────────────────────

const joinHandler = (await import('../../../server/api/queue/join.post')).default
const leaveHandler = (await import('../../../server/api/queue/leave.post')).default
const leaderboardHandler = (await import('../../../server/api/leaderboard.get')).default
const matchHistoryHandler = (await import('../../../server/api/match/history.get')).default
const playerHandler = (await import('../../../server/api/player/[id].get')).default
const replayHandler = (await import('../../../server/api/replay/[gameId].get')).default
const statusHandler = (await import('../../../server/api/queue/status.get')).default
const guildCreateHandler = (await import('../../../server/api/guild/create.post')).default
const guildJoinHandler = (await import('../../../server/api/guild/join.post')).default
const guildMyHandler = (await import('../../../server/api/guild/my.get')).default

const { getGameRuntime, createTutorialGame, stopDevGame } =
  await import('~~/server/plugins/game-server')
const { joinQueue, leaveQueue } = await import('~~/server/game/matchmaking/queue')
const { getPlayerGame, clearPlayerGame, sendToPeer } =
  await import('~~/server/services/PeerRegistry')
const { getPlayerLobby } = await import('~~/server/game/matchmaking/lobby')
const { checkScopedRateLimit } = await import('~~/server/utils/RateLimiter')
const { readSnapshot } = await import('~~/server/game/engine/StateSnapshot')
const { readActions, readActionLog } = await import('~~/server/game/engine/ActionLog')

// ── Tests ──────────────────────────────────────────────────────────

describe('API endpoints', () => {
  beforeEach(() => {
    sessionUser = null
    requestHeaders = {}
    requestBody = {}
    requestQuery = {}
    routerParam = undefined
    thrownError = null
    sessionSets = []
    vi.clearAllMocks()
    vi.mocked(getGameRuntime).mockReturnValue(mockRuntime)
    vi.mocked(checkScopedRateLimit).mockReturnValue(true)
    vi.mocked(readSnapshot).mockReturnValue(Effect.succeed(null))
    vi.mocked(readActions).mockReturnValue(Effect.succeed([]))
    vi.mocked(readActionLog).mockReturnValue(
      Effect.succeed({
        actions: [],
        integrity: {
          complete: true,
          truncated: false,
          readFailed: false,
          entryCount: 0,
          firstLoggedCycle: null,
          lastLoggedCycle: null,
          initialSnapshotCycle: 0,
        },
      }),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── /api/queue/join ──────────────────────────────────────────────

  describe('POST /api/queue/join', () => {
    it('401 when not authenticated', async () => {
      sessionUser = null
      await expect(joinHandler(makeEvent('POST', '/api/queue/join'))).rejects.toThrow()
      expect(thrownError?.statusCode).toBe(401)
    })

    it('503 when runtime is not ready', async () => {
      sessionUser = { user: { id: 'p1', username: 'alice' } }
      vi.mocked(getGameRuntime).mockReturnValue(null)
      await expect(joinHandler(makeEvent('POST', '/api/queue/join'))).rejects.toThrow()
      expect(thrownError?.statusCode).toBe(503)
    })

    it('403 when the session is a guest — ranked/casual persist state a guest has none of', async () => {
      // Guest practice (server/api/auth/guest.post.ts) only ever launches the
      // tutorial directly; matchmaking needs an MMR + match history a guest
      // has no DB row for. Reject clearly rather than let it fall through to
      // a real queue entry keyed on an id nothing will ever read back.
      sessionUser = { user: { id: 'guest_a1b2c3d4e5f6', username: 'GUEST-A1B2', guest: true } }
      await expect(joinHandler(makeEvent('POST', '/api/queue/join'))).rejects.toThrow()
      expect(thrownError?.statusCode).toBe(403)
      expect(thrownError?.message.toLowerCase()).toContain('sign in')
      // Must reject BEFORE touching the rate limiter or any queue state.
      expect(vi.mocked(checkScopedRateLimit)).not.toHaveBeenCalled()
    })

    it('409 when already in an active game', async () => {
      sessionUser = { user: { id: 'p1', username: 'alice' } }
      vi.mocked(getPlayerGame).mockReturnValue('game-123')
      await expect(joinHandler(makeEvent('POST', '/api/queue/join'))).rejects.toThrow()
      expect(thrownError?.statusCode).toBe(409)
    })

    it('400 for an invalid game mode', async () => {
      sessionUser = { user: { id: 'p1', username: 'alice' } }
      requestBody = { mode: 'capture_the_flag' }
      vi.mocked(getPlayerGame).mockReturnValue(undefined)
      vi.mocked(getPlayerLobby).mockReturnValue(undefined)
      const { isPlayerInQueue } = await import('~~/server/game/matchmaking/queue')
      vi.mocked(isPlayerInQueue).mockReturnValue(Effect.succeed(false))
      await expect(joinHandler(makeEvent('POST', '/api/queue/join'))).rejects.toThrow()
      expect(thrownError?.statusCode).toBe(400)
    })

    it('409 when already in queue', async () => {
      sessionUser = { user: { id: 'p1', username: 'alice' } }
      requestBody = { mode: 'ranked_5v5' }
      vi.mocked(getPlayerGame).mockReturnValue(undefined)
      vi.mocked(getPlayerLobby).mockReturnValue(undefined)
      const { isPlayerInQueue } = await import('~~/server/game/matchmaking/queue')
      vi.mocked(isPlayerInQueue).mockReturnValue(Effect.succeed(true))
      await expect(joinHandler(makeEvent('POST', '/api/queue/join'))).rejects.toThrow()
      expect(thrownError?.statusCode).toBe(409)
    })

    it('409 when currently in a lobby', async () => {
      sessionUser = { user: { id: 'p1', username: 'alice' } }
      requestBody = { mode: 'ranked_5v5' }
      vi.mocked(getPlayerGame).mockReturnValue(undefined)
      vi.mocked(getPlayerLobby).mockReturnValue('lobby-1')
      const { isPlayerInQueue } = await import('~~/server/game/matchmaking/queue')
      vi.mocked(isPlayerInQueue).mockReturnValue(Effect.succeed(false))
      await expect(joinHandler(makeEvent('POST', '/api/queue/join'))).rejects.toThrow()
      expect(thrownError?.statusCode).toBe(409)
    })

    it('returns success + queueSize on valid join', async () => {
      sessionUser = { user: { id: 'p1', username: 'alice' } }
      requestBody = { mode: 'quick_3v3' }
      vi.mocked(getPlayerGame).mockReturnValue(undefined)
      vi.mocked(getPlayerLobby).mockReturnValue(undefined)
      const { isPlayerInQueue, getQueueSize } = await import('~~/server/game/matchmaking/queue')
      vi.mocked(isPlayerInQueue).mockReturnValue(Effect.succeed(false))
      vi.mocked(getQueueSize).mockReturnValue(Effect.succeed(5))
      mockRuntime.dbService.getPlayer.mockReturnValue(
        Effect.succeed({ username: 'alice', mmr: 1500 } as never),
      )

      const result = await joinHandler(makeEvent('POST', '/api/queue/join'))
      expect(result).toEqual({ success: true, queueSize: 5 })
      expect(vi.mocked(joinQueue)).toHaveBeenCalledWith(
        mockRuntime.redisService,
        expect.objectContaining({ playerId: 'p1', mode: 'quick_3v3', mmr: 1500 }),
      )
    })

    it('passes mode through to joinQueue', async () => {
      sessionUser = { user: { id: 'p2', username: 'bob' } }
      requestBody = { mode: '1v1' }
      vi.mocked(getPlayerGame).mockReturnValue(undefined)
      vi.mocked(getPlayerLobby).mockReturnValue(undefined)
      const { isPlayerInQueue, getQueueSize } = await import('~~/server/game/matchmaking/queue')
      vi.mocked(isPlayerInQueue).mockReturnValue(Effect.succeed(false))
      vi.mocked(getQueueSize).mockReturnValue(Effect.succeed(1))
      mockRuntime.dbService.getPlayer.mockReturnValue(
        Effect.succeed({ username: 'bob', mmr: 1200 } as never),
      )

      await joinHandler(makeEvent('POST', '/api/queue/join'))
      expect(vi.mocked(joinQueue)).toHaveBeenCalledWith(
        mockRuntime.redisService,
        expect.objectContaining({ mode: '1v1' }),
      )
    })
  })

  // ── /api/queue/leave ─────────────────────────────────────────────

  describe('POST /api/queue/leave', () => {
    it('401 when not authenticated', async () => {
      sessionUser = null
      await expect(leaveHandler(makeEvent('POST', '/api/queue/leave'))).rejects.toThrow()
      expect(thrownError?.statusCode).toBe(401)
    })

    it('503 when runtime is not ready', async () => {
      sessionUser = { user: { id: 'p1', username: 'alice' } }
      vi.mocked(getGameRuntime).mockReturnValue(null)
      await expect(leaveHandler(makeEvent('POST', '/api/queue/leave'))).rejects.toThrow()
      expect(thrownError?.statusCode).toBe(503)
    })

    it('400 for an invalid mode', async () => {
      sessionUser = { user: { id: 'p1', username: 'alice' } }
      requestBody = { mode: 'invalid' }
      await expect(leaveHandler(makeEvent('POST', '/api/queue/leave'))).rejects.toThrow()
      expect(thrownError?.statusCode).toBe(400)
    })

    it('passes mode through to leaveQueue', async () => {
      sessionUser = { user: { id: 'p1', username: 'alice' } }
      requestBody = { mode: 'quick_3v3' }
      const result = await leaveHandler(makeEvent('POST', '/api/queue/leave'))
      expect(result).toEqual({ success: true })
      expect(vi.mocked(leaveQueue)).toHaveBeenCalledWith(
        mockRuntime.redisService,
        'p1',
        'quick_3v3',
      )
    })

    it('defaults to ranked_5v5 when no mode provided', async () => {
      sessionUser = { user: { id: 'p1', username: 'alice' } }
      requestBody = {}
      await leaveHandler(makeEvent('POST', '/api/queue/leave'))
      expect(vi.mocked(leaveQueue)).toHaveBeenCalledWith(
        mockRuntime.redisService,
        'p1',
        'ranked_5v5',
      )
    })
  })

  // ── /api/leaderboard ─────────────────────────────────────────────

  describe('GET /api/leaderboard', () => {
    it('503 when runtime is not ready', async () => {
      vi.mocked(getGameRuntime).mockReturnValue(null)
      await expect(leaderboardHandler(makeEvent('GET', '/api/leaderboard'))).rejects.toThrow()
      expect(thrownError?.statusCode).toBe(503)
    })

    it('returns mapped leaderboard with computed winRate + rank tier', async () => {
      mockRuntime.dbService.getSeasonLeaderboard.mockReturnValue(
        Effect.succeed([
          {
            id: 'p1',
            username: 'alice',
            avatarUrl: null,
            mmr: 2000,
            seasonMmr: 2000,
            seasonGamesPlayed: 10,
            seasonWins: 7,
          },
          {
            id: 'p2',
            username: 'bob',
            avatarUrl: null,
            mmr: 1500,
            seasonMmr: 1500,
            seasonGamesPlayed: 0,
            seasonWins: 0,
          },
        ] as never),
      )
      const result = await leaderboardHandler(makeEvent('GET', '/api/leaderboard'))
      expect(result.leaderboard).toHaveLength(2)
      expect(result.leaderboard[0]).toMatchObject({
        rank: 1,
        username: 'alice',
        mmr: 2000,
        winRate: 70,
        // Derived, not spelled: the ladder's labels are content and were
        // renamed once already; what this asserts is that the endpoint resolves
        // the tier for the player's seasonal rating at all.
        rankName: getRankTier(2000).name,
      })
      expect(result.leaderboard[1]).toMatchObject({ rank: 2, username: 'bob', winRate: 0 })
      expect(result.season).toMatchObject({ number: 1 })
    })

    it('caps limit at 500', async () => {
      requestQuery = { limit: '99999' }
      mockRuntime.dbService.getSeasonLeaderboard.mockReturnValue(Effect.succeed([] as never))
      await leaderboardHandler(makeEvent('GET', '/api/leaderboard'))
      expect(mockRuntime.dbService.getSeasonLeaderboard).toHaveBeenCalledWith(500)
    })

    it('defaults limit to 100', async () => {
      requestQuery = {}
      mockRuntime.dbService.getSeasonLeaderboard.mockReturnValue(Effect.succeed([] as never))
      await leaderboardHandler(makeEvent('GET', '/api/leaderboard'))
      expect(mockRuntime.dbService.getSeasonLeaderboard).toHaveBeenCalledWith(100)
    })

    it('429 when the per-IP publicRead rate limit is exceeded', async () => {
      vi.mocked(checkScopedRateLimit).mockReturnValue(false)
      await expect(leaderboardHandler(makeEvent('GET', '/api/leaderboard'))).rejects.toThrow()
      expect(thrownError?.statusCode).toBe(429)
    })
  })

  // ── /api/match/history ───────────────────────────────────────────

  describe('GET /api/match/history', () => {
    it('429 when rate limited', async () => {
      vi.mocked(checkScopedRateLimit).mockReturnValue(false)
      await expect(matchHistoryHandler(makeEvent('GET', '/api/match/history'))).rejects.toThrow()
      expect(thrownError?.statusCode).toBe(429)
    })

    it('returns matches for an explicit player query (capping limit)', async () => {
      requestQuery = { player: 'p1', limit: '5' }
      mockRuntime.dbService.getMatchHistory.mockReturnValue(Effect.succeed([{ id: 'm1' }] as never))
      const result = await matchHistoryHandler(makeEvent('GET', '/api/match/history'))
      expect(result).toEqual({ matches: [{ id: 'm1' }] })
      expect(mockRuntime.dbService.getMatchHistory).toHaveBeenCalledWith('p1', 5)
    })

    it('falls back to the authenticated user when no player query', async () => {
      requestQuery = {}
      sessionUser = { user: { id: 'me' } }
      mockRuntime.dbService.getMatchHistory.mockReturnValue(Effect.succeed([] as never))
      await matchHistoryHandler(makeEvent('GET', '/api/match/history'))
      expect(mockRuntime.dbService.getMatchHistory).toHaveBeenCalledWith('me', 20)
    })

    it('401 when no player query and not authenticated', async () => {
      requestQuery = {}
      sessionUser = null
      await expect(matchHistoryHandler(makeEvent('GET', '/api/match/history'))).rejects.toThrow()
      expect(thrownError?.statusCode).toBe(401)
    })
  })

  // ── /api/player/[id] ─────────────────────────────────────────────

  describe('GET /api/player/[id]', () => {
    it('429 when rate limited', async () => {
      vi.mocked(checkScopedRateLimit).mockReturnValue(false)
      await expect(playerHandler(makeEvent('GET', '/api/player/p1'))).rejects.toThrow()
      expect(thrownError?.statusCode).toBe(429)
    })

    it('400 when no id param', async () => {
      routerParam = undefined
      await expect(playerHandler(makeEvent('GET', '/api/player/'))).rejects.toThrow()
      expect(thrownError?.statusCode).toBe(400)
    })

    it('404 when the player does not exist', async () => {
      routerParam = 'ghost'
      mockRuntime.dbService.getPlayer.mockReturnValue(Effect.succeed(null))
      await expect(playerHandler(makeEvent('GET', '/api/player/ghost'))).rejects.toThrow()
      expect(thrownError?.statusCode).toBe(404)
    })

    it('returns the public profile without email/passwordHash', async () => {
      routerParam = 'p1'
      mockRuntime.dbService.getPlayer.mockReturnValue(
        Effect.succeed({
          id: 'p1',
          username: 'alice',
          email: 'a@x.com',
          passwordHash: 'secret',
          mmr: 1500,
        } as never),
      )
      const result = await playerHandler(makeEvent('GET', '/api/player/p1'))
      expect(result.player).toMatchObject({ id: 'p1', username: 'alice', mmr: 1500 })
      expect(result.player).not.toHaveProperty('email')
      expect(result.player).not.toHaveProperty('passwordHash')
    })

    it('includes the public per-hero record (heroStats) for the profile', async () => {
      routerParam = 'p1'
      mockRuntime.dbService.getPlayer.mockReturnValue(
        Effect.succeed({ id: 'p1', username: 'alice', mmr: 1500 } as never),
      )
      mockRuntime.dbService.getHeroStats.mockReturnValue(
        Effect.succeed([{ heroId: 'echo', gamesPlayed: 5, wins: 3 }] as never),
      )
      const result = await playerHandler(makeEvent('GET', '/api/player/p1'))
      expect(result.heroStats).toEqual([{ heroId: 'echo', gamesPlayed: 5, wins: 3 }])
      expect(mockRuntime.dbService.getHeroStats).toHaveBeenCalledWith('p1')
    })

    it('resolves the guild (name + tag) when the player is in one', async () => {
      routerParam = 'p1'
      mockRuntime.dbService.getPlayer.mockReturnValue(
        Effect.succeed({ id: 'p1', username: 'alice', mmr: 1500, guildId: 'g1' } as never),
      )
      mockRuntime.dbService.getGuild.mockReturnValue(
        Effect.succeed({ id: 'g1', name: 'Void Callers', tag: 'VOID', leaderId: 'p1' } as never),
      )
      const result = await playerHandler(makeEvent('GET', '/api/player/p1'))
      expect(result.guild).toEqual({ id: 'g1', name: 'Void Callers', tag: 'VOID' })
      expect(mockRuntime.dbService.getGuild).toHaveBeenCalledWith('g1')
    })

    it('returns null guild when the player is unaffiliated', async () => {
      routerParam = 'p1'
      mockRuntime.dbService.getPlayer.mockReturnValue(
        Effect.succeed({ id: 'p1', username: 'alice', mmr: 1500, guildId: null } as never),
      )
      const result = await playerHandler(makeEvent('GET', '/api/player/p1'))
      expect(result.guild).toBeNull()
    })
  })

  // ── /api/replay/[gameId] ─────────────────────────────────────────

  describe('GET /api/replay/[gameId]', () => {
    it('429 when rate limited', async () => {
      vi.mocked(checkScopedRateLimit).mockReturnValue(false)
      await expect(replayHandler(makeEvent('GET', '/api/replay/g1'))).rejects.toThrow()
      expect(thrownError?.statusCode).toBe(429)
    })

    it('400 when no gameId param', async () => {
      routerParam = undefined
      await expect(replayHandler(makeEvent('GET', '/api/replay/'))).rejects.toThrow()
      expect(thrownError?.statusCode).toBe(400)
    })

    it('404 when no snapshot exists', async () => {
      routerParam = 'g1'
      vi.mocked(readSnapshot).mockReturnValue(Effect.succeed(null))
      await expect(replayHandler(makeEvent('GET', '/api/replay/g1'))).rejects.toThrow()
      expect(thrownError?.statusCode).toBe(404)
    })

    it('403 for a mid-game snapshot — replays are post-game only (live-state maphack)', async () => {
      routerParam = 'g_live'
      vi.mocked(readSnapshot).mockReturnValue(
        Effect.succeed({
          savedAt: 100,
          state: {
            cycle: 9,
            phase: 'playing',
            surrenderVotes: { chaff: new Set(), audit: new Set() },
          },
          meta: { players: [] },
        } as never),
      )
      await expect(replayHandler(makeEvent('GET', '/api/replay/g_live'))).rejects.toThrow()
      expect(thrownError?.statusCode).toBe(403)
    })

    it('returns the snapshot + actions with surrenderVotes converted to arrays', async () => {
      routerParam = 'g1'
      vi.mocked(readSnapshot).mockReturnValue(
        Effect.succeed({
          savedAt: 123,
          state: {
            cycle: 9,
            phase: 'ended',
            surrenderVotes: { chaff: new Set(['p1']), audit: new Set() },
          },
          meta: { players: [] },
        } as never),
      )
      vi.mocked(readActionLog).mockReturnValue(
        Effect.succeed({
          actions: [{ cycle: 1 }] as never,
          integrity: {
            complete: true,
            truncated: false,
            readFailed: false,
            entryCount: 1,
            firstLoggedCycle: 1,
            lastLoggedCycle: 1,
            initialSnapshotCycle: 0,
          },
        }),
      )
      const result = await replayHandler(makeEvent('GET', '/api/replay/g1'))
      expect(result.gameId).toBe('g1')
      expect(result.savedAt).toBe(123)
      expect(result.state.surrenderVotes).toEqual({ chaff: ['p1'], audit: [] })
      expect(result.actions).toEqual([{ cycle: 1 }])
      expect(result.integrity).toMatchObject({ complete: true, truncated: false })
    })

    it('503 when the action log read failed', async () => {
      routerParam = 'g1'
      vi.mocked(readSnapshot).mockReturnValue(
        Effect.succeed({
          savedAt: 123,
          state: {
            cycle: 9,
            phase: 'ended',
            surrenderVotes: { chaff: new Set(), audit: new Set() },
          },
          meta: { players: [] },
        } as never),
      )
      vi.mocked(readActionLog).mockReturnValue(
        Effect.succeed({
          actions: [],
          integrity: {
            complete: false,
            truncated: false,
            readFailed: true,
            entryCount: 0,
            firstLoggedCycle: null,
            lastLoggedCycle: null,
            initialSnapshotCycle: 0,
          },
        }),
      )
      await expect(replayHandler(makeEvent('GET', '/api/replay/g1'))).rejects.toThrow()
      expect(thrownError?.statusCode).toBe(503)
    })

    it('labels a truncated log as incomplete instead of presenting it as exact', async () => {
      routerParam = 'g1'
      vi.mocked(readSnapshot).mockReturnValue(
        Effect.succeed({
          savedAt: 123,
          state: {
            cycle: 900,
            phase: 'ended',
            surrenderVotes: { chaff: new Set(), audit: new Set() },
          },
          meta: { players: [], mapId: 'classic', mode: 'normal' },
        } as never),
      )
      vi.mocked(readActionLog).mockReturnValue(
        Effect.succeed({
          actions: [{ cycle: 500 }] as never,
          integrity: {
            complete: false,
            truncated: true,
            readFailed: false,
            entryCount: 10000,
            firstLoggedCycle: 500,
            lastLoggedCycle: 900,
            initialSnapshotCycle: 0,
          },
        }),
      )
      const result = await replayHandler(makeEvent('GET', '/api/replay/g1'))
      expect(result.integrity).toMatchObject({ complete: false, truncated: true })
      expect(result.meta).toMatchObject({ mapId: 'classic', mode: 'normal' })
    })
  })

  // ── /api/queue/status ────────────────────────────────────────────

  describe('GET /api/queue/status', () => {
    it('503 when runtime is not ready', async () => {
      vi.mocked(getGameRuntime).mockReturnValue(null)
      await expect(statusHandler(makeEvent('GET', '/api/queue/status'))).rejects.toThrow()
      expect(thrownError?.statusCode).toBe(503)
    })

    it('returns idle when not authenticated', async () => {
      sessionUser = null
      const result = await statusHandler(makeEvent('GET', '/api/queue/status'))
      expect(result).toEqual({ status: 'idle' })
    })

    it('returns game_starting when player has an active game', async () => {
      sessionUser = { user: { id: 'p1' } }
      vi.mocked(getPlayerGame).mockReturnValue('game-42')
      const result = await statusHandler(makeEvent('GET', '/api/queue/status'))
      expect(result).toEqual({ status: 'game_starting', gameId: 'game-42' })
    })

    it('returns idle when authenticated but not in queue/lobby/game', async () => {
      sessionUser = { user: { id: 'p1' } }
      vi.mocked(getPlayerGame).mockReturnValue(undefined)
      vi.mocked(getPlayerLobby).mockReturnValue(undefined)
      const { isPlayerInQueue } = await import('~~/server/game/matchmaking/queue')
      vi.mocked(isPlayerInQueue).mockReturnValue(Effect.succeed(false))
      const result = await statusHandler(makeEvent('GET', '/api/queue/status'))
      expect(result).toEqual({ status: 'idle' })
    })

    it('returns searching when in queue', async () => {
      sessionUser = { user: { id: 'p1' } }
      vi.mocked(getPlayerGame).mockReturnValue(undefined)
      vi.mocked(getPlayerLobby).mockReturnValue(undefined)
      const { isPlayerInQueue, getQueueSize } = await import('~~/server/game/matchmaking/queue')
      vi.mocked(isPlayerInQueue).mockReturnValue(Effect.succeed(true))
      vi.mocked(getQueueSize).mockReturnValue(Effect.succeed(4))
      const result = await statusHandler(makeEvent('GET', '/api/queue/status'))
      expect(result).toMatchObject({ status: 'searching', playersInQueue: 4 })
    })
  })

  // ── /api/game/tutorial ───────────────────────────────────────────

  describe('POST /api/game/tutorial', () => {
    it('401 when not authenticated', async () => {
      sessionUser = null
      const tutorialHandler = (await import('../../../server/api/game/tutorial.post')).default
      await expect(tutorialHandler(makeEvent('POST', '/api/game/tutorial'))).rejects.toThrow()
      expect(thrownError?.statusCode).toBe(401)
    })

    it('409 when already in a REAL match', async () => {
      sessionUser = { user: { id: 'p1' } }
      vi.mocked(getPlayerGame).mockReturnValue('game-99')
      const tutorialHandler = (await import('../../../server/api/game/tutorial.post')).default
      await expect(tutorialHandler(makeEvent('POST', '/api/game/tutorial'))).rejects.toThrow()
      expect(thrownError?.statusCode).toBe(409)
    })

    it('replaces an abandoned PRACTICE game instead of locking the player out', async () => {
      // REGRESSION: clicking PRACTICE and closing the tab before the WebSocket
      // opened left a dev_ game ticking with the player mapped to it forever —
      // the WS close handler that stops it never fired, and the stale-game
      // reaper skips a game whose loop is still running. Every later attempt
      // 409'd and the client silently redirected, so the button was broken for
      // good. Practice is disposable: replace it.
      sessionUser = { user: { id: 'p1' } }
      vi.mocked(getPlayerGame).mockReturnValue('dev_abandoned')
      vi.mocked(createTutorialGame).mockResolvedValue({ gameId: 'dev_fresh' } as never)

      const tutorialHandler = (await import('../../../server/api/game/tutorial.post')).default
      const res = await tutorialHandler(makeEvent('POST', '/api/game/tutorial'))

      expect(stopDevGame).toHaveBeenCalledWith('dev_abandoned')
      expect(clearPlayerGame).toHaveBeenCalledWith('p1')
      expect((res as { gameId: string }).gameId).toBe('dev_fresh')
      // A still-open tab on the replaced game is told why it stopped, rather
      // than being left on a frozen board (stopDevGame interrupts the loop, it
      // does not end the match).
      expect(sendToPeer).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({ code: 'PRACTICE_REPLACED' }),
      )
    })

    it('429 when rate-limited', async () => {
      sessionUser = { user: { id: 'p1' } }
      vi.mocked(getPlayerGame).mockReturnValue(undefined)
      vi.mocked(checkScopedRateLimit).mockReturnValue(false)
      const tutorialHandler = (await import('../../../server/api/game/tutorial.post')).default
      await expect(tutorialHandler(makeEvent('POST', '/api/game/tutorial'))).rejects.toThrow()
      expect(thrownError?.statusCode).toBe(429)
    })

    it('returns gameId + url on success', async () => {
      sessionUser = { user: { id: 'p1' } }
      vi.mocked(getPlayerGame).mockReturnValue(undefined)
      vi.mocked(checkScopedRateLimit).mockReturnValue(true)
      vi.mocked(createTutorialGame).mockResolvedValue({ gameId: 'tut-1' } as never)
      const tutorialHandler = (await import('../../../server/api/game/tutorial.post')).default
      const result = await tutorialHandler(makeEvent('POST', '/api/game/tutorial'))
      expect(result).toMatchObject({ gameId: 'tut-1', playerId: 'p1' })
      expect(result.url).toContain('/play?gameId=tut-1')
    })

    it('launches for a guest id with no DB read — a guest has no players row', async () => {
      // Guest practice (server/api/auth/guest.post.ts): the tutorial launcher
      // itself must never touch the DB for a guest id. It doesn't touch the
      // DB for ANY id today (mmr is hardcoded, not read) — this pins that.
      sessionUser = { user: { id: 'guest_a1b2c3d4e5f6', guest: true } }
      vi.mocked(getPlayerGame).mockReturnValue(undefined)
      vi.mocked(checkScopedRateLimit).mockReturnValue(true)
      vi.mocked(createTutorialGame).mockResolvedValue({ gameId: 'tut-guest' } as never)
      const tutorialHandler = (await import('../../../server/api/game/tutorial.post')).default
      const result = await tutorialHandler(makeEvent('POST', '/api/game/tutorial'))
      expect(result).toMatchObject({ gameId: 'tut-guest', playerId: 'guest_a1b2c3d4e5f6' })
      expect(mockRuntime.dbService.getPlayer).not.toHaveBeenCalled()
    })
  })

  // ── /api/player/settings ─────────────────────────────────────────

  describe('PUT /api/player/settings', () => {
    it('403s a guest session instead of 500ing on the missing players row', async () => {
      // The actual bug this fix removes: with no explicit guard, the handler
      // unconditionally re-reads getPlayer(playerId) at the end to re-stamp
      // the session, then dereferences the result as `player!.id` — for a
      // guest (no row) that throws on the null, surfacing as a bare 500.
      sessionUser = { user: { id: 'guest_a1b2c3d4e5f6', guest: true } }
      requestBody = { selectedAvatar: 'daemon' }
      const settingsHandler = (await import('../../../server/api/player/settings.put')).default
      await expect(settingsHandler(makeEvent('PUT', '/api/player/settings'))).rejects.toThrow()
      expect(thrownError?.statusCode).toBe(403)
      expect(thrownError?.message.toLowerCase()).toContain('sign in')
      expect(mockRuntime.dbService.getPlayer).not.toHaveBeenCalled()
      expect(sessionSets).toHaveLength(0)
    })

    it('still updates a real account (regression guard for the guest fix above)', async () => {
      sessionUser = { user: { id: 'p1', username: 'alice' } }
      requestBody = { selectedAvatar: 'daemon' }
      mockRuntime.dbService.getPlayer.mockReturnValue(
        Effect.succeed({
          id: 'p1',
          username: 'alice',
          avatarUrl: null,
          selectedAvatar: 'daemon',
          passwordHash: null,
          tutorialCompleted: false,
        } as never),
      )
      const settingsHandler = (await import('../../../server/api/player/settings.put')).default
      const result = await settingsHandler(makeEvent('PUT', '/api/player/settings'))
      expect(mockRuntime.dbService.updatePlayerAvatar).toHaveBeenCalledWith('p1', 'daemon')
      expect((result as { user: { selectedAvatar: string } }).user.selectedAvatar).toBe('daemon')
    })
  })

  describe('guild endpoints', () => {
    it('rejects guild create with a too-short name', async () => {
      sessionUser = { user: { id: 'p1', username: 'alice' } }
      requestBody = { name: 'ab', tag: 'AB' }
      await expect(guildCreateHandler(makeEvent('POST', '/api/guild/create'))).rejects.toThrow(
        '3-24 characters',
      )
    })

    it('rejects guild create with a too-short tag', async () => {
      sessionUser = { user: { id: 'p1', username: 'alice' } }
      requestBody = { name: 'Valid Name', tag: 'A' }
      await expect(guildCreateHandler(makeEvent('POST', '/api/guild/create'))).rejects.toThrow(
        '2-5 characters',
      )
    })

    it('rejects a duplicate guild name', async () => {
      sessionUser = { user: { id: 'p1', username: 'alice' } }
      requestBody = { name: 'Taken', tag: 'TKN' }
      mockRuntime.dbService.getGuildByName.mockReturnValue(
        Effect.succeed({ id: 'g9', name: 'Taken', tag: 'TKN', leaderId: 'x' } as never),
      )
      await expect(guildCreateHandler(makeEvent('POST', '/api/guild/create'))).rejects.toThrow(
        'taken',
      )
    })

    it('creates a guild for a valid request', async () => {
      sessionUser = { user: { id: 'p1', username: 'alice' } }
      requestBody = { name: 'Void Callers', tag: 'void' }
      mockRuntime.dbService.getGuildByName.mockReturnValue(Effect.succeed(null))
      const result = await guildCreateHandler(makeEvent('POST', '/api/guild/create'))
      expect(result.guild).toMatchObject({ name: 'Void', tag: 'VOID' })
      expect(mockRuntime.dbService.createGuild).toHaveBeenCalledWith('Void Callers', 'VOID', 'p1')
    })

    it('joins a guild by name', async () => {
      sessionUser = { user: { id: 'p2', username: 'bob' } }
      requestBody = { name: 'Void Callers' }
      mockRuntime.dbService.getGuildByName.mockReturnValue(
        Effect.succeed({ id: 'g1', name: 'Void Callers', tag: 'VOID', leaderId: 'p1' } as never),
      )
      const result = await guildJoinHandler(makeEvent('POST', '/api/guild/join'))
      expect(result.guild).toMatchObject({ id: 'g1' })
      expect(mockRuntime.dbService.joinGuild).toHaveBeenCalledWith('g1', 'p2')
    })

    it('returns null guild + empty members when unaffiliated', async () => {
      sessionUser = { user: { id: 'p1', username: 'alice' } }
      mockRuntime.dbService.getPlayerGuild.mockReturnValue(Effect.succeed(null))
      const result = await guildMyHandler(makeEvent('GET', '/api/guild/my'))
      expect(result).toEqual({ guild: null, members: [] })
    })
  })
})
