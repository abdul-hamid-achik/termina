import { describe, it, expect, vi, beforeEach } from 'vitest'

// useGameTransport just picks between the two real composables by a runtime
// flag — mock both out entirely so this test only exercises the picking
// logic, not either transport's internals (those have their own suites).
const socketSentinel = { kind: 'socket' }
const channelSentinel = { kind: 'channel' }

vi.mock('~/composables/useGameSocket', () => ({
  useGameSocket: vi.fn(() => socketSentinel),
}))
vi.mock('~/composables/useGameChannel', () => ({
  useGameChannel: vi.fn(() => channelSentinel),
}))

let mockPublicConfig: Record<string, unknown> = {}
vi.stubGlobal('useRuntimeConfig', () => ({ public: mockPublicConfig }))

const { useGameTransport } = await import('../../../app/composables/useGameTransport')
const { useGameSocket } = await import('~/composables/useGameSocket')
const { useGameChannel } = await import('~/composables/useGameChannel')

describe('useGameTransport', () => {
  beforeEach(() => {
    mockPublicConfig = {}
    vi.clearAllMocks()
  })

  it('returns the legacy WebSocket transport when the flag is off (default)', () => {
    mockPublicConfig = { ablyTransport: false }
    expect(useGameTransport()).toBe(socketSentinel)
    expect(useGameSocket).toHaveBeenCalled()
    expect(useGameChannel).not.toHaveBeenCalled()
  })

  it('returns the Ably+HTTP transport when the flag is on', () => {
    mockPublicConfig = { ablyTransport: true }
    expect(useGameTransport()).toBe(channelSentinel)
    expect(useGameChannel).toHaveBeenCalled()
    expect(useGameSocket).not.toHaveBeenCalled()
  })
})
