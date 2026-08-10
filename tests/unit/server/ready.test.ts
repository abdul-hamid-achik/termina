import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { H3Event } from 'h3'

const { getGameRuntime } = vi.hoisted(() => ({ getGameRuntime: vi.fn() }))
vi.mock('~~/server/plugins/game-server', () => ({ getGameRuntime }))

const responseHeaders: Record<string, string> = {}
let responseStatus = 200

vi.stubGlobal('defineEventHandler', (fn: (event: H3Event) => unknown) => fn)
vi.stubGlobal('setHeader', (_event: H3Event, name: string, value: string) => {
  responseHeaders[name] = value
})
vi.stubGlobal('setResponseStatus', (_event: H3Event, status: number) => {
  responseStatus = status
})

const readyHandler = (await import('../../../server/api/ready.get')).default as (
  event: H3Event,
) => { status: string; runtime: string; timestamp: number }

const makeEvent = () => ({}) as H3Event

describe('GET /api/ready', () => {
  beforeEach(() => {
    getGameRuntime.mockReset()
    for (const key of Object.keys(responseHeaders)) delete responseHeaders[key]
    responseStatus = 200
  })

  it('returns 503 until the managed game runtime is initialized', () => {
    getGameRuntime.mockReturnValue(undefined)
    const result = readyHandler(makeEvent())
    expect(responseStatus).toBe(503)
    expect(result).toMatchObject({ status: 'starting', runtime: 'starting' })
    expect(responseHeaders['content-type']).toBe('application/json')
  })

  it('returns 200 once the managed game runtime is ready', () => {
    getGameRuntime.mockReturnValue({})
    const result = readyHandler(makeEvent())
    expect(responseStatus).toBe(200)
    expect(result).toMatchObject({ status: 'ready', runtime: 'ready' })
  })
})
