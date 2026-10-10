import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ablyPresence } from '~~/server/utils/ablyRest'

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }))
vi.mock('~~/server/utils/log', () => ({ gameLog: { warn } }))

// Assembled at runtime — never a key-shaped literal in source (secret scanners).
const FAKE_KEY = ['test-app.test-key', 'not-a-real-secret'].join(':')

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('ablyPresence (REST batch presence)', () => {
  let saved: string | undefined
  beforeEach(() => {
    saved = process.env.ABLY_API_KEY
    process.env.ABLY_API_KEY = FAKE_KEY
  })
  afterEach(() => {
    if (saved === undefined) delete process.env.ABLY_API_KEY
    else process.env.ABLY_API_KEY = saved
  })

  it('makes ONE batch GET for every channel and maps present clientIds', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        successCount: 2,
        failureCount: 0,
        results: [
          { channel: 'game:g:p:a', presence: [{ clientId: 'a', action: 1 }] },
          { channel: 'game:g:p:b', presence: [] },
        ],
      }),
    )
    const out = await ablyPresence(['game:g:p:a', 'game:g:p:b'], fetchImpl as typeof fetch)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/presence?channels=')
    expect(decodeURIComponent(url.split('channels=')[1]!)).toBe('game:g:p:a,game:g:p:b')
    expect(init.method).toBe('GET')
    const headers = init.headers as Record<string, string>
    expect(headers.authorization).toMatch(/^Basic /)
    expect(headers['X-Ably-Version']).toBe('6')
    expect(init.signal).toBeInstanceOf(AbortSignal)

    expect([...out!.get('game:g:p:a')!]).toEqual(['a'])
    expect(out!.get('game:g:p:b')!.size).toBe(0)
  })

  it('accepts the older bare-array response shape too', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([{ channel: 'c1', presence: [{ clientId: 'x', action: 'present' }] }]),
    )
    const out = await ablyPresence(['c1'], fetchImpl as typeof fetch)
    expect(out!.get('c1')!.has('x')).toBe(true)
  })

  it('omits a channel Ably errored on (unknown, NOT empty)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        results: [{ channel: 'c1', error: { code: 40160, statusCode: 401, message: 'nope' } }],
      }),
    )
    const out = await ablyPresence(['c1'], fetchImpl as typeof fetch)
    expect(out!.has('c1')).toBe(false)
  })

  it('does not count a leave/absent member as present', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        results: [
          {
            channel: 'c1',
            presence: [
              { clientId: 'gone', action: 3 },
              { clientId: 'here', action: 2 },
            ],
          },
        ],
      }),
    )
    const out = await ablyPresence(['c1'], fetchImpl as typeof fetch)
    expect([...out!.get('c1')!]).toEqual(['here'])
  })

  it('returns null (never throws) without a key, on HTTP failure, or on a network error', async () => {
    const ok = vi.fn(async () => jsonResponse({ results: [] }))
    delete process.env.ABLY_API_KEY
    expect(await ablyPresence(['c1'], ok as typeof fetch)).toBeNull()
    expect(ok).not.toHaveBeenCalled()

    process.env.ABLY_API_KEY = FAKE_KEY
    const bad = vi.fn(async () => jsonResponse({ error: 'x' }, 500))
    expect(await ablyPresence(['c1'], bad as typeof fetch)).toBeNull()

    const boom = vi.fn(async () => {
      throw new Error('ECONNRESET')
    })
    expect(await ablyPresence(['c1'], boom as typeof fetch)).toBeNull()

    const garbage = vi.fn(async () => jsonResponse({ unexpected: true }))
    expect(await ablyPresence(['c1'], garbage as typeof fetch)).toBeNull()
  })

  it('skips the network entirely for an empty channel list', async () => {
    const fetchImpl = vi.fn()
    const out = await ablyPresence([], fetchImpl as unknown as typeof fetch)
    expect(out!.size).toBe(0)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  let clockDay = 0
  describe('failure visibility (a blind presence lookup disables AFK detection)', () => {
    beforeEach(() => {
      warn.mockClear()
      vi.useFakeTimers()
      // each test starts a day after the previous one: past its 5-minute window
      clockDay += 1
      vi.setSystemTime(Date.parse('2031-01-01T00:00:00Z') + clockDay * 24 * 3_600_000)
    })
    afterEach(() => vi.useRealTimers())

    it('logs the HTTP status and Ably error code on a non-ok answer — never the key', async () => {
      const denied = vi.fn(async () =>
        jsonResponse({ error: { code: 40160, statusCode: 401, message: 'no capability' } }, 401),
      )
      expect(await ablyPresence(['c1'], denied as typeof fetch)).toBeNull()

      expect(warn).toHaveBeenCalledTimes(1)
      const [, detail] = warn.mock.calls[0]!
      expect(detail).toEqual({ status: 401, ablyCode: 40160 })
      expect(JSON.stringify(warn.mock.calls)).not.toContain(FAKE_KEY)
    })

    it('still logs the status when the error body is not JSON', async () => {
      const html = vi.fn(async () => new Response('<html>bad gateway</html>', { status: 502 }))
      await ablyPresence(['c1'], html as typeof fetch)
      expect(warn.mock.calls[0]![1]).toEqual({ status: 502, ablyCode: undefined })
    })

    it('logs a network failure (name only)', async () => {
      const boom = vi.fn(async () => {
        throw new TypeError('fetch failed')
      })
      await ablyPresence(['c1'], boom as typeof fetch)
      expect(warn.mock.calls[0]![1]).toEqual({ error: 'TypeError' })
    })

    it('rate-limits: one warning per 5 minutes per process, then again', async () => {
      const denied = vi.fn(async () => jsonResponse({ error: { code: 40160 } }, 401))
      for (let i = 0; i < 20; i++) {
        vi.advanceTimersByTime(4_000)
        await ablyPresence(['c1'], denied as typeof fetch)
      }
      expect(warn).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(5 * 60_000)
      await ablyPresence(['c1'], denied as typeof fetch)
      expect(warn).toHaveBeenCalledTimes(2)
    })

    it('does not warn on success or when the key is simply unset', async () => {
      const ok = vi.fn(async () => jsonResponse({ results: [] }))
      await ablyPresence(['c1'], ok as typeof fetch)
      delete process.env.ABLY_API_KEY
      await ablyPresence(['c1'], ok as typeof fetch)
      expect(warn).not.toHaveBeenCalled()
    })
  })
})
