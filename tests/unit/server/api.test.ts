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
}))

vi.mock('~~/server/utils/RateLimiter', () => ({
  checkScopedRateLimit: vi.fn(() => true),
}))

// ── Subjects ────────────────────────────────────────────────────────

const leaderboardHandler = (await import('../../../server/api/leaderboard.get')).default
const matchHistoryHandler = (await import('../../../server/api/match/history.get')).default
const playerHandler = (await import('../../../server/api/player/[id].get')).default
const replayHandler = (await import('../../../server/api/replay/[gameId].get')).default
const guildCreateHandler = (await import('../../../server/api/guild/create.post')).default
const guildJoinHandler = (await import('../../../server/api/guild/join.post')).default
const guildMyHandler = (await import('../../../server/api/guild/my.get')).default

const { getGameRuntime } = await import('~~/server/plugins/game-server')
const { checkScopedRateLimit } = await import('~~/server/utils/RateLimiter')

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
  })

  afterEach(() => {
    vi.restoreAllMocks()
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

  // ── /api/replay/[gameId] (archive-only — the Redis fast path died with
  //    the DO-era WS game server; see replayArtifact.ts's module doc) ────

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

    it('404 when no archived replay exists', async () => {
      routerParam = 'g1'
      mockRuntime.dbService.getMatchReplay.mockReturnValue(Effect.succeed(null))
      await expect(replayHandler(makeEvent('GET', '/api/replay/g1'))).rejects.toThrow()
      expect(thrownError?.statusCode).toBe(404)
    })

    it('returns the archived replay with surrenderVotes as stored (already arrays)', async () => {
      routerParam = 'g1'
      mockRuntime.dbService.getMatchReplay.mockReturnValue(
        Effect.succeed({
          matchId: 'g1',
          rulesetVersion: 1,
          rngSeed: 42,
          meta: { players: [] },
          actions: [{ cycle: 1 }],
          finalState: {
            cycle: 9,
            phase: 'ended',
            surrenderVotes: { chaff: ['p1'], audit: [] },
          },
          finalSummaryHash: 'abc',
          createdAt: new Date('2024-01-01T00:00:00Z'),
        } as never),
      )
      const result = await replayHandler(makeEvent('GET', '/api/replay/g1'))
      expect(result.gameId).toBe('g1')
      expect(result.source).toBe('archive')
      expect(result.state).toMatchObject({ surrenderVotes: { chaff: ['p1'], audit: [] } })
      expect(result.actions).toEqual([{ cycle: 1 }])
      expect(result.integrity).toMatchObject({ complete: true, truncated: false })
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
