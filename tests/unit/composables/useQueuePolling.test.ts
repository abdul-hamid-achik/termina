import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useQueuePolling } from '~~/app/composables/useQueuePolling'

const mockFetch = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  mockFetch.mockReset()
  vi.stubGlobal('$fetch', mockFetch)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useQueuePolling', () => {
  it('polls immediately on start, before the first interval tick', async () => {
    mockFetch.mockResolvedValue({ status: 'searching', queueSize: 2, botFillDue: false })
    const onSearching = vi.fn()
    const { start } = useQueuePolling()

    start({ onFound: vi.fn(), onSearching })
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    expect(onSearching).toHaveBeenCalledWith({ queueSize: 2, botFillDue: false })
  })

  it('calls onFound exactly once and stops polling once status is found', async () => {
    mockFetch.mockResolvedValue({ status: 'found', gameId: 'g1' })
    const onFound = vi.fn()
    const { start } = useQueuePolling()

    start({ onFound })
    await vi.waitFor(() => expect(onFound).toHaveBeenCalledTimes(1))
    expect(onFound).toHaveBeenCalledWith('g1')

    // Advancing time after a found result must NOT re-poll — polling stopped.
    mockFetch.mockClear()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('re-polls on the given interval while searching', async () => {
    mockFetch.mockResolvedValue({ status: 'searching', queueSize: 1, botFillDue: false })
    const { start } = useQueuePolling()

    start({ onFound: vi.fn() }, 1000)
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(1000)
    expect(mockFetch).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(2000)
    expect(mockFetch).toHaveBeenCalledTimes(4)
  })

  it('calls onIdle for an idle status', async () => {
    mockFetch.mockResolvedValue({ status: 'idle' })
    const onIdle = vi.fn()
    const { start } = useQueuePolling()

    start({ onFound: vi.fn(), onIdle })
    await vi.waitFor(() => expect(onIdle).toHaveBeenCalledTimes(1))
  })

  it('calls onError and keeps polling on a fetch failure', async () => {
    mockFetch.mockRejectedValue(new Error('network down'))
    const onError = vi.fn()
    const { start } = useQueuePolling()

    start({ onFound: vi.fn(), onError }, 1000)
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(1000)
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(2))
  })

  it('stop() cancels the interval — no further polls afterwards', async () => {
    mockFetch.mockResolvedValue({ status: 'searching', queueSize: 1, botFillDue: false })
    const { start, stop } = useQueuePolling()

    start({ onFound: vi.fn() }, 1000)
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))

    stop()
    mockFetch.mockClear()
    await vi.advanceTimersByTimeAsync(5000)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('calling start() again resets any previous polling loop', async () => {
    mockFetch.mockResolvedValue({ status: 'searching', queueSize: 1, botFillDue: false })
    const { start } = useQueuePolling()

    start({ onFound: vi.fn() }, 1000)
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))

    mockFetch.mockClear()
    start({ onFound: vi.fn() }, 5000) // restart with a different interval
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))

    // The OLD 1000ms timer must be gone — advancing 1000ms must not re-fire.
    await vi.advanceTimersByTimeAsync(1000)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
