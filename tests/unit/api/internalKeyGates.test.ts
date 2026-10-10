import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { H3Event } from 'h3'
import type * as AuthTokensModule from '~~/server/utils/authTokens'
import type * as EffectModule from 'effect'

// start-workflow (WORKFLOW_START_KEY) and rotate-season (TERMINA_ADMIN_KEY)
// are secret-gated server-to-server endpoints: key via HEADER only, never the
// query string, compared in constant time.

let headers: Record<string, string> = {}
let query: Record<string, string> = {}
let body: unknown = {}

vi.stubGlobal('defineEventHandler', (fn: (event: H3Event) => unknown) => fn)
vi.stubGlobal('getRequestHeader', (_e: H3Event, name: string) => headers[name.toLowerCase()])
vi.stubGlobal('getHeader', (_e: H3Event, name: string) => headers[name.toLowerCase()])
vi.stubGlobal('getQuery', () => query)
vi.stubGlobal('readBody', async () => body)
vi.stubGlobal('createError', (opts: { statusCode: number; message: string }) => {
  const err = new Error(opts.message) as Error & { statusCode: number }
  err.statusCode = opts.statusCode
  return err
})

const startLiveGameMock = vi.fn(async (..._args: unknown[]) => ({ gameId: 'wf_1' }))
vi.mock('~~/server/game/liveGame', () => ({
  startLiveGame: (...args: unknown[]) => startLiveGameMock(...args),
}))

// Wrap the real constant-time comparator so tests can prove both handlers
// route their secret comparison through it (a `===`/`!==` is behaviourally
// identical, so only a call-spy can pin timing-safety).
const secretsMatchSpy = vi.fn()
vi.mock('~~/server/utils/authTokens', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthTokensModule>()
  return {
    ...actual,
    secretsMatch: (...args: Parameters<typeof actual.secretsMatch>) => {
      secretsMatchSpy(...args)
      return actual.secretsMatch(...args)
    },
  }
})

const startNewSeasonMock = vi.fn()
vi.mock('~~/server/plugins/game-server', () => ({
  getGameRuntime: () => ({ dbService: { startNewSeason: startNewSeasonMock } }),
}))
vi.mock('effect', async (importOriginal) => {
  const actual = await importOriginal<typeof EffectModule>()
  return { ...actual, Effect: { ...actual.Effect, runPromise: async (v: unknown) => v } }
})

const startWorkflow = (await import('~~/server/api/game/start-workflow.post'))
  .default as unknown as (e: H3Event) => Promise<unknown>
const rotateSeason = (await import('~~/server/api/admin/rotate-season.post'))
  .default as unknown as (e: H3Event) => Promise<unknown>
const { secretsMatch } = await import('~~/server/utils/authTokens')

const ev = {} as H3Event
const validBody = { players: [{ playerId: 'p1', team: 'chaff', heroId: 'echo' }] }

beforeEach(() => {
  headers = {}
  query = {}
  body = validBody
  startLiveGameMock.mockClear()
  secretsMatchSpy.mockClear()
  startNewSeasonMock.mockReset()
  startNewSeasonMock.mockReturnValue({ seasonNumber: 2, startedAt: new Date(0) })
  process.env.WORKFLOW_START_KEY = 'wf-secret'
  process.env.TERMINA_ADMIN_KEY = 'admin-secret'
})

afterEach(() => {
  delete process.env.WORKFLOW_START_KEY
  delete process.env.TERMINA_ADMIN_KEY
})

describe('secretsMatch', () => {
  it('matches only identical secrets, tolerating different lengths', () => {
    expect(secretsMatch('abc', 'abc')).toBe(true)
    expect(secretsMatch('abd', 'abc')).toBe(false)
    expect(secretsMatch('abcd', 'abc')).toBe(false)
    expect(secretsMatch('', 'abc')).toBe(false)
    expect(secretsMatch(undefined, 'abc')).toBe(false)
  })
})

describe('POST /api/game/start-workflow', () => {
  it('503s when WORKFLOW_START_KEY is not configured', async () => {
    delete process.env.WORKFLOW_START_KEY
    headers['x-workflow-start-key'] = 'anything'
    await expect(startWorkflow(ev)).rejects.toMatchObject({ statusCode: 503 })
  })

  it('403s with no key', async () => {
    await expect(startWorkflow(ev)).rejects.toMatchObject({ statusCode: 403 })
    expect(startLiveGameMock).not.toHaveBeenCalled()
  })

  it('403s a wrong key (even one that shares a prefix)', async () => {
    headers['x-workflow-start-key'] = 'wf-secre'
    await expect(startWorkflow(ev)).rejects.toMatchObject({ statusCode: 403 })
    headers['x-workflow-start-key'] = 'wf-secret-and-more'
    await expect(startWorkflow(ev)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('does NOT accept the key from the query string (secrets in URLs end up in logs)', async () => {
    query.key = 'wf-secret'
    await expect(startWorkflow(ev)).rejects.toMatchObject({ statusCode: 403 })
    expect(startLiveGameMock).not.toHaveBeenCalled()
  })

  it('starts the game when the header key matches', async () => {
    headers['x-workflow-start-key'] = 'wf-secret'
    await expect(startWorkflow(ev)).resolves.toEqual({ gameId: 'wf_1' })
    expect(startLiveGameMock).toHaveBeenCalledTimes(1)
    expect(secretsMatchSpy).toHaveBeenCalledWith('wf-secret', 'wf-secret')
  })
})

describe('POST /api/admin/rotate-season', () => {
  it('403s when TERMINA_ADMIN_KEY is not configured', async () => {
    delete process.env.TERMINA_ADMIN_KEY
    headers['x-admin-key'] = 'x'
    await expect(rotateSeason(ev)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('401s a missing or wrong key', async () => {
    await expect(rotateSeason(ev)).rejects.toMatchObject({ statusCode: 401 })
    headers['x-admin-key'] = 'admin-secreT'
    await expect(rotateSeason(ev)).rejects.toMatchObject({ statusCode: 401 })
    headers['x-admin-key'] = 'admin'
    await expect(rotateSeason(ev)).rejects.toMatchObject({ statusCode: 401 })
    expect(startNewSeasonMock).not.toHaveBeenCalled()
  })

  it('rotates when the key matches', async () => {
    headers['x-admin-key'] = 'admin-secret'
    await expect(rotateSeason(ev)).resolves.toMatchObject({ success: true })
    expect(startNewSeasonMock).toHaveBeenCalledTimes(1)
    expect(secretsMatchSpy).toHaveBeenCalledWith('admin-secret', 'admin-secret')
  })
})
