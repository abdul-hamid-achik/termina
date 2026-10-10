import { describe, it, expect, vi, beforeEach } from 'vitest'

const core = {
  claimRun: vi.fn(),
  runOneTick: vi.fn(),
  productionTickDeps: vi.fn(() => ({})),
  finalizeGame: vi.fn(),
  forceDeleteGame: vi.fn(),
}
vi.mock('~~/server/workflows/gameTickCore', () => core)
vi.mock('workflow', () => ({
  sleep: vi.fn(async () => undefined),
  getWorkflowMetadata: () => ({ workflowRunId: 'wrun_A' }),
  getStepMetadata: () => ({ attempt: 1 }),
  RetryableError: class RetryableError extends Error {
    constructor(
      message: string,
      public options?: unknown,
    ) {
      super(message)
    }
  },
}))
const startMock = vi.fn(async () => undefined)
vi.mock('workflow/api', () => ({ start: (...a: unknown[]) => startMock(...(a as [])) }))

const { runGame } = await import('~~/server/workflows/gameTick')

describe('runGame — one run per game', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // The step bodies wait until their absolute deadline; make that instant.
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => {
      fn()
      return 0
    }) as unknown as typeof setTimeout)
  })

  it('claims the game with the WORKFLOW RUN ID (idempotent under a retried claim) and passes it to every tick', async () => {
    core.claimRun.mockImplementation(async (_g: string, epoch: string) => epoch)
    core.runOneTick
      .mockResolvedValueOnce({ ended: false, cycle: 1, skipped: false })
      .mockResolvedValueOnce({ ended: true, cycle: 2, skipped: false })

    const res = await runGame('g1')

    expect(core.claimRun).toHaveBeenCalledWith('g1', 'wrun_A')
    expect(core.runOneTick.mock.calls.map((c) => c[2])).toEqual(['wrun_A', 'wrun_A'])
    expect(core.finalizeGame).toHaveBeenCalledWith('g1')
    expect(res).toMatchObject({ ended: true, finalCycle: 2 })
  })

  it('a stale (fenced-out) run stops: no finalize, no chain, no more ticks', async () => {
    core.claimRun.mockResolvedValue('epoch-old')
    core.runOneTick
      .mockResolvedValueOnce({ ended: false, cycle: 1, skipped: false })
      .mockResolvedValueOnce({ ended: false, cycle: 2, skipped: true, stale: true })

    const res = await runGame('g1')

    expect(core.runOneTick).toHaveBeenCalledTimes(2)
    expect(core.finalizeGame).not.toHaveBeenCalled()
    expect(startMock).not.toHaveBeenCalled()
    expect(res).toMatchObject({ stale: true, chained: false, ended: false, finalCycle: 1 })
  })

  it('exits immediately when the row is gone at claim time', async () => {
    core.claimRun.mockResolvedValue(null)
    const res = await runGame('g1')
    expect(core.runOneTick).not.toHaveBeenCalled()
    expect(res).toMatchObject({ ended: true, chained: false })
  })
})

describe('runGame — a game whose finalize keeps failing must not lock its players out', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => {
      fn()
      return 0
    }) as unknown as typeof setTimeout)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    core.claimRun.mockImplementation(async (_g: string, epoch: string) => epoch)
    core.runOneTick.mockResolvedValue({ ended: true, cycle: 9, skipped: false })
  })

  it('falls back to force-deleting the rows when finalize ultimately fails', async () => {
    core.finalizeGame.mockRejectedValue(new Error('neon down'))

    const res = await runGame('g1')

    expect(core.forceDeleteGame).toHaveBeenCalledWith('g1')
    expect(res).toMatchObject({ ended: true, finalCycle: 9 })
  })

  it('does not force-delete when finalize succeeds', async () => {
    core.finalizeGame.mockResolvedValue(undefined)
    await runGame('g1')
    expect(core.forceDeleteGame).not.toHaveBeenCalled()
  })
})
