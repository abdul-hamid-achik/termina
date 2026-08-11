import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { H3Event } from 'h3'

// ── Stubs for Nitro/h3 auto-imports (same pattern as join-neon.post.test) ──

let sessionUser: { user?: { id?: string } } | null = null
let requestBody: unknown = {}

function makeEvent(): H3Event {
  return { method: 'POST', path: '/api/game/signal', context: {} } as unknown as H3Event
}

vi.stubGlobal('defineEventHandler', (fn: (event: H3Event) => unknown) => fn)
vi.stubGlobal('getUserSession', async () => sessionUser)
vi.stubGlobal('readBody', async () => requestBody)
vi.stubGlobal('createError', (opts: { statusCode: number; message: string }) => {
  const err = new Error(opts.message) as Error & { statusCode: number }
  err.statusCode = opts.statusCode
  throw err
})

vi.mock('~~/server/utils/RateLimiter', () => ({
  checkScopedRateLimit: vi.fn(() => true),
}))

// Roster: two chaff humans (p1 sender + p2), one audit human (p3), one bot.
let rosterRow: { roster: { players: unknown[] } } | null = {
  roster: {
    players: [
      { playerId: 'p1', team: 'chaff', heroId: 'echo', mmr: 1000 },
      { playerId: 'p2', team: 'chaff', heroId: 'daemon', mmr: 1000 },
      { playerId: 'p3', team: 'audit', heroId: 'cron', mmr: 1000 },
      { playerId: 'bot_a', team: 'audit', heroId: 'mutex', mmr: 1000 },
    ],
  },
}
const dbMock = {
  select: vi.fn(() => ({
    from: () => ({ where: () => ({ limit: async () => (rosterRow ? [rosterRow] : []) }) }),
  })),
}
vi.mock('~~/server/db', () => ({ useDb: () => dbMock }))

const publishMock = vi.fn(async () => undefined)
vi.mock('~~/server/utils/ablyRest', () => ({
  ablyPublishBatch: (...args: unknown[]) => publishMock(...args),
}))

const handler = (await import('~~/server/api/game/signal.post')).default

interface Spec {
  channel: string
  name: string
  data: Record<string, unknown>
}

describe('POST /api/game/signal (chat + map pings over Ably)', () => {
  beforeEach(() => {
    sessionUser = { user: { id: 'p1' } }
    publishMock.mockClear()
  })

  it('broadcasts team chat to same-team humans only (sender echoed, bots skipped)', async () => {
    requestBody = {
      gameId: 'g1',
      signal: { type: 'chat', channel: 'team', message: '⚠ Kernel is MISSING (ss)!' },
    }
    const res = (await handler(makeEvent())) as { delivered: number }

    expect(res.delivered).toBe(2)
    const specs = publishMock.mock.calls[0]![0] as Spec[]
    expect(specs.map((s) => s.channel).sort()).toEqual(['game:g1:p:p1', 'game:g1:p:p2'])
    expect(specs[0]!.name).toBe('chat')
    expect(specs[0]!.data).toEqual({
      playerId: 'p1',
      channel: 'team',
      message: '⚠ Kernel is MISSING (ss)!',
    })
  })

  it('broadcasts all-chat to every human on both teams', async () => {
    requestBody = { gameId: 'g1', signal: { type: 'chat', channel: 'all', message: 'gg' } }
    const res = (await handler(makeEvent())) as { delivered: number }
    expect(res.delivered).toBe(3)
  })

  it('broadcasts a map ping to teammates with the ping_map shape', async () => {
    requestBody = { gameId: 'g1', signal: { type: 'ping_map', zone: 'rookery-terminal' } }
    const res = (await handler(makeEvent())) as { delivered: number }

    expect(res.delivered).toBe(2)
    const specs = publishMock.mock.calls[0]![0] as Spec[]
    expect(specs[0]!.name).toBe('ping_map')
    expect(specs[0]!.data).toEqual({ playerId: 'p1', zone: 'rookery-terminal' })
  })

  it('rejects a ping for a zone that does not exist', async () => {
    requestBody = { gameId: 'g1', signal: { type: 'ping_map', zone: 'narnia' } }
    await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects empty and oversized chat messages', async () => {
    requestBody = { gameId: 'g1', signal: { type: 'chat', channel: 'team', message: '   ' } }
    await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 })

    requestBody = {
      gameId: 'g1',
      signal: { type: 'chat', channel: 'team', message: 'x'.repeat(201) },
    }
    await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 })
  })

  it('403s a sender who is not in the game roster', async () => {
    sessionUser = { user: { id: 'stranger' } }
    requestBody = { gameId: 'g1', signal: { type: 'chat', channel: 'team', message: 'hi' } }
    await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 403 })
  })

  it('401s without a session', async () => {
    sessionUser = null
    requestBody = { gameId: 'g1', signal: { type: 'chat', channel: 'team', message: 'hi' } }
    await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 401 })
  })
})
