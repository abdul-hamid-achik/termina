import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { H3Event } from 'h3'

const { getGameRuntime, execute } = vi.hoisted(() => ({
  getGameRuntime: vi.fn(),
  execute: vi.fn(),
}))
vi.mock('~~/server/plugins/game-server', () => ({ getGameRuntime }))
vi.mock('~~/server/db', () => ({ useDb: () => ({ execute }) }))

const responseHeaders: Record<string, string> = {}
let responseStatus = 200

vi.stubGlobal('defineEventHandler', (fn: (event: H3Event) => unknown) => fn)
vi.stubGlobal('setHeader', (_event: H3Event, name: string, value: string) => {
  responseHeaders[name] = value
})
vi.stubGlobal('setResponseStatus', (_event: H3Event, status: number) => {
  responseStatus = status
})

const makeEvent = () => ({}) as H3Event

// oxlint-disable-next-line typescript/consistent-type-imports -- the module is dynamically re-imported per test (vi.resetModules) to reset the schema-contract cache; typeof import() is the idiomatic way to type it
type ReadyModule = typeof import('../../../server/api/ready.get')
type ReadyHandler = (event: H3Event) => Promise<{
  status: string
  runtime: string
  schema?: string
  missingColumns?: string[]
  timestamp: number
}>

/** Re-imports the route module fresh, so its module-level schema-check cache
 *  starts clean — needed to test the cache's own behavior in isolation. */
async function freshReadyHandler(): Promise<{
  handler: ReadyHandler
  columns: ReadyModule['REQUIRED_COLUMNS']
}> {
  vi.resetModules()
  const mod = (await import('../../../server/api/ready.get')) as ReadyModule
  return { handler: mod.default as unknown as ReadyHandler, columns: mod.REQUIRED_COLUMNS }
}

/** Builds information_schema.columns-shaped rows for every required column,
 *  optionally dropping one (table, column) pair to simulate drift. */
function rowsFor(
  columns: ReadyModule['REQUIRED_COLUMNS'],
  omit?: { table: string; column: string },
) {
  return columns
    .filter((c) => !(omit && c.table === omit.table && c.column === omit.column))
    .map((c) => ({ table_name: c.table, column_name: c.column }))
}

describe('GET /api/ready', () => {
  beforeEach(() => {
    getGameRuntime.mockReset()
    execute.mockReset()
    for (const key of Object.keys(responseHeaders)) delete responseHeaders[key]
    responseStatus = 200
  })

  it('returns 503 until the managed game runtime is initialized', async () => {
    getGameRuntime.mockReturnValue(undefined)
    const { handler } = await freshReadyHandler()
    const result = await handler(makeEvent())
    expect(responseStatus).toBe(503)
    expect(result).toMatchObject({ status: 'starting', runtime: 'starting' })
    expect(responseHeaders['content-type']).toBe('application/json')
    // Runtime not ready is a cheaper, earlier gate — the schema query must
    // never run before it.
    expect(execute).not.toHaveBeenCalled()
  })

  it('returns 200 once the managed game runtime is ready and the schema contract is satisfied', async () => {
    getGameRuntime.mockReturnValue({})
    const { handler, columns } = await freshReadyHandler()
    execute.mockResolvedValue(rowsFor(columns))
    const result = await handler(makeEvent())
    expect(responseStatus).toBe(200)
    expect(result).toMatchObject({ status: 'ready', runtime: 'ready', schema: 'ready' })
  })

  it('(a) all required columns present -> ready', async () => {
    getGameRuntime.mockReturnValue({})
    const { handler, columns } = await freshReadyHandler()
    execute.mockResolvedValue(rowsFor(columns))
    const result = await handler(makeEvent())
    expect(responseStatus).toBe(200)
    expect(result.status).toBe('ready')
  })

  it('(b) a missing column -> not ready, named in the payload', async () => {
    getGameRuntime.mockReturnValue({})
    const { handler, columns } = await freshReadyHandler()
    execute.mockResolvedValue(rowsFor(columns, { table: 'players', column: 'tutorial_completed' }))
    const result = await handler(makeEvent())
    expect(responseStatus).toBe(503)
    expect(result.status).toBe('schema_drift')
    expect(result.missingColumns).toContain('players.tutorial_completed')
  })

  it('(c) a failing check is NOT cached — fixing the schema makes the next probe ready', async () => {
    getGameRuntime.mockReturnValue({})
    const { handler, columns } = await freshReadyHandler()

    execute.mockResolvedValueOnce(rowsFor(columns, { table: 'matches', column: 'season_number' }))
    const first = await handler(makeEvent())
    expect(first.status).toBe('schema_drift')
    expect(execute).toHaveBeenCalledTimes(1)

    // Operator runs `db:push` — the drifted column now exists.
    execute.mockResolvedValueOnce(rowsFor(columns))
    const second = await handler(makeEvent())
    expect(second.status).toBe('ready')
    expect(responseStatus).toBe(200)
    // Must have re-queried rather than replaying the cached failure.
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('(d) a passing check IS cached — subsequent probes do not re-query', async () => {
    getGameRuntime.mockReturnValue({})
    const { handler, columns } = await freshReadyHandler()

    execute.mockResolvedValueOnce(rowsFor(columns))
    const first = await handler(makeEvent())
    expect(first.status).toBe('ready')
    expect(execute).toHaveBeenCalledTimes(1)

    // Even if the mock were to report drift now, the cached pass must win —
    // proves the second probe never re-queries.
    execute.mockResolvedValueOnce(rowsFor(columns, { table: 'players', column: 'season_mmr' }))
    const second = await handler(makeEvent())
    expect(second.status).toBe('ready')
    expect(responseStatus).toBe(200)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('reports a DB-unreachable failure once, distinct from a schema-drift report', async () => {
    getGameRuntime.mockReturnValue({})
    const { handler } = await freshReadyHandler()
    execute.mockRejectedValue(new Error('connection refused'))
    const result = await handler(makeEvent())
    expect(responseStatus).toBe(503)
    expect(result.status).toBe('schema_check_failed')
    expect(result.missingColumns).toBeUndefined()
  })
})
