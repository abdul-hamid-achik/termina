import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// No real database: capture what the tick's lazy client is built with.
const { postgresMock } = vi.hoisted(() => ({
  postgresMock: vi.fn(() => ({}) as unknown),
}))
vi.mock('postgres', () => ({ default: postgresMock }))
vi.mock('drizzle-orm/postgres-js', () => ({ drizzle: vi.fn(() => ({})) }))

describe("the tick's postgres client", () => {
  let saved: string | undefined
  beforeEach(() => {
    saved = process.env.DATABASE_URL
    process.env.DATABASE_URL = ['postgres://u', 'p@localhost:5432/db'].join(':')
  })
  afterEach(() => {
    if (saved === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = saved
  })

  // A cold Neon connect inside a 4s tick step used to be bounded only by
  // postgres.js's 30s default — one slow connect froze every player's clock.
  it('is built with an explicit connect_timeout and idle_timeout (plus the pooler-safe options)', async () => {
    const core = await import('~~/server/workflows/gameTickCore')
    core.liveGamesRepo()
    expect(postgresMock).toHaveBeenCalledTimes(1)
    const [url, opts] = postgresMock.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(url).toBe(process.env.DATABASE_URL)
    expect(opts).toMatchObject({ prepare: false, connect_timeout: 10, idle_timeout: 20 })
    // Lazy singleton: a second repo reuses the client.
    core.pendingActionsRepo()
    expect(postgresMock).toHaveBeenCalledTimes(1)
  })
})
