import { describe, it, expect, vi, beforeEach } from 'vitest'

// useGameTransport is now a thin permanent wrapper around useGameChannel
// (the DO-era useGameSocket + the ablyTransport flag it used to pick between
// are both gone) — mock the channel out so this test only exercises the
// wrapper, not the transport's internals (which has its own suite).
const channelSentinel = { kind: 'channel' }

vi.mock('~/composables/useGameChannel', () => ({
  useGameChannel: vi.fn(() => channelSentinel),
}))

const { useGameTransport } = await import('../../../app/composables/useGameTransport')
const { useGameChannel } = await import('~/composables/useGameChannel')

describe('useGameTransport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('always returns the Ably+HTTP transport', () => {
    expect(useGameTransport()).toBe(channelSentinel)
    expect(useGameChannel).toHaveBeenCalled()
  })
})
