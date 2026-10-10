import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ablyPublishBatch, stampMessageIds } from '~~/server/utils/ablyRest'

vi.mock('~~/server/utils/log', () => ({ gameLog: { warn: vi.fn() } }))

// Assembled at runtime — never a key-shaped literal in source (secret scanners).
const FAKE_KEY = ['test-app.test-key', 'not-a-real-secret'].join(':')

/** A fetch that never answers — only its AbortSignal can end it. */
function hangingFetch() {
  return vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
      }),
  )
}

describe('ablyPublishBatch', () => {
  let saved: string | undefined
  beforeEach(() => {
    saved = process.env.ABLY_API_KEY
    process.env.ABLY_API_KEY = FAKE_KEY
  })
  afterEach(() => {
    if (saved === undefined) delete process.env.ABLY_API_KEY
    else process.env.ABLY_API_KEY = saved
  })

  it('posts every spec in ONE batch request', async () => {
    const fetchImpl = vi.fn(async () => new Response('[]', { status: 201 }))
    await ablyPublishBatch(
      [
        { channel: 'game:g:p:a', data: { cycle: 1 } },
        { channel: 'game:g:p:b', data: { x: 1 }, name: 'announcement' },
      ],
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    )
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toMatch(/\/messages$/)
    expect(JSON.parse(String(init.body))).toEqual([
      { channels: ['game:g:p:a'], messages: { name: 'cycle_state', data: { cycle: 1 } } },
      { channels: ['game:g:p:b'], messages: { name: 'announcement', data: { x: 1 } } },
    ])
  })

  // A publish rides inside the 4s tick step AFTER the cycle has committed: a
  // hung POST used to hold the whole workflow loop (and every client's clock)
  // until the platform's own socket timeout — minutes, not seconds.
  it('gives up on a hung request instead of stalling the tick', async () => {
    const fetchImpl = hangingFetch()
    const started = Date.now()
    await expect(
      ablyPublishBatch([{ channel: 'c', data: 1 }], {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        timeoutMs: 30,
      }),
    ).rejects.toThrow()
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  it('bounds a production publish by default (no options) — the signal is always set', async () => {
    const fetchImpl = vi.fn(async () => new Response('[]', { status: 201 }))
    await ablyPublishBatch([{ channel: 'c', data: 1 }], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('sends a spec id as the message id (Ably idempotent publish)', async () => {
    const fetchImpl = vi.fn(async () => new Response('[]', { status: 201 }))
    await ablyPublishBatch([{ channel: 'c', data: 1, id: 'c:4:cycle_state.0' }], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))[0].messages).toEqual({
      id: 'c:4:cycle_state.0',
      name: 'cycle_state',
      data: 1,
    })
  })

  it('throws on a non-2xx answer (publishCommitted logs it; the tick goes on)', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 500 }))
    await expect(
      ablyPublishBatch([{ channel: 'c', data: 1 }], {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/500/)
  })
})

describe('stampMessageIds', () => {
  const specs = () => [
    { channel: 'game:g:p:a', data: 1 },
    { channel: 'game:g:p:a', name: 'announcement', data: 'x' },
    { channel: 'game:g:p:a', name: 'announcement', data: 'y' },
    { channel: 'game:g:p:b', data: 2 },
    { channel: 'game:g:p:a', name: 'game_over', data: {} },
  ]

  it('is deterministic: the same batch for the same cycle gets the same ids', () => {
    expect(stampMessageIds(specs(), 9).map((s) => s.id)).toEqual(
      stampMessageIds(specs(), 9).map((s) => s.id),
    )
  })

  it('names channel, cycle and message, with an ordinal so two lines never collide', () => {
    expect(stampMessageIds(specs(), 9).map((s) => s.id)).toEqual([
      'game:g:p:a:9:cycle_state.0',
      'game:g:p:a:9:announcement.0',
      'game:g:p:a:9:announcement.1',
      'game:g:p:b:9:cycle_state.0',
      'game:g:p:a:9:game_over.0',
    ])
  })

  it('a different cycle never reuses an id (Ably would drop a fresh message)', () => {
    const a = new Set(stampMessageIds(specs(), 9).map((s) => s.id))
    expect(stampMessageIds(specs(), 10).some((s) => a.has(s.id))).toBe(false)
  })
})
