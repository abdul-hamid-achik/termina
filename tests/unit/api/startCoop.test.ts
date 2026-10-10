import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { H3Event } from 'h3'
import type { Party } from '~~/server/game/matchmaking/party'
import type * as BotManagerModule from '~~/server/game/ai/BotManager'

// party.ts is Neon-backed (covered against real Postgres in
// tests/integration/party.test.ts) — here the handler's own logic is under
// test, so the party store is a simple fake.
let currentParty: Party | undefined
// Mirrors claimPartyForStart's contract: the claim DELETES the party atomically
// and hands back the snapshot; a second claim finds nothing.
const claimPartyMock = vi.fn(async (id: string) => {
  const p = currentParty
  if (!p || !p.members.some((m) => m.playerId === id)) {
    return { ok: false as const, reason: 'not_in_party' as const }
  }
  if (p.leaderId !== id) return { ok: false as const, reason: 'not_leader' as const }
  currentParty = undefined
  return { ok: true as const, party: p }
})
const restorePartyMock = vi.fn(async (p: Party) => {
  currentParty = p
})
vi.mock('~~/server/game/matchmaking/party', () => ({
  claimPartyForStart: (id: string) => claimPartyMock(id),
  restoreParty: (p: Party) => restorePartyMock(p),
}))

function seedParty(mmrs: [number, number] = [1000, 1100]) {
  currentParty = {
    code: 'ABCDE',
    leaderId: 'lead',
    createdAt: 0,
    members: [
      { playerId: 'lead', username: 'lead', mmr: mmrs[0] },
      { playerId: 'mate', username: 'mate', mmr: mmrs[1] },
    ],
  }
}

let sessionUser: { user?: { id?: string } } | null = null

vi.stubGlobal('defineEventHandler', (fn: (event: H3Event) => unknown) => fn)
vi.stubGlobal('getUserSession', async () => sessionUser)
vi.stubGlobal('createError', (opts: { statusCode: number; message: string }) => {
  const err = new Error(opts.message) as Error & { statusCode: number }
  err.statusCode = opts.statusCode
  return err
})

const startLiveGameMock = vi.fn(async (..._a: unknown[]) => ({ gameId: 'wf_coop' }))
const findLiveGameForPlayerMock = vi.fn(async (_id: string) => null as string | null)
vi.mock('~~/server/game/liveGame', () => ({
  startLiveGame: (...a: unknown[]) => startLiveGameMock(...a),
  findLiveGameForPlayer: (id: string) => findLiveGameForPlayerMock(id),
}))
const isPlayerInQueueMock = vi.fn(async (_id: string) => false)
vi.mock('~~/server/game/matchmaking/queueNeon', () => ({
  isPlayerInQueue: (id: string) => isPlayerInQueueMock(id),
}))
vi.mock('~~/server/game/ai/BotManager', async () => ({
  difficultyForMmr: (await vi.importActual<BotManagerModule>('~~/server/game/ai/BotManager'))
    .difficultyForMmr,
  createBotPlayers: (n: number) =>
    Array.from({ length: n }, (_, i) => ({ playerId: `bot_${i}`, username: `bot${i}`, mmr: 1000 })),
}))

const handler = (await import('~~/server/api/party/start-coop.post')).default as unknown as (
  e: H3Event,
) => Promise<unknown>
const ev = {} as H3Event

beforeEach(() => {
  vi.clearAllMocks()
  sessionUser = { user: { id: 'lead' } }
  findLiveGameForPlayerMock.mockResolvedValue(null)
  isPlayerInQueueMock.mockResolvedValue(false)
  seedParty()
})

