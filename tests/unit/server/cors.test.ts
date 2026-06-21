import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { H3Event } from 'h3'

// ── Helpers ─────────────────────────────────────────────────────────

// We need to stub the h3/nitro auto-imports. The cors.ts file uses:
//   defineEventHandler, getHeader, setHeader, getMethod, setResponseStatus
// These are global in the Nitro/Nuxt env. We stub them globally so the
// middleware module sees them.

const capturedResHeaders: Record<string, string | number> = {}
let capturedStatus = 200

vi.stubGlobal('defineEventHandler', (fn: (event: H3Event) => unknown) => fn)
vi.stubGlobal('getHeader', (event: H3Event, name: string) => {
  const e = event as unknown as { __headers: Record<string, string> }
  return e.__headers?.[name.toLowerCase()] ?? null
})
vi.stubGlobal('setHeader', (event: H3Event, name: string, value: string) => {
  capturedResHeaders[name] = value
})
vi.stubGlobal('getMethod', (event: H3Event) => {
  return (event as unknown as { __headers: Record<string, string> }).__headers?.method ?? 'GET'
})
vi.stubGlobal('setResponseStatus', (event: H3Event, code: number) => {
  capturedStatus = code
})

/** Minimal H3Event stub with stub-accessible fields. */
function makeEventFull(method: string, path: string, origin?: string) {
  const headers: Record<string, string> = { method: method }
  if (origin) headers.origin = origin
  return {
    method,
    path,
    __headers: headers,
  } as unknown as H3Event
}

// ── Subject ────────────────────────────────────────────────────────

const corsHandler = (await import('../../../server/middleware/cors')).default as (
  event: H3Event,
) => unknown

// ── Tests ──────────────────────────────────────────────────────────

describe('CORS middleware', () => {
  beforeEach(() => {
    for (const k of Object.keys(capturedResHeaders)) delete capturedResHeaders[k]
    capturedStatus = 200
  })

  it('no-ops when no Origin header is present', () => {
    const event = makeEventFull('GET', '/api/health')
    const result = corsHandler(event)
    expect(result).toBeUndefined()
    expect(capturedResHeaders).toEqual({})
  })

  it('no-ops for non-/api/ routes even with Origin', () => {
    const event = makeEventFull('GET', '/ws', 'https://app.example.com')
    const result = corsHandler(event)
    expect(result).toBeUndefined()
    expect(capturedResHeaders).toEqual({})
  })

  it('sets CORS headers for /api/ routes with an Origin', () => {
    const origin = 'https://app.example.com'
    const event = makeEventFull('GET', '/api/health', origin)
    corsHandler(event)

    expect(capturedResHeaders['access-control-allow-origin']).toBe(origin)
    expect(capturedResHeaders['access-control-allow-credentials']).toBe('true')
    expect(capturedResHeaders['access-control-allow-methods']).toContain('GET')
    expect(capturedResHeaders['access-control-allow-methods']).toContain('OPTIONS')
    expect(capturedResHeaders['access-control-allow-headers']).toContain('Content-Type')
    expect(capturedResHeaders['access-control-max-age']).toBe('86400')
  })

  it('echoes the exact request Origin (not a wildcard)', () => {
    const origin = 'https://termina.vercel.app'
    const event = makeEventFull('GET', '/api/queue/status', origin)
    corsHandler(event)
    expect(capturedResHeaders['access-control-allow-origin']).toBe(origin)
  })

  it('short-circuits OPTIONS preflight with 204', () => {
    const event = makeEventFull('OPTIONS', '/api/queue/join', 'https://app.example.com')
    const result = corsHandler(event)

    expect(capturedStatus).toBe(204)
    expect(result).toBe('')
  })

  it('sets headers for deeply nested /api/ paths', () => {
    const event = makeEventFull('POST', '/api/auth/register', 'https://app.example.com')
    corsHandler(event)
    expect(capturedResHeaders['access-control-allow-origin']).toBeDefined()
  })

  it('does not short-circuit non-OPTIONS requests', () => {
    const event = makeEventFull('GET', '/api/health', 'https://app.example.com')
    const result = corsHandler(event)
    expect(result).toBeUndefined()
    expect(capturedStatus).toBe(200)
  })
})
