import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { H3Event } from 'h3'

// ── Mocks ───────────────────────────────────────────────────────────
// The handler reads getGameRuntime() from the (heavy, side-effectful) game
// server plugin — mock it so importing the route doesn't boot the plugin.
// vi.hoisted lets the hoisted vi.mock factory reference the spy safely.
const { getGameRuntime } = vi.hoisted(() => ({ getGameRuntime: vi.fn() }))
vi.mock('~~/server/plugins/game-server', () => ({ getGameRuntime }))

// Stub the Nitro/h3 auto-imports the handler uses (global in the real runtime).
const capturedResHeaders: Record<string, string> = {}
vi.stubGlobal('defineEventHandler', (fn: (event: H3Event) => unknown) => fn)
vi.stubGlobal('setHeader', (_event: H3Event, name: string, value: string) => {
  capturedResHeaders[name] = value
})

// ── Subject ─────────────────────────────────────────────────────────
const healthHandler = (await import('../../../server/api/health.get')).default as (
  event: H3Event,
) => { status: string; runtime: string; timestamp: number }

const makeEvent = () => ({}) as H3Event

// ── Tests ───────────────────────────────────────────────────────────
describe('GET /api/health', () => {
  beforeEach(() => {
    for (const k of Object.keys(capturedResHeaders)) delete capturedResHeaders[k]
    getGameRuntime.mockReset()
  })

  it('always reports status "ok" with a JSON content-type (DO liveness probe)', () => {
    getGameRuntime.mockReturnValue(undefined)
    const res = healthHandler(makeEvent())
    expect(res.status).toBe('ok')
    expect(capturedResHeaders['content-type']).toBe('application/json')
  })

  it('reports runtime "starting" before the game runtime is initialized', () => {
    getGameRuntime.mockReturnValue(undefined)
    expect(healthHandler(makeEvent()).runtime).toBe('starting')
  })

  it('reports runtime "ready" once the game runtime is live', () => {
    getGameRuntime.mockReturnValue({ dbService: {}, redisService: {} })
    expect(healthHandler(makeEvent()).runtime).toBe('ready')
  })

  it('includes a positive numeric timestamp', () => {
    getGameRuntime.mockReturnValue(undefined)
    const res = healthHandler(makeEvent())
    expect(typeof res.timestamp).toBe('number')
    expect(res.timestamp).toBeGreaterThan(0)
  })
})