describe('POST /api/party/start-coop — guards', () => {
  it('starts the co-op game and disbands the party when everyone is free', async () => {
    await expect(handler(ev)).resolves.toEqual({ success: true, gameId: 'wf_coop' })
    expect(startLiveGameMock).toHaveBeenCalledTimes(1)
    // The claim consumed the party (no restore on success).
    expect(currentParty).toBeUndefined()
    expect(restorePartyMock).not.toHaveBeenCalled()
  })

  it('409s when the leader is already queued, without starting a game', async () => {
    isPlayerInQueueMock.mockImplementation(async (id) => id === 'lead')
    await expect(handler(ev)).rejects.toMatchObject({ statusCode: 409 })
    expect(startLiveGameMock).not.toHaveBeenCalled()
  })

  it('409s when a party MEMBER is queued', async () => {
    isPlayerInQueueMock.mockImplementation(async (id) => id === 'mate')
    await expect(handler(ev)).rejects.toMatchObject({ statusCode: 409 })
    expect(startLiveGameMock).not.toHaveBeenCalled()
  })

  it('409s when the leader is already in a live game', async () => {
    findLiveGameForPlayerMock.mockImplementation(async (id) => (id === 'lead' ? 'g_live' : null))
    await expect(handler(ev)).rejects.toMatchObject({ statusCode: 409 })
    expect(startLiveGameMock).not.toHaveBeenCalled()
  })

  it('409s when a party MEMBER is already in a live game', async () => {
    findLiveGameForPlayerMock.mockImplementation(async (id) => (id === 'mate' ? 'g_live' : null))
    await expect(handler(ev)).rejects.toMatchObject({ statusCode: 409 })
    expect(startLiveGameMock).not.toHaveBeenCalled()
  })

  it('leaves the party intact after a rejected start so the leader can retry', async () => {
    isPlayerInQueueMock.mockResolvedValue(true)
    await expect(handler(ev)).rejects.toMatchObject({ statusCode: 409 })
    expect(restorePartyMock).toHaveBeenCalledTimes(1)
    expect(currentParty?.code).toBe('ABCDE')
    isPlayerInQueueMock.mockResolvedValue(false)
    await expect(handler(ev)).resolves.toMatchObject({ success: true })
  })
})

describe('POST /api/party/start-coop — atomic claim', () => {
  it('a double-click / second tab starts exactly ONE game; the loser gets 409', async () => {
    const results = await Promise.allSettled([handler(ev), handler(ev)])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toMatchObject({ statusCode: 409 })
    expect(startLiveGameMock).toHaveBeenCalledTimes(1)
  })

  it('starts from the claimed snapshot: every member in it is in the roster', async () => {
    await handler(ev)
    const [players] = startLiveGameMock.mock.calls[0]! as [{ playerId: string; team: string }[]]
    const chaffHumans = players.filter((p) => p.team === 'chaff' && !p.playerId.startsWith('bot_'))
    expect(chaffHumans.map((p) => p.playerId).sort()).toEqual(['lead', 'mate'])
  })

  it('a non-leader gets 403 and does NOT consume the party', async () => {
    sessionUser = { user: { id: 'mate' } }
    await expect(handler(ev)).rejects.toMatchObject({ statusCode: 403 })
    expect(currentParty?.code).toBe('ABCDE')
  })

  it('409s when there is no party at all', async () => {
    currentParty = undefined
    await expect(handler(ev)).rejects.toMatchObject({ statusCode: 409 })
    expect(startLiveGameMock).not.toHaveBeenCalled()
  })

  it('restores the party and rethrows when the game fails to start', async () => {
    startLiveGameMock.mockRejectedValueOnce(new Error('workflow down'))
    await expect(handler(ev)).rejects.toThrow('workflow down')
    expect(restorePartyMock).toHaveBeenCalledTimes(1)
    expect(currentParty?.members).toHaveLength(2)
    // The leader can retry.
    await expect(handler(ev)).resolves.toMatchObject({ success: true })
  })

  it('a failing restore never masks the original start error', async () => {
    startLiveGameMock.mockRejectedValueOnce(new Error('workflow down'))
    restorePartyMock.mockRejectedValueOnce(new Error('db down'))
    await expect(handler(ev)).rejects.toThrow('workflow down')
  })
})

describe('POST /api/party/start-coop — bot difficulty from the party MMR', () => {
  const startedDifficulty = async (mmrs: [number, number]) => {
    seedParty(mmrs)
    await handler(ev)
    const [, opts] = startLiveGameMock.mock.calls[0]!
    return (opts as { botOptions?: { difficulty?: string } }).botOptions?.difficulty
  }

  it('party avg MMR 800 -> easy bots', async () => {
    expect(await startedDifficulty([700, 900])).toBe('easy')
  })

  it('party avg MMR 1000 -> medium bots', async () => {
    expect(await startedDifficulty([900, 1100])).toBe('medium')
  })

  it('party avg MMR 1500 -> hard bots', async () => {
    expect(await startedDifficulty([1400, 1600])).toBe('hard')
  })
})
