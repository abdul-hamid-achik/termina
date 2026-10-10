import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Effect } from 'effect'
import type { H3Event } from 'h3'

let sessionUser: { user?: { id?: string; username?: string } } | null = null
let body: unknown = {}

vi.stubGlobal('defineEventHandler', (fn: (event: H3Event) => unknown) => fn)
vi.stubGlobal('getUserSession', async () => sessionUser)
vi.stubGlobal('readBody', async () => body)
vi.stubGlobal('createError', (opts: { statusCode: number; message: string }) => {
  const err = new Error(opts.message) as Error & { statusCode: number }
  err.statusCode = opts.statusCode
  return err
})

vi.mock('~~/server/plugins/game-server', () => ({
  getGameRuntime: () => ({
    dbService: { getPlayer: () => Effect.succeed({ mmr: 1337 }) },
  }),
}))

// party.ts is Neon-backed and async (real-Postgres coverage lives in
// tests/integration/party.test.ts) — these tests pin the handlers' contract:
// they AWAIT the party layer and return plain, serializable shapes.
const aParty = {
  code: 'ABCDE',
  leaderId: 'me',
  createdAt: 1,
  members: [{ playerId: 'me', username: 'me', mmr: 1337 }],
}
const createPartyMock = vi.fn(async (..._a: unknown[]) => aParty)
const joinPartyMock = vi.fn(async (..._a: unknown[]) => ({ success: true, party: aParty }))
const leavePartyMock = vi.fn(async (..._a: unknown[]) => {})
const getPartyByPlayerMock = vi.fn(async (..._a: unknown[]) => undefined as unknown)
vi.mock('~~/server/game/matchmaking/party', () => ({
  createParty: (...a: unknown[]) => createPartyMock(...a),
  joinParty: (...a: unknown[]) => joinPartyMock(...a),
  leaveParty: (...a: unknown[]) => leavePartyMock(...a),
  getPartyByPlayer: (...a: unknown[]) => getPartyByPlayerMock(...a),
}))

type Handler = (e: H3Event) => Promise<unknown>
const load = async (p: string) => (await import(p)).default as unknown as Handler
const create = await load('~~/server/api/party/create.post')
const join = await load('~~/server/api/party/join.post')
const leave = await load('~~/server/api/party/leave.post')
const status = await load('~~/server/api/party/status.get')
const ev = {} as H3Event

beforeEach(() => {
  vi.clearAllMocks()
  sessionUser = { user: { id: 'me', username: 'me' } }
  body = {}
  getPartyByPlayerMock.mockResolvedValue(undefined)
  joinPartyMock.mockResolvedValue({ success: true, party: aParty })
})

describe('party handlers (async Neon-backed party layer)', () => {
  it('create returns the resolved party, seeded with the player MMR', async () => {
    await expect(create(ev)).resolves.toEqual({ party: aParty })
    expect(createPartyMock).toHaveBeenCalledWith({ playerId: 'me', username: 'me', mmr: 1337 })
  })

  it('join returns the resolved party', async () => {
    body = { code: 'abcde' }
    await expect(join(ev)).resolves.toEqual({ party: aParty })
    expect(joinPartyMock).toHaveBeenCalledWith('abcde', {
      playerId: 'me',
      username: 'me',
      mmr: 1337,
    })
  })

  it('join maps a party-layer failure to a 400', async () => {
    body = { code: 'NOPE1' }
    joinPartyMock.mockResolvedValue({
      success: false,
      party: undefined,
      error: 'Party not found',
    } as never)
    await expect(join(ev)).rejects.toMatchObject({ statusCode: 400, message: 'Party not found' })
  })

  it('leave awaits the leave, THEN reports the (now empty) party state', async () => {
    const order: string[] = []
    leavePartyMock.mockImplementation(async () => {
      await Promise.resolve()
      order.push('left')
    })
    getPartyByPlayerMock.mockImplementation(async () => {
      order.push('read')
      return undefined
    })
    await expect(leave(ev)).resolves.toEqual({ success: true, party: null })
    expect(order).toEqual(['left', 'read'])
  })

  it('status returns the resolved party, or null', async () => {
    getPartyByPlayerMock.mockResolvedValue(aParty)
    await expect(status(ev)).resolves.toEqual({ party: aParty })
    getPartyByPlayerMock.mockResolvedValue(undefined)
    await expect(status(ev)).resolves.toEqual({ party: null })
  })

  it('401s without a session', async () => {
    sessionUser = null
    for (const h of [create, join, leave, status]) {
      await expect(h(ev)).rejects.toMatchObject({ statusCode: 401 })
    }
  })
})
